import * as crypto from "crypto";
import { ConfigService } from "@nestjs/config";
import { MetaAdapter } from "./meta.adapter";

const APP_SECRET = "test-app-secret";
const VERIFY_TOKEN = "test-verify-token";

function buildAdapter(): MetaAdapter {
  const config = {
    getOrThrow: (key: string) => {
      const values: Record<string, string> = {
        META_APP_SECRET: APP_SECRET,
        META_WEBHOOK_VERIFY_TOKEN: VERIFY_TOKEN,
      };
      if (!(key in values)) throw new Error(`missing config ${key}`);
      return values[key];
    },
  } as ConfigService;
  return new MetaAdapter(config);
}

function sign(body: Buffer): string {
  return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
}

describe("MetaAdapter", () => {
  describe("verifyWebhookSignature", () => {
    it("accepts a correctly signed body", () => {
      const adapter = buildAdapter();
      const body = Buffer.from(JSON.stringify({ hello: "world" }));
      expect(adapter.verifyWebhookSignature(body, sign(body))).toBe(true);
    });

    it("rejects a tampered body", () => {
      const adapter = buildAdapter();
      const body = Buffer.from(JSON.stringify({ hello: "world" }));
      const tampered = Buffer.from(JSON.stringify({ hello: "mallory" }));
      expect(adapter.verifyWebhookSignature(tampered, sign(body))).toBe(false);
    });

    it("rejects a missing or malformed signature header", () => {
      const adapter = buildAdapter();
      const body = Buffer.from("{}");
      expect(adapter.verifyWebhookSignature(body, undefined)).toBe(false);
      expect(adapter.verifyWebhookSignature(body, "not-a-signature")).toBe(false);
    });
  });

  describe("verifyWebhookChallenge", () => {
    it("returns the challenge when mode and token match", () => {
      const adapter = buildAdapter();
      const result = adapter.verifyWebhookChallenge({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "12345",
      });
      expect(result).toBe("12345");
    });

    it("returns null when the verify token is wrong", () => {
      const adapter = buildAdapter();
      const result = adapter.verifyWebhookChallenge({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
        "hub.challenge": "12345",
      });
      expect(result).toBeNull();
    });
  });

  describe("normalizeInboundEvents", () => {
    it("extracts messaging events and derives a stable event id from the message mid", () => {
      const adapter = buildAdapter();
      const payload = {
        object: "instagram",
        entry: [
          {
            id: "page-123",
            time: 1700000000,
            messaging: [
              {
                sender: { id: "user-456" },
                recipient: { id: "page-123" },
                timestamp: 1700000001000,
                message: { mid: "mid-1", text: "hi there" },
              },
            ],
          },
        ],
      };

      const events = adapter.normalizeInboundEvents(payload);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        externalEventId: "mid-1",
        externalAccountId: "page-123",
        senderExternalId: "user-456",
        text: "hi there",
      });
    });

    it("ignores entries without a message (e.g. delivery receipts)", () => {
      const adapter = buildAdapter();
      const payload = {
        entry: [{ id: "page-1", messaging: [{ sender: { id: "u1" }, delivery: { mids: ["x"] } }] }],
      };
      expect(adapter.normalizeInboundEvents(payload)).toHaveLength(0);
    });
  });

  describe("sendMessage", () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it("posts to the Graph API with a bearer token and returns the provider message id", async () => {
      const adapter = buildAdapter();
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message_id: "mid-123" }),
      });
      global.fetch = fetchMock as any;

      const result = await adapter.sendMessage(
        { externalAccountId: "page-123", recipientExternalId: "user-456", text: "hi" },
        "the-access-token",
      );

      expect(result).toEqual({ providerMessageId: "mid-123", status: "sent" });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://graph.facebook.com/v19.0/page-123/messages");
      expect(init.headers.Authorization).toBe("Bearer the-access-token");
      expect(init.headers.Authorization).not.toContain("undefined");
      expect(JSON.parse(init.body)).toEqual({ recipient: { id: "user-456" }, message: { text: "hi" } });
    });

    it("throws with the Graph API error message when the request fails, so BullMQ can retry", async () => {
      const adapter = buildAdapter();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { message: "Invalid OAuth access token" } }),
      }) as any;

      await expect(
        adapter.sendMessage({ externalAccountId: "page-123", recipientExternalId: "user-456", text: "hi" }, "bad-token"),
      ).rejects.toThrow(/Invalid OAuth access token/);
    });

    it("sends an attachment payload when attachmentUrl is provided instead of text", async () => {
      const adapter = buildAdapter();
      const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ message_id: "mid-1" }) });
      global.fetch = fetchMock as any;

      await adapter.sendMessage(
        { externalAccountId: "page-123", recipientExternalId: "user-456", attachmentUrl: "https://example.com/img.png" },
        "token",
      );

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.message).toEqual({ attachment: { type: "image", payload: { url: "https://example.com/img.png", is_reusable: true } } });
    });
  });

  describe("getMessagingWindow", () => {
    it("is closed when there was never an inbound message", () => {
      const adapter = buildAdapter();
      expect(adapter.getMessagingWindow(null)).toMatchObject({
        isOpen: false,
        reasonCode: "NO_PRIOR_INBOUND_MESSAGE",
      });
    });

    it("is open within 24h of the last inbound message and closed after", () => {
      const adapter = buildAdapter();
      const recentlyOpen = adapter.getMessagingWindow(new Date());
      expect(recentlyOpen.isOpen).toBe(true);

      const longAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const closed = adapter.getMessagingWindow(longAgo);
      expect(closed.isOpen).toBe(false);
      expect(closed.reasonCode).toBe("MESSAGING_WINDOW_CLOSED");
    });
  });
});
