import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { AutomationExecutionStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ContactMessageReceivedPayload, EventType, OutboxEventEnvelope } from "../events/event-types";

// Simple keyword-based detection, not an NLP intent classifier - matches the
// keyword as a standalone word so "pare" (stop) doesn't false-positive inside
// an unrelated sentence, but doesn't require an exact-match message either.
const OPT_OUT_KEYWORDS = ["parar", "pare", "sair", "cancelar", "stop", "unsubscribe"];
const OPT_IN_KEYWORDS = ["voltar", "iniciar", "start", "subscribe"];

const NON_TERMINAL_EXECUTION_STATUSES: AutomationExecutionStatus[] = [
  AutomationExecutionStatus.QUEUED,
  AutomationExecutionStatus.RUNNING,
  AutomationExecutionStatus.WAITING,
  AutomationExecutionStatus.FAILED_RETRYABLE,
];

/**
 * Reacts to contact.message_received (same event TriggerMatcherService and
 * ConversationsEventListener consume) to keep Contact.optedOutAt in sync and
 * cancel any automation still running for a contact who just opted out -
 * PolicyService.canSend is what actually blocks future sends.
 */
@Injectable()
export class OptOutListener {
  private readonly logger = new Logger(OptOutListener.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(EventType.CONTACT_MESSAGE_RECEIVED)
  async handleContactMessageReceived(envelope: OutboxEventEnvelope<ContactMessageReceivedPayload>): Promise<void> {
    const { contactId, text } = envelope.payload;
    const normalized = normalize(text);
    if (!normalized) return;

    if (matchesAny(normalized, OPT_OUT_KEYWORDS)) {
      await this.optOut(contactId);
      return;
    }
    if (matchesAny(normalized, OPT_IN_KEYWORDS)) {
      await this.optIn(contactId);
    }
  }

  private async optOut(contactId: string): Promise<void> {
    const contact = await this.prisma.contact.findUnique({ where: { id: contactId } });
    if (contact?.optedOutAt) {
      return;
    }

    await this.prisma.contact.update({ where: { id: contactId }, data: { optedOutAt: new Date() } });
    const canceled = await this.prisma.automationExecution.updateMany({
      where: { contactId, status: { in: NON_TERMINAL_EXECUTION_STATUSES } },
      data: { status: AutomationExecutionStatus.CANCELED },
    });
    this.logger.log(`Contact ${contactId} opted out - canceled ${canceled.count} in-flight execution(s)`);
  }

  private async optIn(contactId: string): Promise<void> {
    await this.prisma.contact.updateMany({
      where: { id: contactId, optedOutAt: { not: null } },
      data: { optedOutAt: null },
    });
  }
}

function normalize(text: string | undefined): string {
  return (text ?? "").trim().toLowerCase();
}

function matchesAny(normalizedText: string, keywords: string[]): boolean {
  return keywords.some((keyword) => new RegExp(`(^|\\W)${keyword}(\\W|$)`).test(normalizedText));
}
