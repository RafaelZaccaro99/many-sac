import { ConflictException, Injectable, Logger } from "@nestjs/common";
import { ChannelConnectionStatus, Prisma } from "@prisma/client";
import * as crypto from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { OutboxService } from "../events/outbox.service";
import { EventType, ContactMessageReceivedPayload } from "../events/event-types";
import { CredentialsCipher } from "./credentials-cipher";
import { MetaAdapter } from "./adapters/meta/meta.adapter";
import { ConnectChannelDto } from "./dto/connect-channel.dto";
import { NormalizedInboundMessage } from "./adapters/channel-adapter.interface";

export interface ProcessWebhookResult {
  accepted: number;
  duplicates: number;
  unknownAccount: number;
}

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly credentialsCipher: CredentialsCipher,
    private readonly metaAdapter: MetaAdapter,
    private readonly outboxService: OutboxService,
  ) {}

  async connect(workspaceId: string, actorUserId: string, dto: ConnectChannelDto) {
    const existing = await this.prisma.channelConnection.findUnique({
      where: { provider_externalAccountId: { provider: dto.provider, externalAccountId: dto.externalAccountId } },
    });
    if (existing) {
      throw new ConflictException("This account is already connected to a workspace");
    }

    const connection = await this.prisma.channelConnection.create({
      data: {
        workspaceId,
        provider: dto.provider,
        externalAccountId: dto.externalAccountId,
        displayName: dto.displayName,
        credentialsEncrypted: this.credentialsCipher.encrypt(dto.accessToken),
        status: ChannelConnectionStatus.ACTIVE,
      },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "channel.connected",
      targetType: "ChannelConnection",
      targetId: connection.id,
      metadata: { provider: dto.provider, externalAccountId: dto.externalAccountId },
    });

    return { id: connection.id, provider: connection.provider, externalAccountId: connection.externalAccountId, status: connection.status };
  }

  async listConnections(workspaceId: string) {
    const connections = await this.prisma.channelConnection.findMany({ where: { workspaceId } });
    return connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      externalAccountId: c.externalAccountId,
      displayName: c.displayName,
      status: c.status,
      createdAt: c.createdAt,
    }));
  }

  verifyWebhookChallenge(query: Record<string, string>): string | null {
    return this.metaAdapter.verifyWebhookChallenge(query);
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    return this.metaAdapter.verifyWebhookSignature(rawBody, signatureHeader);
  }

  /**
   * Idempotently ingests a verified Meta webhook payload: each normalized event is
   * deduped on (channelConnectionId, externalEventId) before any contact is
   * created or updated, so retried/replayed deliveries never duplicate data.
   */
  async processInboundWebhook(payload: unknown): Promise<ProcessWebhookResult> {
    const events = this.metaAdapter.normalizeInboundEvents(payload);
    const result: ProcessWebhookResult = { accepted: 0, duplicates: 0, unknownAccount: 0 };

    for (const event of events) {
      const connection = await this.prisma.channelConnection.findUnique({
        where: {
          provider_externalAccountId: { provider: this.metaAdapter.provider, externalAccountId: event.externalAccountId },
        },
      });

      if (!connection) {
        this.logger.warn(`Received webhook for unknown external account ${event.externalAccountId}`);
        result.unknownAccount++;
        continue;
      }

      const wasProcessed = await this.ingestEvent(connection.id, connection.workspaceId, event);
      if (wasProcessed) {
        result.accepted++;
      } else {
        result.duplicates++;
      }
    }

    return result;
  }

  /**
   * Records the inbound event, resolves/creates the contact, and enqueues the
   * canonical `contact.message_received` outbox row all inside one transaction -
   * so a crash or dedupe-triggered rollback never leaves a contact created
   * without a corresponding published event, or vice versa.
   */
  private async ingestEvent(
    channelConnectionId: string,
    workspaceId: string,
    event: NormalizedInboundMessage,
  ): Promise<boolean> {
    const payloadHash = crypto.createHash("sha256").update(JSON.stringify(event.raw)).digest("hex");
    let contactCreated = false;
    let createdContactId: string | null = null;

    try {
      await this.prisma.$transaction(async (tx) => {
        const inboundEvent = await tx.inboundEvent.create({
          data: {
            workspaceId,
            channelConnectionId,
            provider: this.metaAdapter.provider,
            externalEventId: event.externalEventId,
            payloadHash,
          },
        });

        const { contactId, wasCreated } = await this.resolveOrCreateContact(tx, workspaceId, event);
        contactCreated = wasCreated;
        createdContactId = wasCreated ? contactId : null;

        const payload: ContactMessageReceivedPayload = {
          contactId,
          workspaceId,
          channelConnectionId,
          inboundEventId: inboundEvent.id,
          externalEventId: event.externalEventId,
          text: event.text,
          occurredAt: event.occurredAt.toISOString(),
        };
        await this.outboxService.enqueue(tx, {
          workspaceId,
          eventType: EventType.CONTACT_MESSAGE_RECEIVED,
          payload,
        });

        return { contactId, wasCreated };
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        // Unique constraint on (channelConnectionId, externalEventId): already processed.
        return false;
      }
      throw err;
    }

    if (contactCreated) {
      await this.auditService.record({
        workspaceId,
        actorUserId: null,
        action: "contact.created_from_webhook",
        targetType: "Contact",
        targetId: createdContactId,
        metadata: { provider: this.metaAdapter.provider, externalId: event.senderExternalId },
      });
    }

    return true;
  }

  private async resolveOrCreateContact(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    event: NormalizedInboundMessage,
  ): Promise<{ contactId: string; wasCreated: boolean }> {
    const existingIdentity = await tx.contactIdentity.findUnique({
      where: {
        workspaceId_channel_externalId: {
          workspaceId,
          channel: this.metaAdapter.provider,
          externalId: event.senderExternalId,
        },
      },
    });

    if (existingIdentity) {
      return { contactId: existingIdentity.contactId, wasCreated: false };
    }

    const created = await tx.contact.create({
      data: { workspaceId, firstName: event.senderDisplayName ?? null },
    });
    await tx.contactIdentity.create({
      data: {
        contactId: created.id,
        workspaceId,
        channel: this.metaAdapter.provider,
        externalId: event.senderExternalId,
        displayName: event.senderDisplayName,
      },
    });

    return { contactId: created.id, wasCreated: true };
  }
}
