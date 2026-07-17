import { OutboxPublisherService } from "./outbox-publisher.service";

function buildPublisher(rows: any[]) {
  const updateCalls: any[] = [];
  const prisma = {
    outboxEvent: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn(async ({ where, data }: any) => {
        updateCalls.push({ where, data });
        const row = rows.find((r) => r.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      }),
    },
  } as any;

  const eventEmitter = { emitAsync: jest.fn().mockResolvedValue(undefined) } as any;
  const publisher = new OutboxPublisherService(prisma, eventEmitter);
  return { publisher, prisma, eventEmitter, updateCalls };
}

describe("OutboxPublisherService", () => {
  it("emits each unprocessed event and marks it processed", async () => {
    const rows = [
      { id: "evt-1", workspaceId: "ws-1", eventType: "contact.message_received", payload: { a: 1 }, attempts: 0 },
    ];
    const { publisher, eventEmitter, updateCalls } = buildPublisher(rows);

    await publisher.pollOnce();

    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      "contact.message_received",
      expect.objectContaining({ outboxEventId: "evt-1", workspaceId: "ws-1" }),
    );
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].data.processedAt).toBeInstanceOf(Date);
  });

  it("does not re-emit an event that findMany no longer returns (already processed)", async () => {
    const { publisher, prisma, eventEmitter } = buildPublisher([]);

    await publisher.pollOnce();

    expect(prisma.outboxEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { processedAt: null } }),
    );
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it("records the failure and retries later without crashing when a listener throws", async () => {
    const rows = [
      { id: "evt-1", workspaceId: "ws-1", eventType: "contact.message_received", payload: {}, attempts: 0 },
    ];
    const { publisher, eventEmitter, updateCalls } = buildPublisher(rows);
    eventEmitter.emitAsync.mockRejectedValueOnce(new Error("listener blew up"));

    await expect(publisher.pollOnce()).resolves.toBeUndefined();

    expect(updateCalls[0].data.attempts).toBe(1);
    expect(updateCalls[0].data.lastError).toContain("listener blew up");
    expect(updateCalls[0].data.processedAt).toBeNull();
  });

  it("gives up after the max attempts so a poison event stops blocking the queue", async () => {
    const rows = [
      { id: "evt-1", workspaceId: "ws-1", eventType: "contact.message_received", payload: {}, attempts: 4 },
    ];
    const { publisher, eventEmitter, updateCalls } = buildPublisher(rows);
    eventEmitter.emitAsync.mockRejectedValueOnce(new Error("still broken"));

    await publisher.pollOnce();

    expect(updateCalls[0].data.attempts).toBe(5);
    expect(updateCalls[0].data.processedAt).toBeInstanceOf(Date);
  });

  it("does not run two polls concurrently", async () => {
    let resolveEmit!: () => void;
    const rows = [
      { id: "evt-1", workspaceId: "ws-1", eventType: "contact.message_received", payload: {}, attempts: 0 },
    ];
    const { publisher, prisma, eventEmitter } = buildPublisher(rows);
    eventEmitter.emitAsync.mockReturnValue(new Promise<void>((resolve) => (resolveEmit = resolve)));

    const firstPoll = publisher.pollOnce();
    const secondPoll = publisher.pollOnce();
    resolveEmit();
    await Promise.all([firstPoll, secondPoll]);

    expect(prisma.outboxEvent.findMany).toHaveBeenCalledTimes(1);
  });
});
