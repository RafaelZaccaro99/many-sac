import { BadRequestException } from "@nestjs/common";
import { AutomationVersionStatus } from "@prisma/client";
import { AutomationsService, InvalidGraphShapeError } from "./automations.service";
import { AutomationNodeType } from "./graph.types";

const VALID_GRAPH = {
  nodes: [
    { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
    { id: "e1", type: AutomationNodeType.END, data: {} },
  ],
  edges: [{ id: "e-t1-e1", source: "t1", target: "e1" }],
};

function buildService() {
  const automations = new Map<string, any>();
  const versions = new Map<string, any>();
  let versionSeq = 1;

  function versionsFor(automationId: string) {
    return [...versions.values()].filter((v) => v.automationId === automationId);
  }

  const txHandle = {
    automation: {
      create: jest.fn(async ({ data }: any) => {
        const automation = { id: `auto-${automations.size + 1}`, ...data };
        automations.set(automation.id, automation);
        return automation;
      }),
    },
    automationVersion: {
      create: jest.fn(async ({ data }: any) => {
        const version = { id: `ver-${versionSeq++}`, publishedAt: null, ...data };
        versions.set(version.id, version);
        return version;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const version = versions.get(where.id);
        Object.assign(version, data);
        return version;
      }),
    },
  };

  const prisma = {
    $transaction: jest.fn(async (fn: any) => fn(txHandle)),
    automation: {
      findFirst: jest.fn(async ({ where }: any) => {
        const automation = automations.get(where.id);
        if (!automation || automation.workspaceId !== where.workspaceId) return null;
        return { ...automation, versions: versionsFor(automation.id).sort((a, b) => b.versionNumber - a.versionNumber) };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...automations.values()]
          .filter((a) => a.workspaceId === where.workspaceId)
          .map((a) => ({ ...a, versions: versionsFor(a.id) })),
      ),
    },
    automationVersion: txHandle.automationVersion,
    customFieldDefinition: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;

  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new AutomationsService(prisma, auditService);
  return { service, prisma };
}

describe("AutomationsService", () => {
  it("creates an automation with an empty draft version", async () => {
    const { service } = buildService();
    const automation = await service.create("ws-1", "user-1", { name: "Welcome flow" });
    expect(automation.name).toBe("Welcome flow");

    const loaded = await service.getOne("ws-1", automation.id);
    expect(loaded.versions).toHaveLength(1);
    expect(loaded.versions[0].status).toBe(AutomationVersionStatus.DRAFT);
    expect(loaded.versions[0].graph).toEqual({ nodes: [], edges: [] });
  });

  it("rejects a graph that isn't shaped like {nodes, edges}", async () => {
    const { service } = buildService();
    const automation = await service.create("ws-1", "user-1", { name: "Flow" });

    await expect(service.updateDraft("ws-1", automation.id, "user-1", { nope: true })).rejects.toBeInstanceOf(
      InvalidGraphShapeError,
    );
  });

  it("blocks publish when the graph is invalid and reports why", async () => {
    const { service } = buildService();
    const automation = await service.create("ws-1", "user-1", { name: "Flow" });
    await service.updateDraft("ws-1", automation.id, "user-1", { nodes: [], edges: [] });

    await expect(service.publish("ws-1", automation.id, "user-1")).rejects.toThrow(BadRequestException);
  });

  it("publishes a valid draft, freezes it, and opens a fresh draft copy", async () => {
    const { service } = buildService();
    const automation = await service.create("ws-1", "user-1", { name: "Flow" });
    await service.updateDraft("ws-1", automation.id, "user-1", VALID_GRAPH);

    const published = await service.publish("ws-1", automation.id, "user-1");
    expect(published.status).toBe(AutomationVersionStatus.PUBLISHED);
    expect(published.versionNumber).toBe(1);

    const loaded = await service.getOne("ws-1", automation.id);
    expect(loaded.versions).toHaveLength(2);
    const newDraft = loaded.versions.find((v: any) => v.status === AutomationVersionStatus.DRAFT)!;
    expect(newDraft.versionNumber).toBe(2);
    expect(newDraft.graph).toEqual(VALID_GRAPH);
  });

  it("never mutates a published version's graph after later draft edits", async () => {
    const { service } = buildService();
    const automation = await service.create("ws-1", "user-1", { name: "Flow" });
    await service.updateDraft("ws-1", automation.id, "user-1", VALID_GRAPH);
    const published = await service.publish("ws-1", automation.id, "user-1");

    const mutatedGraph = { ...VALID_GRAPH, nodes: [...VALID_GRAPH.nodes, { id: "extra", type: AutomationNodeType.ACTION, data: {} }] };
    await service.updateDraft("ws-1", automation.id, "user-1", mutatedGraph);

    const loaded = await service.getOne("ws-1", automation.id);
    const publishedVersion = loaded.versions.find((v: any) => v.id === published.id)!;
    expect(publishedVersion.graph).toEqual(VALID_GRAPH);
    expect(publishedVersion.status).toBe(AutomationVersionStatus.PUBLISHED);
  });

  it("archives the previous published version when a second version is published", async () => {
    const { service } = buildService();
    const automation = await service.create("ws-1", "user-1", { name: "Flow" });
    await service.updateDraft("ws-1", automation.id, "user-1", VALID_GRAPH);
    const firstPublished = await service.publish("ws-1", automation.id, "user-1");

    await service.updateDraft("ws-1", automation.id, "user-1", VALID_GRAPH);
    await service.publish("ws-1", automation.id, "user-1");

    const loaded = await service.getOne("ws-1", automation.id);
    const archived = loaded.versions.find((v: any) => v.id === firstPublished.id)!;
    expect(archived.status).toBe(AutomationVersionStatus.ARCHIVED);
    expect(loaded.versions.filter((v: any) => v.status === AutomationVersionStatus.PUBLISHED)).toHaveLength(1);
  });
});
