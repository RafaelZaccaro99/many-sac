import { SetMetadata } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";

export const WORKSPACE_ROLES_KEY = "workspaceRoles";

/**
 * Declares which workspace roles may call this route. Roles are checked
 * as an explicit allow-list (no implicit hierarchy) because permissions
 * differ in kind between roles, not just in level - e.g. Agent and Analyst
 * are lateral, narrow-scope roles rather than subsets of Builder.
 */
export const WorkspaceRoles = (...roles: WorkspaceRole[]) => SetMetadata(WORKSPACE_ROLES_KEY, roles);
