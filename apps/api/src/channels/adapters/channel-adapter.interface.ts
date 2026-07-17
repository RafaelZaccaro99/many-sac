import { ChannelProvider } from "@prisma/client";

export interface NormalizedInboundMessage {
  externalEventId: string;
  externalAccountId: string;
  senderExternalId: string;
  senderDisplayName?: string;
  text?: string;
  attachments?: Array<{ type: string; url: string }>;
  occurredAt: Date;
  raw: unknown;
}

export interface MessagingWindow {
  isOpen: boolean;
  closesAt: Date | null;
  reasonCode: string;
}

export interface SendMessageInput {
  externalAccountId: string;
  recipientExternalId: string;
  text?: string;
  attachmentUrl?: string;
}

export interface SendMessageResult {
  providerMessageId: string;
  status: "sent" | "failed";
}

export interface ChannelCapabilities {
  supportsButtons: boolean;
  supportsQuickReplies: boolean;
  supportsMedia: boolean;
  maxTextLength: number;
}

/**
 * Common contract every channel integration must implement. Keeps provider-specific
 * payload shapes, auth, and messaging-window rules out of the automation runtime.
 */
export interface ChannelAdapter {
  readonly provider: ChannelProvider;

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  verifyWebhookChallenge(query: Record<string, string>): string | null;
  normalizeInboundEvents(payload: unknown): NormalizedInboundMessage[];
  getMessagingWindow(lastInboundAt: Date | null): MessagingWindow;
  getCapabilities(): ChannelCapabilities;
  sendMessage(input: SendMessageInput, credentials: string): Promise<SendMessageResult>;
}
