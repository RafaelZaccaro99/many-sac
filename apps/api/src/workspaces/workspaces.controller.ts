import { Body, Controller, Get, Param, Patch, Post, Delete, UseGuards } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { WorkspacesService } from "./workspaces.service";
import { CreateWorkspaceDto } from "./dto/create-workspace.dto";
import { InviteMemberDto } from "./dto/invite-member.dto";
import { ChangeRoleDto } from "./dto/change-role.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { WorkspaceRolesGuard } from "../common/guards/workspace-roles.guard";
import { WorkspaceRoles } from "../common/decorators/workspace-roles.decorator";
import { CurrentUser, RequestUser } from "../common/decorators/current-user.decorator";

const ANY_MEMBER = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.BUILDER,
  WorkspaceRole.AGENT,
  WorkspaceRole.ANALYST,
];
const MANAGE_MEMBERS = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN];

@UseGuards(JwtAuthGuard)
@Controller()
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post("workspaces")
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateWorkspaceDto) {
    return this.workspacesService.create(user.id, dto);
  }

  @Get("workspaces")
  listMine(@CurrentUser() user: RequestUser) {
    return this.workspacesService.listForUser(user.id);
  }

  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(...ANY_MEMBER)
  @Get("workspaces/:workspaceId/members")
  listMembers(@Param("workspaceId") workspaceId: string) {
    return this.workspacesService.listMembers(workspaceId);
  }

  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(...MANAGE_MEMBERS)
  @Post("workspaces/:workspaceId/invitations")
  invite(
    @Param("workspaceId") workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: InviteMemberDto,
  ) {
    return this.workspacesService.invite(workspaceId, user.id, dto);
  }

  @Post("workspaces/invitations/:token/accept")
  acceptInvitation(@Param("token") token: string, @CurrentUser() user: RequestUser) {
    return this.workspacesService.acceptInvitation(token, user.id, user.email);
  }

  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(WorkspaceRole.OWNER)
  @Patch("workspaces/:workspaceId/members/:userId/role")
  changeRole(
    @Param("workspaceId") workspaceId: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.workspacesService.changeMemberRole(workspaceId, user.id, targetUserId, dto.role);
  }

  @UseGuards(WorkspaceRolesGuard)
  @WorkspaceRoles(...MANAGE_MEMBERS)
  @Delete("workspaces/:workspaceId/members/:userId")
  removeMember(
    @Param("workspaceId") workspaceId: string,
    @Param("userId") targetUserId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.workspacesService.removeMember(workspaceId, user.id, targetUserId);
  }
}
