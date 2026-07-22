import { NotFoundException } from "@nestjs/common";
import { WorkspacesService } from "./workspaces.service";

function buildService() {
  const workspaces = new Map<string, any>();
  workspaces.set("ws-1", { id: "ws-1", name: "Acme", slug: "acme", deletedAt: null });

  const prisma = {
    workspace: {
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => workspaces.get(where.id) ?? null),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        const workspace = workspaces.get(where.id);
        Object.assign(workspace, data);
        return workspace;
      }),
    },
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;

  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new WorkspacesService(prisma, auditService);
  return { service, prisma, auditService, workspaces };
}

describe("WorkspacesService.softDelete", () => {
  it("sets deletedAt and records an audit log entry", async () => {
    const { service, workspaces, auditService } = buildService();

    const result = await service.softDelete("ws-1", "user-1");

    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(workspaces.get("ws-1").deletedAt).toBeInstanceOf(Date);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", actorUserId: "user-1", action: "workspace.deleted" }),
    );
  });

  it("throws NotFoundException for a workspace that doesn't exist", async () => {
    const { service } = buildService();
    await expect(service.softDelete("does-not-exist", "user-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws NotFoundException when the workspace is already deleted (not idempotent)", async () => {
    const { service, workspaces } = buildService();
    workspaces.get("ws-1").deletedAt = new Date();

    await expect(service.softDelete("ws-1", "user-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("WorkspacesService.listForUser", () => {
  it("filters out soft-deleted workspaces at the query level", async () => {
    const { service, prisma } = buildService();

    await service.listForUser("user-1");

    expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-1", workspace: { deletedAt: null } } }),
    );
  });
});
