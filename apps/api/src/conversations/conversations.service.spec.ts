import { AutomationExecutionStatus, ChannelProvider, ConversationStatus, MessageDirection, MessageSenderType } from "@prisma/client";
import { ConversationsService } from "./conversations.service";

const CHANNEL_CONNECTION = {
  id: "conn-1",
  provider: ChannelProvider.INSTAGRAM,
  externalAccountId: "page-123",
  credentialsEncrypted: "enc-token",
};

function buildService() {
  let convSeq = 1;
  let msgSeq = 1;
  const conversations = new Map<string, any>();
  const messages: any[] = [];
  const executions = new Map<string, any>();

  const prisma = {
    conversation: {
      findFirst: jest.fn(async ({ where }: any) => {
        const list = [...conversations.values()];
        const match = list.find((c) => {
          if (where.id && c.id !== where.id) return false;
          if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
          if (where.contactId && c.contactId !== where.contactId) return false;
          if (where.channelConnectionId && c.channelConnectionId !== where.channelConnectionId) return false;
          if (where.status?.not && c.status === where.status.not) return false;
          return true;
        });
        return match ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...conversations.values()].filter((c) => {
          if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
          if (where.status && c.status !== where.status) return false;
          if (where.assignedToUserId && c.assignedToUserId !== where.assignedToUserId) return false;
          return true;
        }),
      ),
      create: jest.fn(async ({ data }: any) => {
        const conversation = {
          id: `conv-${convSeq++}`,
          lastMessageAt: null,
          assignedToUserId: null,
          closedAt: null,
          channelConnection: CHANNEL_CONNECTION,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        conversations.set(conversation.id, conversation);
        return conversation;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const conversation = conversations.get(where.id);
        Object.assign(conversation, data);
        return conversation;
      }),
    },
    conversationMessage: {
      create: jest.fn(async ({ data }: any) => {
        const message = { id: `msg-${msgSeq++}`, createdAt: new Date(), ...data };
        messages.push(message);
        return message;
      }),
    },
    contactIdentity: {
      findFirst: jest.fn().mockResolvedValue({ externalId: "user-456" }),
    },
    automationExecution: {
      findMany: jest.fn(async ({ where }: any) =>
        [...executions.values()].filter((e) => e.conversationId === where.conversationId && e.status === where.status),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const execution = executions.get(where.id);
        Object.assign(execution, data);
        return execution;
      }),
    },
  } as any;

  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as any;
  const credentialsCipher = { decrypt: jest.fn().mockReturnValue("decrypted-token") } as any;
  const metaAdapter = { sendMessage: jest.fn().mockResolvedValue({ providerMessageId: "mid-1", status: "sent" }) } as any;
  const executionQueue = { enqueueStep: jest.fn().mockResolvedValue(undefined) } as any;
  const policyService = { canSend: jest.fn().mockResolvedValue({ allowed: true, reasonCode: null }) } as any;

  const service = new ConversationsService(prisma, auditService, credentialsCipher, metaAdapter, executionQueue, policyService);
  return { service, prisma, conversations, messages, executions, metaAdapter, executionQueue, policyService };
}

function seedConversation(conversations: Map<string, any>, overrides: Partial<any> = {}) {
  const conversation = {
    id: "conv-seed",
    workspaceId: "ws-1",
    contactId: "contact-1",
    channelConnectionId: "conn-1",
    status: ConversationStatus.BOT,
    assignedToUserId: null,
    lastMessageAt: null,
    closedAt: null,
    channelConnection: CHANNEL_CONNECTION,
    ...overrides,
  };
  conversations.set(conversation.id, conversation);
  return conversation;
}

