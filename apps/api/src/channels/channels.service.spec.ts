import { randomBytes } from "crypto";
import { ConfigService } from "@nestjs/config";
import { ChannelConnectionStatus, ChannelProvider } from "@prisma/client";
import { ChannelsService } from "./channels.service";
import { MetaAdapter } from "./adapters/meta/meta.adapter";
import { CredentialsCipher } from "./credentials-cipher";
import { OutboxService } from "../events/outbox.service";
import { EventType } from "../events/event-types";

// A MESSENGER connection on purpose: webhook routing must find it by
// externalAccountId alone, not by assuming the adapter's INSTAGRAM provider.
const CONNECTION = {
  id: "conn-1",
  workspaceId: "ws-1",
  provider: ChannelProvider.MESSENGER,
  externalAccountId: "page-123",
  status: ChannelConnectionStatus.ACTIVE,
};

const META_PAYLOAD = {
  entry: [
    {
      id: "page-123",
      messaging: [
        {
          sender: { id: "user-456" },
          timestamp: 1700000001000,
          message: { mid: "mid-1", text: "hi there" },
        },
      ],
    },
  ],
};

function buildService() {
  const inboundEvents = new Map<string, true>();
  const contactIdentities = new Map<string, { contactId: string }>();
  const outboxCreateSpy = jest.fn();
  let nextContactId = 1;

  const prisma = {
    channelConnection: {
      findFirst: jest.fn().mockResolvedValue(CONNECTION),
    },
    $transaction: jest.fn(async (fn: any) => {
      const tx = {
        inboundEvent: {
          create: jest.fn(async ({ data }: any) => {
            const dedupeKey = `${data.channelConnectionId}:${data.externalEventId}`;
            if (inboundEvents.has(dedupeKey)) {
              const err: any = new Error("Unique constraint failed");
              err.code = "P2002";
              throw err;
            }
            inboundEvents.set(dedupeKey, true);
            return { id: `event-${dedupeKey}`, ...data };
          }),
        },
        contactIdentity: {
          findUnique: jest.fn(async ({ where }: any) => {
            const key = `${where.workspaceId_channel_externalId.workspaceId}:${where.workspaceId_channel_externalId.channel}:${where.workspaceId_channel_externalId.externalId}`;
            return contactIdentities.get(key) ?? null;
          }),
          create: jest.fn(async ({ data }: any) => {
            const key = `${data.workspaceId}:${data.channel}:${data.externalId}`;
            contactIdentities.set(key, { contactId: data.contactId });
            return { id: "identity-1", ...data };
          }),
        },
        contact: {
          create: jest.fn(async ({ data }: any) => ({ id: `contact-${nextContactId++}`, ...data })),
        },
        outboxEvent: {
          create: jest.fn(async ({ data }: any) => {
            outboxCreateSpy(data);
            return { id: "outbox-1", ...data };
          }),
        },
      };
      return fn(tx);
    }),
  } as any;

  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const credentialsCipher = new CredentialsCipher({
    getOrThrow: () => randomBytes(32).toString("base64"),
  } as unknown as ConfigService);
  const metaAdapter = new MetaAdapter({
    getOrThrow: (key: string) =>
      ({ META_APP_SECRET: "secret", META_WEBHOOK_VERIFY_TOKEN: "token" }[key] ?? ""),
  } as unknown as ConfigService);
  const outboxService = new OutboxService(prisma);

  const service = new ChannelsService(prisma, auditService, credentialsCipher, metaAdapter, outboxService);
  return { service, prisma, auditService, outboxCreateSpy };
}

describe("ChannelsService.processInboundWebhook", () => {
  it("creates one contact for a new event, reports it as accepted, and enqueues the canonical outbox event", async () => {
    const { service, prisma, outboxCreateSpy } = buildService();

    const result = await service.processInboundWebhook(META_PAYLOAD);

    expect(result).toEqual({ accepted: 1, duplicates: 0, unknownAccount: 0 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(outboxCreateSpy).toHaveBeenCalledTimes(1);
    expect(outboxCreateSpy.mock.calls[0][0]).toMatchObject({
      workspaceId: "ws-1",
      eventType: EventType.CONTACT_MESSAGE_RECEIVED,
    });
    // Routing must not pin the lookup to a provider: Messenger entries carry the
    // Page id while Instagram entries carry the IG account id, so the id alone
    // is the routing key.
    expect(prisma.channelConnection.findFirst).toHaveBeenCalledWith({
      where: { externalAccountId: "page-123" },
    });
  });

  it("does not create a duplicate contact or outbox event when the same webhook is replayed", async () => {
    const { service, prisma, outboxCreateSpy } = buildService();

    const first = await service.processInboundWebhook(META_PAYLOAD);
    const second = await service.processInboundWebhook(META_PAYLOAD);

    expect(first).toEqual({ accepted: 1, duplicates: 0, unknownAccount: 0 });
    expect(second).toEqual({ accepted: 0, duplicates: 1, unknownAccount: 0 });
    // The second delivery's transaction is attempted (and rolled back by the
    // dedupe constraint) - it must never leave a second contact or outbox row behind.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(outboxCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("resolves to the same existing contact identity on a second distinct message from the same sender", async () => {
    const { service, prisma, outboxCreateSpy } = buildService();

    await service.processInboundWebhook(META_PAYLOAD);

    const secondMessagePayload = {
      entry: [
        {
          id: "page-123",
          messaging: [
            {
              sender: { id: "user-456" },
              timestamp: 1700000005000,
              message: { mid: "mid-2", text: "second message" },
            },
          ],
        },
      ],
    };
    const result = await service.processInboundWebhook(secondMessagePayload);

    expect(result).toEqual({ accepted: 1, duplicates: 0, unknownAccount: 0 });
    // Two distinct messages -> two transactions, but only the first ever creates a contact.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(outboxCreateSpy).toHaveBeenCalledTimes(2);
    const contactIds = outboxCreateSpy.mock.calls.map((call) => (call[0].payload as any).contactId);
    expect(contactIds[0]).toBe(contactIds[1]);
  });

  it("counts events for unknown external accounts without touching contacts", async () => {
    const { service, prisma, outboxCreateSpy } = buildService();
    prisma.channelConnection.findFirst.mockResolvedValue(null);

    const result = await service.processInboundWebhook(META_PAYLOAD);

    expect(result).toEqual({ accepted: 0, duplicates: 0, unknownAccount: 1 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(outboxCreateSpy).not.toHaveBeenCalled();
  });
});
