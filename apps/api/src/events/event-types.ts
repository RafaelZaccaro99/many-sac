/**
 * Canonical event catalog. Kept as a documented TypeScript const rather than a
 * database table - nothing in this system needs to add or edit an event type
 * at runtime yet, so a table would just be indirection without benefit.
 */
export const EventType = {
  CONTACT_MESSAGE_RECEIVED: "contact.message_received",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export interface ContactMessageReceivedPayload {
  contactId: string;
  workspaceId: string;
  channelConnectionId: string;
  inboundEventId: string;
  externalEventId: string;
  text?: string;
  occurredAt: string;
}

export interface OutboxEventEnvelope<T = unknown> {
  outboxEventId: string;
  workspaceId: string;
  eventType: EventType;
  payload: T;
}