describe("ConversationsService", () => {
  it("reuses the existing open conversation instead of creating a new one on a second inbound message", async () => {
    const { service, prisma, messages } = buildService();

    await service.recordInboundMessage("ws-1", "contact-1", "conn-1", "hi", "ext-1");
    await service.recordInboundMessage("ws-1", "contact-1", "conn-1", "again", "ext-2");

    expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ direction: MessageDirection.IN, senderType: MessageSenderType.CONTACT, body: "hi" });
  });

  it("does not reuse a closed conversation - a new inbound message opens a fresh one", async () => {
    const { service, prisma, conversations } = buildService();
    seedConversation(conversations, { id: "conv-old", status: ConversationStatus.CLOSED });

    await service.recordInboundMessage("ws-1", "contact-1", "conn-1", "hi again", "ext-3");

    expect(prisma.conversation.create).toHaveBeenCalledTimes(1);
    expect(conversations.size).toBe(2);
  });

  it("openForHandoff creates the conversation if none exists and marks it WAITING_HUMAN", async () => {
    const { service, conversations } = buildService();

    const conversationId = await service.openForHandoff("ws-1", "contact-1", "conn-1");

    expect(conversations.get(conversationId)).toMatchObject({ status: ConversationStatus.WAITING_HUMAN });
  });

  it("sendMessage sends via the channel adapter, records an OUT/AGENT message, and flips WAITING_HUMAN to HUMAN", async () => {
    const { service, conversations, messages, metaAdapter } = buildService();
    seedConversation(conversations, { status: ConversationStatus.WAITING_HUMAN });

    const message = await service.sendMessage("ws-1", "conv-seed", "user-1", "we're on it");

    expect(metaAdapter.sendMessage).toHaveBeenCalledWith(
      { externalAccountId: "page-123", recipientExternalId: "user-456", text: "we're on it" },
      "decrypted-token",
    );
    expect(message).toMatchObject({ direction: MessageDirection.OUT, senderType: MessageSenderType.AGENT, senderUserId: "user-1" });
    expect(messages).toHaveLength(1);
    expect(conversations.get("conv-seed")).toMatchObject({ status: ConversationStatus.HUMAN, assignedToUserId: "user-1" });
  });

  it("sendMessage rejects when the conversation is closed", async () => {
    const { service, conversations } = buildService();
    seedConversation(conversations, { status: ConversationStatus.CLOSED });

    await expect(service.sendMessage("ws-1", "conv-seed", "user-1", "too late")).rejects.toThrow();
  });

  it("sendMessage rejects and never calls the channel adapter when the Policy Engine denies the send", async () => {
    const { service, conversations, metaAdapter, policyService } = buildService();
    seedConversation(conversations, { status: ConversationStatus.HUMAN });
    policyService.canSend.mockResolvedValue({ allowed: false, reasonCode: "MESSAGING_WINDOW_CLOSED" });

    await expect(service.sendMessage("ws-1", "conv-seed", "user-1", "too late")).rejects.toThrow(/window/i);
    expect(metaAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it("claim assigns the conversation to the acting user and marks it HUMAN", async () => {
    const { service, conversations } = buildService();
    seedConversation(conversations);

    await service.claim("ws-1", "conv-seed", "user-1");

    expect(conversations.get("conv-seed")).toMatchObject({ status: ConversationStatus.HUMAN, assignedToUserId: "user-1" });
  });

  it("close marks the conversation CLOSED with a closedAt timestamp", async () => {
    const { service, conversations } = buildService();
    seedConversation(conversations);

    await service.close("ws-1", "conv-seed", "user-1");

    const updated = conversations.get("conv-seed");
    expect(updated.status).toBe(ConversationStatus.CLOSED);
    expect(updated.closedAt).toBeInstanceOf(Date);
  });

  it("resume flips the conversation back to BOT and re-enqueues only the executions WAITING on it", async () => {
    const { service, conversations, executions, executionQueue } = buildService();
    seedConversation(conversations, { status: ConversationStatus.HUMAN });
    executions.set("exec-a", { id: "exec-a", conversationId: "conv-seed", status: AutomationExecutionStatus.WAITING });
    executions.set("exec-b", { id: "exec-b", conversationId: "conv-other", status: AutomationExecutionStatus.WAITING });

    const result = await service.resume("ws-1", "conv-seed", "user-1");

    expect(result).toEqual({ resumedExecutions: 1 });
    expect(executionQueue.enqueueStep).toHaveBeenCalledTimes(1);
    expect(executionQueue.enqueueStep).toHaveBeenCalledWith("exec-a", 0);
    expect(executions.get("exec-a")).toMatchObject({ status: AutomationExecutionStatus.QUEUED });
    expect(executions.get("exec-b")).toMatchObject({ status: AutomationExecutionStatus.WAITING });
    expect(conversations.get("conv-seed")).toMatchObject({ status: ConversationStatus.BOT });
  });
});
