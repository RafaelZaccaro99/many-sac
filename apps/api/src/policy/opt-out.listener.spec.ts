import { AutomationExecutionStatus } from "@prisma/client";
import { OptOutListener } from "./opt-out.listener";
import { ContactMessageReceivedPayload, EventType, OutboxEventEnvelope } from "../events/event-types";

function buildListener() {
  const contact = { id: "contact-1", optedOutAt: null as Date | null };
  const findUnique = jest.fn().mockImplementation(async () => ({ ...contact }));
  const update = jest.fn().mockImplementation(async ({ data }: any) => {
    Object.assign(contact, data);
    return contact;
  });
  const updateMany = jest.fn().mockResolvedValue({ count: 2 });

  const prisma = {
    contact: { findUnique, update, updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    automationExecution: { updateMany },
  } as any;

  const listener = new OptOutListener(prisma);
  return { listener, prisma, contact, findUnique, update, updateMany };
}

function envelope(text: string | undefined): OutboxEventEnvelope<ContactMessageReceivedPayload> {
  return {
    outboxEventId: "evt-1",
    workspaceId: "ws-1",
    eventType: EventType.CONTACT_MESSAGE_RECEIVED,
    payload: {
      contactId: "contact-1",
      workspaceId: "ws-1",
      channelConnectionId: "conn-1",
      inboundEventId: "in-1",
      externalEventId: "ext-1",
      text,
      occurredAt: new Date().toISOString(),
    },
  };
}

describe("OptOutListener", () => {
  it("opts the contact out and cancels non-terminal executions on a standalone opt-out keyword", async () => {
    const { listener, prisma, contact, updateMany } = buildListener();

    await listener.handleContactMessageReceived(envelope("por favor, pare de me mandar mensagens"));

    expect(contact.optedOutAt).toBeInstanceOf(Date);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId: "contact-1", status: { in: expect.arrayContaining([AutomationExecutionStatus.WAITING]) } },
        data: { status: AutomationExecutionStatus.CANCELED },
      }),
    );
    void prisma;
  });

  it("matches an exact opt-out keyword message", async () => {
    const { listener, contact } = buildListener();

    await listener.handleContactMessageReceived(envelope("PARAR"));

    expect(contact.optedOutAt).toBeInstanceOf(Date);
  });

  it("does not false-positive when the keyword is only a substring of another word", async () => {
    const { listener, contact, updateMany } = buildListener();

    await listener.handleContactMessageReceived(envelope("cancelaramento de pedido"));

    expect(contact.optedOutAt).toBeNull();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("is idempotent - does not re-cancel executions if the contact already opted out", async () => {
    const { listener, contact, updateMany } = buildListener();
    contact.optedOutAt = new Date("2026-01-01T00:00:00Z");

    await listener.handleContactMessageReceived(envelope("parar"));

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("clears optedOutAt on an opt-in keyword", async () => {
    const { listener, prisma } = buildListener();

    await listener.handleContactMessageReceived(envelope("quero voltar a receber"));

    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: { id: "contact-1", optedOutAt: { not: null } },
      data: { optedOutAt: null },
    });
  });

  it("does nothing for an unrelated message", async () => {
    const { listener, contact, update, updateMany } = buildListener();

    await listener.handleContactMessageReceived(envelope("qual o horário de vocês?"));

    expect(contact.optedOutAt).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does nothing for a message with no text", async () => {
    const { listener, update, updateMany } = buildListener();

    await listener.handleContactMessageReceived(envelope(undefined));

    expect(update).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
