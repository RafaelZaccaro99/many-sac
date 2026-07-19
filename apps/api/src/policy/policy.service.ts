import { Injectable } from "@nestjs/common";
import { ChannelProvider, MessageDirection } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MetaAdapter } from "../channels/adapters/meta/meta.adapter";
import { MESSAGING_CONSENT_PURPOSE, PolicyDecision, PolicyDenialReason } from "./policy.types";

/**
 * Single gate every outbound message must pass through, whether it comes from
 * the automation runtime (ExecutionRunnerService) or a human agent replying
 * manually from the Inbox (ConversationsService) - so the rule only lives in
 * one place instead of being re-implemented per send path.
 */
@Injectable()
export class PolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metaAdapter: MetaAdapter,
  ) {}

  async canSend(contactId: string, channelConnectionId: string, provider: ChannelProvider): Promise<PolicyDecision> {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (contact?.optedOutAt) {
      return { allowed: false, reasonCode: PolicyDenialReason.OPTED_OUT };
    }

    const latestConsent = await this.prisma.contactConsent.findFirst({
      where: { contactId, channel: provider, purpose: MESSAGING_CONSENT_PURPOSE },
      orderBy: { createdAt: "desc" },
    });
    if (latestConsent?.revokedAt) {
      return { allowed: false, reasonCode: PolicyDenialReason.CONSENT_REVOKED };
    }

    const lastInboundAt = await this.getLastInboundAt(contactId, channelConnectionId);
    const window = this.metaAdapter.getMessagingWindow(lastInboundAt);
    if (!window.isOpen) {
      return { allowed: false, reasonCode: PolicyDenialReason.MESSAGING_WINDOW_CLOSED };
    }

    return { allowed: true, reasonCode: null };
  }

  private async getLastInboundAt(contactId: string, channelConnectionId: string): Promise<Date | null> {
    const lastInbound = await this.prisma.conversationMessage.findFirst({
      where: { direction: MessageDirection.IN, conversation: { contactId, channelConnectionId } },
      orderBy: { createdAt: "desc" },
    });
    return lastInbound?.createdAt ?? null;
  }
}
