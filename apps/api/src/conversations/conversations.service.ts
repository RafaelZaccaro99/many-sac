import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AutomationExecutionStatus, ConversationStatus, MessageDirection, MessageSenderType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { CredentialsCipher } from "../channels/credentials-cipher";
import { MetaAdapter } from "../channels/adapters/meta/meta.adapter";
import { ExecutionQueueService } from "../automations/execution/execution-queue.service";
import { PolicyService } from "../policy/policy.service";
import { POLICY_DENIAL_MESSAGES } from "../policy/policy.types";

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly credentialsCipher: CredentialsCipher,
    private readonly metaAdapter: MetaAdapter,
    private readonly executionQueue: ExecutionQueueService,
    private readonly policyService: PolicyService,
  ) {}

  async list(workspaceId: string, filters: { status?: ConversationStatus; assignedToUserId?: string }) {
    return this.prisma.conversation.findMany({
      where: { workspaceId, status: filters.status, assignedToUserId: filters.assignedToUserId },
      orderBy: { lastMessageAt: "desc" },
      include: { contact: true, channelConnection: true, assignedTo: true },
    });
  }

  async getOne(workspaceId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      include: {
        contact: true,
        channelConnection: true,
        assignedTo: true,
        messages: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!conversation) {
      throw new NotFoundException("Conversation not found in this workspace");
    }
    return conversation;
  }

  async listMessages(workspaceId: string, conversationId: string, take = 50, skip = 0) {
    await this.getConversationOrThrow(workspaceId, conversationId);
    return this.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: Math.min(take, 200),
      skip,
    });
  }

  /** Agent replies manually from the Inbox - sent for real via the channel adapter, same as the runtime's send_message node. */
  async sendMessage(workspaceId: string, conversationId: string, actorUserId: string, body: string) {
    const conversation = await this.getConversationOrThrow(workspaceId, conversationId);
    if (conversation.status === ConversationStatus.CLOSED) {
      throw new ForbiddenException("Cannot send a message in a closed conversation");
    }

    const decision = await this.policyService.canSend(
      conversation.contactId,
      conversation.channelConnectionId,
      conversation.channelConnection.provider,
    );
    if (!decision.allowed) {
      throw new ForbiddenException(POLICY_DENIAL_MESSAGES[decision.reasonCode!]);
    }

    const identity = await this.prisma.contactIdentity.findFirst({
      where: { workspaceId, contactId: conversation.contactId, channel: conversation.channelConnection.provider },
    });
    if (!identity) {
      throw new NotFoundException("No channel identity found for this contact");
    }

    const credentials = this.credentialsCipher.decrypt(conversation.channelConnection.credentialsEncrypted);
    const result = await this.metaAdapter.sendMessage(
      { externalAccountId: conversation.channelConnection.externalAccountId, recipientExternalId: identity.externalId, text: body },
      credentials,
    );

    const message = await this.prisma.conversationMessage.create({
      data: {
        conversationId,
        direction: MessageDirection.OUT,
        senderType: MessageSenderType.AGENT,
        senderUserId: actorUserId,
        body,
        externalMessageId: result.providerMessageId || undefined,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        status: conversation.status === ConversationStatus.WAITING_HUMAN ? ConversationStatus.HUMAN : conversation.status,
        assignedToUserId: conversation.assignedToUserId ?? actorUserId,
      },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "conversation.message_sent",
      targetType: "Conversation",
      targetId: conversationId,
    });

    return message;
  }

  async claim(workspaceId: string, conversationId: string, actorUserId: string) {
    const conversation = await this.getConversationOrThrow(workspaceId, conversationId);
    if (conversation.status === ConversationStatus.CLOSED) {
      throw new ForbiddenException("Cannot claim a closed conversation");
    }

    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { assignedToUserId: actorUserId, status: ConversationStatus.HUMAN },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "conversation.claimed",
      targetType: "Conversation",
      targetId: conversationId,
    });

    return updated;
  }

  async close(workspaceId: string, conversationId: string, actorUserId: string) {
    await this.getConversationOrThrow(workspaceId, conversationId);
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.CLOSED, closedAt: new Date() },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "conversation.closed",
      targetType: "Conversation",
      targetId: conversationId,
    });

    return updated;
  }

  /** Hands the conversation back to the bot and re-enqueues any automation execution left WAITING at the human_handoff node. */
  async resume(workspaceId: string, conversationId: string, actorUserId: string) {
    const conversation = await this.getConversationOrThrow(workspaceId, conversationId);
    if (conversation.status === ConversationStatus.CLOSED) {
      throw new ForbiddenException("Cannot resume a closed conversation");
    }

    const waitingExecutions = await this.prisma.automationExecution.findMany({
      where: { conversationId, status: AutomationExecutionStatus.WAITING },
    });

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.BOT },
    });

    for (const execution of waitingExecutions) {
      await this.prisma.automationExecution.update({
        where: { id: execution.id },
        data: { status: AutomationExecutionStatus.QUEUED },
      });
      await this.executionQueue.enqueueStep(execution.id, 0);
    }

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "conversation.resumed",
      targetType: "Conversation",
      targetId: conversationId,
      metadata: { resumedExecutions: waitingExecutions.length },
    });

    return { resumedExecutions: waitingExecutions.length };
  }

  /** Called by ExecutionRunnerService when a human_handoff node runs. */
  async openForHandoff(workspaceId: string, contactId: string, channelConnectionId: string): Promise<string> {
    const conversation = await this.findOrCreateOpenConversation(workspaceId, contactId, channelConnectionId);
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { status: ConversationStatus.WAITING_HUMAN },
    });
    return conversation.id;
  }

  /** Called by the contact.message_received event listener - appends every inbound message to its conversation. */
  async recordInboundMessage(
    workspaceId: string,
    contactId: string,
    channelConnectionId: string,
    body: string | undefined,
    externalMessageId: string,
  ): Promise<void> {
    const conversation = await this.findOrCreateOpenConversation(workspaceId, contactId, channelConnectionId);

    await this.prisma.conversationMessage.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.IN,
        senderType: MessageSenderType.CONTACT,
        body: body ?? "",
        externalMessageId,
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  private async findOrCreateOpenConversation(workspaceId: string, contactId: string, channelConnectionId: string) {
    const existing = await this.prisma.conversation.findFirst({
      where: { workspaceId, contactId, channelConnectionId, status: { not: ConversationStatus.CLOSED } },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.conversation.create({
      data: { workspaceId, contactId, channelConnectionId, status: ConversationStatus.BOT },
    });
  }

  private async getConversationOrThrow(workspaceId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, workspaceId },
      include: { channelConnection: true },
    });
    if (!conversation) {
      throw new NotFoundException("Conversation not found in this workspace");
    }
    return conversation;
  }
}
