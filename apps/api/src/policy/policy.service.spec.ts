import { ConfigService } from "@nestjs/config";
import { ChannelProvider } from "@prisma/client";
import { PolicyService } from "./policy.service";
import { PolicyDenialReason } from "./policy.types";
import { MetaAdapter } from "../channels/adapters/meta/meta.adapter";

function buildService() {
  const contactFindUnique = jest.fn().mockResolvedValue({ id: "contact-1", optedOutAt: null });
  const consentFindFirst = jest.fn().mockResolvedValue(null);
  const messageFindFirst = jest.fn().mockResolvedValue(null);

  const prisma = {
    contact: { findUnique: contactFindUnique },
    contactConsent: { findFirst: consentFindFirst },
    conversationMessage: { findFirst: messageFindFirst },
  } as any;

  const metaAdapter = new MetaAdapter({
    getOrThrow: (key: string) => ({ META_APP_SECRET: "secret", META_WEBHOOK_VERIFY_TOKEN: "token" })[key] ?? "",
  } as unknown as ConfigService);

  const service = new PolicyService(prisma, metaAdapter);
  return { service, contactFindUnique, consentFindFirst, messageFindFirst };
}

describe("PolicyService.canSend", () => {
  it("denies with OPTED_OUT and skips the remaining checks when the contact opted out", async () => {
    const { service, contactFindUnique, consentFindFirst } = buildService();
    contactFindUnique.mockResolvedValue({ id: "contact-1", optedOutAt: new Date() });

    const decision = await service.canSend("contact-1", "conn-1", ChannelProvider.INSTAGRAM);

    expect(decision).toEqual({ allowed: false, reasonCode: PolicyDenialReason.OPTED_OUT });
    expect(consentFindFirst).not.toHaveBeenCalled();
  });

  it("denies with CONSENT_REVOKED when the latest messaging consent for that channel was revoked", async () => {
    const { service, consentFindFirst, messageFindFirst } = buildService();
    consentFindFirst.mockResolvedValue({ revokedAt: new Date() });

    const decision = await service.canSend("contact-1", "conn-1", ChannelProvider.INSTAGRAM);

    expect(decision).toEqual({ allowed: false, reasonCode: PolicyDenialReason.CONSENT_REVOKED });
    expect(messageFindFirst).not.toHaveBeenCalled();
  });

  it("denies with MESSAGING_WINDOW_CLOSED when the contact has never messaged in", async () => {
    const { service, messageFindFirst } = buildService();
    messageFindFirst.mockResolvedValue(null);

    const decision = await service.canSend("contact-1", "conn-1", ChannelProvider.INSTAGRAM);

    expect(decision).toEqual({ allowed: false, reasonCode: PolicyDenialReason.MESSAGING_WINDOW_CLOSED });
  });

  it("denies with MESSAGING_WINDOW_CLOSED when the last inbound message was more than 24h ago", async () => {
    const { service, messageFindFirst } = buildService();
    messageFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });

    const decision = await service.canSend("contact-1", "conn-1", ChannelProvider.INSTAGRAM);

    expect(decision).toEqual({ allowed: false, reasonCode: PolicyDenialReason.MESSAGING_WINDOW_CLOSED });
  });

  it("allows the send when the contact hasn't opted out, consent isn't revoked, and the window is open", async () => {
    const { service, messageFindFirst } = buildService();
    messageFindFirst.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 1000) });

    const decision = await service.canSend("contact-1", "conn-1", ChannelProvider.INSTAGRAM);

    expect(decision).toEqual({ allowed: true, reasonCode: null });
  });

  it("scopes the last-inbound lookup to the given contact and channel connection", async () => {
    const { service, messageFindFirst } = buildService();

    await service.canSend("contact-1", "conn-1", ChannelProvider.INSTAGRAM);

    expect(messageFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          direction: "IN",
          conversation: { contactId: "contact-1", channelConnectionId: "conn-1" },
        }),
      }),
    );
  });
});
