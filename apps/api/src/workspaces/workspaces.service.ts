import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { nanoid } from "nanoid";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 60);
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(userId: string, dto: CreateWorkspaceDto) {
    const baseSlug = slugify(dto.name) || "workspace";
    let slug = baseSlug;
    for (let attempt = 0; await this.prisma.workspace.findUnique({ where: { slug } }); attempt++) {
      slug = `${baseSlug}-${nanoid(6).toLowerCase()}`;
      if (attempt > 5) {
        throw new ConflictException("Could not generate a unique workspace slug, try a different name");
      }
    }

    const workspace = await this.prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({ data: { name: dto.name, slug } });
      await tx.workspaceMember.create({
        data: { workspaceId: ws.id, userId, role: WorkspaceRole.OWNER },
      });
      return ws;
    });

    await this.auditService.record({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "workspace.created",
      targetType: "Workspace",
      targetId: workspace.id,
      metadata: { name: workspace.name },
    });

    return workspace;
  }

  async listForUser(userId: string) {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { deletedAt: null } },
      include: { workspace: true },
    });
    return memberships.map((m) => ({ ...m.workspace, myRole: m.role }));
  }

  async softDelete(workspaceId: string, actorUserId: string) {
    const workspace = await this.prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace || workspace.deletedAt) {
      throw new NotFoundException("Workspace not found");
    }

    const updated = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { deletedAt: new Date() },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "workspace.deleted",
      targetType: "Workspace",
      targetId: workspaceId,
    });

    return updated;
  }

  async listMembers(workspaceId: string) {
    return this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async invite(workspaceId: string, actorUserId: string, dto: InviteMemberDto) {
    if (dto.role === WorkspaceRole.OWNER) {
      throw new BadRequestException("Ownership cannot be granted via invitation; use transfer-ownership instead");
    }

    const existingMember = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email: dto.email } },
    });
    if (existingMember) {
      throw new ConflictException("This person is already a member of the workspace");
    }

    const token = nanoid(32);
    const invitation = await this.prisma.workspaceInvitation.upsert({
      where: { workspaceId_email: { workspaceId, email: dto.email } },
      create: {
        workspaceId,
        email: dto.email,
        role: dto.role,
        token,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      },
      update: {
        role: dto.role,
        token,
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        acceptedAt: null,
      },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "workspace.member_invited",
      targetType: "WorkspaceInvitation",
      targetId: invitation.id,
      metadata: { email: dto.email, role: dto.role },
    });

    return invitation;
  }

  async acceptInvitation(token: string, userId: string, userEmail: string) {
    const invitation = await this.prisma.workspaceInvitation.findUnique({ where: { token } });
    if (!invitation) {
      throw new NotFoundException("Invitation not found");
    }
    if (invitation.acceptedAt) {
      throw new ConflictException("Invitation has already been accepted");
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException("Invitation has expired");
    }
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException("This invitation was issued to a different email address");
    }

    const membership = await this.prisma.$transaction(async (tx) => {
      const member = await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
        create: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
        update: { role: invitation.role },
      });
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      return member;
    });

    await this.auditService.record({
      workspaceId: invitation.workspaceId,
      actorUserId: userId,
      action: "workspace.member_joined",
      targetType: "WorkspaceMember",
      targetId: membership.id,
      metadata: { role: membership.role },
    });

    return membership;
  }

  async changeMemberRole(workspaceId: string, actorUserId: string, targetUserId: string, newRole: WorkspaceRole) {
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException("Member not found in this workspace");
    }
    if (target.role === WorkspaceRole.OWNER) {
      throw new ForbiddenException("Ownership must be transferred explicitly, not changed via role update");
    }
    if (newRole === WorkspaceRole.OWNER) {
      throw new BadRequestException("Use the transfer-ownership action to grant ownership");
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { id: target.id },
      data: { role: newRole },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "workspace.member_role_changed",
      targetType: "WorkspaceMember",
      targetId: updated.id,
      metadata: { from: target.role, to: newRole },
    });

    return updated;
  }

  async removeMember(workspaceId: string, actorUserId: string, targetUserId: string) {
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException("Member not found in this workspace");
    }
    if (target.role === WorkspaceRole.OWNER) {
      throw new ForbiddenException("The workspace owner cannot be removed");
    }

    await this.prisma.workspaceMember.delete({ where: { id: target.id } });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "workspace.member_removed",
      targetType: "WorkspaceMember",
      targetId: target.id,
      metadata: { removedUserId: targetUserId },
    });
  }
}
