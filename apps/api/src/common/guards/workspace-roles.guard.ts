import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WorkspaceRole } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { WORKSPACE_ROLES_KEY } from "../decorators/workspace-roles.decorator";

/**
 * Enforces workspace-scoped RBAC server-side. The route must have a
 * `workspaceId` path param; the guard loads the caller's membership for
 * that exact workspace and rejects if it doesn't exist or the role isn't
 * in the route's allow-list. This is the only source of truth for
 * authorization - the UI hiding a button is not a substitute.
 */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const allowedRoles = this.reflector.getAllAndOverride<WorkspaceRole[] | undefined>(WORKSPACE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!allowedRoles || allowedRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    const workspaceId: string | undefined = request.params?.workspaceId;

    if (!userId) {
      throw new UnauthorizedException();
    }
    if (!workspaceId) {
      throw new ForbiddenException("Route is missing a workspaceId param required for RBAC checks");
    }

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      include: { workspace: { select: { deletedAt: true } } },
    });

    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException("You do not have permission to perform this action in this workspace");
    }
    if (membership.workspace.deletedAt) {
      // Single choke point: every workspace-scoped route passes through this
      // guard, so a soft-deleted workspace becomes inaccessible everywhere
      // without each controller needing its own check.
      throw new ForbiddenException("This workspace has been deleted");
    }

    request.workspaceMembership = membership;
    return true;
  }
}
