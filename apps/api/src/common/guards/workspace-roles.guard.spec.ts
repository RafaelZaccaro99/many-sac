import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { WorkspaceRole } from "@prisma/client";
import { WorkspaceRolesGuard } from "./workspace-roles.guard";

function buildContext(params: Record<string, string>, user?: { id: string }): ExecutionContext {
  const request: any = { params, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe("WorkspaceRolesGuard", () => {
  it("allows the request through when no roles are declared on the route", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const prisma = { workspaceMember: { findUnique: jest.fn() } } as any;
    const guard = new WorkspaceRolesGuard(reflector, prisma);

    const ctx = buildContext({ workspaceId: "ws-1" }, { id: "user-1" });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(prisma.workspaceMember.findUnique).not.toHaveBeenCalled();
  });

  it("rejects when there is no authenticated user", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([WorkspaceRole.ADMIN]) } as unknown as Reflector;
    const prisma = { workspaceMember: { findUnique: jest.fn() } } as any;
    const guard = new WorkspaceRolesGuard(reflector, prisma);

    const ctx = buildContext({ workspaceId: "ws-1" }, undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects when the route has no workspaceId param", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([WorkspaceRole.ADMIN]) } as unknown as Reflector;
    const prisma = { workspaceMember: { findUnique: jest.fn() } } as any;
    const guard = new WorkspaceRolesGuard(reflector, prisma);

    const ctx = buildContext({}, { id: "user-1" });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a member whose role is not in the allow-list (no implicit hierarchy)", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([WorkspaceRole.OWNER]) } as unknown as Reflector;
    const prisma = {
      workspaceMember: {
        findUnique: jest.fn().mockResolvedValue({ role: WorkspaceRole.ADMIN }),
      },
    } as any;
    const guard = new WorkspaceRolesGuard(reflector, prisma);

    const ctx = buildContext({ workspaceId: "ws-1" }, { id: "user-1" });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a user with no membership in the target workspace (cross-tenant access)", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([WorkspaceRole.AGENT]) } as unknown as Reflector;
    const prisma = { workspaceMember: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const guard = new WorkspaceRolesGuard(reflector, prisma);

    const ctx = buildContext({ workspaceId: "someone-elses-workspace" }, { id: "user-1" });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("allows a member whose role is explicitly listed", async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([WorkspaceRole.OWNER, WorkspaceRole.ADMIN]),
    } as unknown as Reflector;
    const prisma = {
      workspaceMember: { findUnique: jest.fn().mockResolvedValue({ role: WorkspaceRole.ADMIN }) },
    } as any;
    const guard = new WorkspaceRolesGuard(reflector, prisma);

    const ctx = buildContext({ workspaceId: "ws-1" }, { id: "user-1" });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
