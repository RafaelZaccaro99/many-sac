import * as crypto from "crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChannelProvider } from "@prisma/client";
import {
  ChannelAdapter,
  ChannelCapabilities,
  MessagingWindow,
  NormalizedInboundMessage,
  SendMessageInput,
  SendMessageResult,
} from "../channel-adapter.interface";

// Meta's standard messaging window at time of writing. This is a provider policy,
// not a law - it changes independently of this code, so it must stay isolated here
// (and ultimately be superseded by the versioned Policy Engine planned for a later
// milestone) rather than assumed elsewhere in the codebase.
const STANDARD_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;
export const GRAPH_API_VERSION = "v19.0";
export const GRAPH_API_BASE_URL = "https://graph.facebook.com";

interface MetaMessagingEvent {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; attachments?: Array<{ type: string; payload?: { url?: string } }> };
}

interface MetaEntry {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEvent[];
}

interface MetaWebhookPayload {
  object?: string;
  entry?: MetaEntry[];
}

@Injectable()
export class MetaAdapter implements ChannelAdapter {
  readonly provider = ChannelProvider.INSTAGRAM;

  constructor(private readonly configService: ConfigService) {}

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader?.startsWith("sha256=")) {
      return false;
    }
    const appSecret = this.configService.getOrThrow<string>("META_APP_SECRET");
    const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
    const provided = signatureHeader.slice("sha256=".length);

    const expectedBuf = Buffer.from(expected, "hex");
    const providedBuf = Buffer.from(provided, "hex");
    if (expectedBuf.length !== providedBuf.length) {
      return false;
    }
    return crypto.timingSafeEqual(expectedBuf, providedBuf);
  }

  verifyWebhookChallenge(query: Record<string, string>): string | null {
    const verifyToken = this.configService.getOrThrow<string>("META_WEBHOOK_VERIFY_TOKEN");
    if (query["hub.mode"] === "subscribe" && query["hub.verify_token"] === verifyToken) {
      return query["hub.challenge"] ?? null;
    }
    return null;
  }

  normalizeInboundEvents(payload: unknown): NormalizedInboundMessage[] {
    const body = payload as MetaWebhookPayload;
    const results: NormalizedInboundMessage[] = [];

    for (const entry of body.entry ?? []) {
      const externalAccountId = entry.id;
      if (!externalAccountId) continue;

      for (const event of entry.messaging ?? []) {
        const senderExternalId = event.sender?.id;
        if (!senderExternalId || !event.message) continue;

        const externalEventId = event.message.mid ?? `${externalAccountId}:${senderExternalId}:${event.timestamp}`;

        results.push({
          externalEventId,
          externalAccountId,
          senderExternalId,
          text: event.message.text,
          attachments: (event.message.attachments ?? [])
            .filter((a) => a.payload?.url)
            .map((a) => ({ type: a.type, url: a.payload!.url! })),
          occurredAt: event.timestamp ? new Date(event.timestamp) : new Date(),
          raw: event,
        });
      }
    }

    return results;
  }

  getMessagingWindow(lastInboundAt: Date | null): MessagingWindow {
    if (!lastInboundAt) {
      return { isOpen: false, closesAt: null, reasonCode: "NO_PRIOR_INBOUND_MESSAGE" };
    }
    const closesAt = new Date(lastInboundAt.getTime() + STANDARD_MESSAGING_WINDOW_MS);
    const isOpen = closesAt.getTime() > Date.now();
    return { isOpen, closesAt, reasonCode: isOpen ? "WITHIN_WINDOW" : "MESSAGING_WINDOW_CLOSED" };
  }

  getCapabilities(): ChannelCapabilities {
    return {
      supportsButtons: true,
      supportsQuickReplies: true,
      supportsMedia: true,
      maxTextLength: 2000,
    };
  }

  /**
   * Subscribes the Page to this app so Meta starts delivering its message
   * webhooks. The app-level subscription (callback URL + fields) only tells
   * Meta *where* to deliver; each Page must additionally opt in via
   * /{page-id}/subscribed_apps or its DMs never reach the webhook at all.
   */
  async subscribePageToApp(pageId: string, pageAccessToken: string): Promise<void> {
    const url = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(pageId)}/subscribed_apps`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${pageAccessToken}` },
      body: JSON.stringify({ subscribed_fields: ["messages"] }),
    });
    const body = (await response.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
    if (!response.ok || body.success !== true) {
      throw new Error(`Meta page subscription failed: ${body.error?.message ?? "unknown error"}`);
    }
  }

  async sendMessage(input: SendMessageInput, credentials: string): Promise<SendMessageResult> {
    const message = input.attachmentUrl
      ? { attachment: { type: "image", payload: { url: input.attachmentUrl, is_reusable: true } } }
      : { text: input.text ?? "" };

    const url = `${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}/${encodeURIComponent(input.externalAccountId)}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${credentials}` },
      body: JSON.stringify({
        recipient: { id: input.recipientExternalId },
        message,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string } };

    if (!response.ok) {
      // Thrown so the caller's retry/backoff (BullMQ) can decide whether this is
      // transient (rate limit, timeout) or worth giving up on sooner.
      throw new Error(`Meta send failed (${response.status}): ${body.error?.message ?? "unknown error"}`);
    }

    return { providerMessageId: body.message_id ?? "", status: "sent" };
  }
}
