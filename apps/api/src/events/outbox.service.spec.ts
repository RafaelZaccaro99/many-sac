import { OutboxService } from "./outbox.service";
import { EventType } from "./event-types";

describe("OutboxService.enqueue", () => {
  it("writes through the provided transaction client, not the injected default", async () => {
    const txCreate = jest.fn().mockResolvedValue({ id: "outbox-1" });
    const tx = { outboxEvent: { create: txCreate } } as any;
    const defaultPrisma = { outboxEvent: { create: jest.fn() } } as any;

    const service = new OutboxService(defaultPrisma);
    await service.enqueue(tx, { workspaceId: "ws-1", eventType: EventType.CONTACT_MESSAGE_RECEIVED, payload: { a: 1 } });

    expect(txCreate).toHaveBeenCalledWith({
      data: { workspaceId: "ws-1", eventType: EventType.CONTACT_MESSAGE_RECEIVED, payload: { a: 1 } },
    });
    expect(defaultPrisma.outboxEvent.create).not.toHaveBeenCalled();
  });
});
