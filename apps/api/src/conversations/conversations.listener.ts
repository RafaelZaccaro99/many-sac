import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ContactMessageReceivedPayload, EventType, OutboxEventEnvelope } from "../events/event-types";
import { ConversationsService } from "./conversations.service";

/**
 * Reacts to the canonical contact.message_received event (same outbox-published
 * event TriggerMatcherService listens to) to keep the Inbox's conversation
 * history in sync, without coupling ChannelsService's webhook transaction to
 * the Conversation model.
 */
@Injectable()
export class ConversationsEventListener {
  constructor(private readonly conversationsService: ConversationsService) {}

  @OnEvent(EventType.CONTACT_MESSAGE_RECEIVED)
  async handleContactMessageReceived(envelope: OutboxEventEnvelope<ContactMessageReceivedPayload>): Promise<void> {
    const payload = envelope.payload;
    await this.conversationsService.recordInboundMessage(
      payload.workspaceId,
      payload.contactId,
      payload.channelConnectionId,
      payload.text,
      payload.externalEventId,
    );
  }
}
