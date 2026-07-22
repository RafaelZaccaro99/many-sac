import { BadRequestException } from "@nestjs/common";
import { ChannelProvider } from "@prisma/client";
import { MetaOAuthService } from "./meta-oauth.service";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as any;
}

function buildService() {
  const configService = {
    getOrThrow: jest.fn((key: string) => ({ META_APP_ID: "app-123", META_APP_SECRET: "secret-456" })[key] ?? ""),
  } as any;
  const channelsService = { connect: jest.fn().mockResolvedValue({ id: "conn-1", status: "ACTIVE" }) } as any;

  const service = new MetaOAuthService(configService, channelsService);
  return { service, configService, channelsService };
}

describe("MetaOAuthService.connectFromCode", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("exchanges the code, gets a long-lived token, and connects the single Page found", async () => {
    const { service, channelsService } = buildService();
    const fetchSpy = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "short-lived" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "long-lived" }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "page-1", name: "Acme Support", access_token: "page-token" }] }));

    const result = await service.connectFromCode("ws-1", "user-1", "auth-code", "https://app.example/callback");

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("/oauth/access_token?");
    expect(String(fetchSpy.mock.calls[0][0])).toContain("code=auth-code");
    expect(String(fetchSpy.mock.calls[1][0])).toContain("grant_type=fb_exchange_token");
    expect(String(fetchSpy.mock.calls[1][0])).toContain("fb_exchange_token=short-lived");
    expect(String(fetchSpy.mock.calls[2][0])).toContain("/me/accounts?access_token=long-lived");

    expect(channelsService.connect).toHaveBeenCalledWith("ws-1", "user-1", {
      provider: ChannelProvider.INSTAGRAM,
      externalAccountId: "page-1",
      displayName: "Acme Support",
      accessToken: "page-token",
    });
    expect(result).toEqual({ id: "conn-1", status: "ACTIVE" });
  });

  it("rejects with a clear error when no Page is found", async () => {
    const { service, channelsService } = buildService();
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "short-lived" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "long-lived" }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }));

    await expect(service.connectFromCode("ws-1", "user-1", "auth-code", "https://app.example/callback")).rejects.toThrow(
      BadRequestException,
    );
    expect(channelsService.connect).not.toHaveBeenCalled();
  });

  it("rejects with a clear error when more than one Page is found, without connecting either", async () => {
    const { service, channelsService } = buildService();
    jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ access_token: "short-lived" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "long-lived" }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: "page-1", name: "Acme Support", access_token: "page-token-1" },
            { id: "page-2", name: "Acme Sales", access_token: "page-token-2" },
          ],
        }),
      );

    await expect(service.connectFromCode("ws-1", "user-1", "auth-code", "https://app.example/callback")).rejects.toThrow(
      /Multiple Facebook Pages/,
    );
    expect(channelsService.connect).not.toHaveBeenCalled();
  });

  it("surfaces a Graph API error instead of a raw fetch failure", async () => {
    const { service } = buildService();
    jest.spyOn(global, "fetch").mockResolvedValueOnce(jsonResponse({ error: { message: "Invalid verification code" } }, false));

    await expect(service.connectFromCode("ws-1", "user-1", "bad-code", "https://app.example/callback")).rejects.toThrow(
      /Invalid verification code/,
    );
  });
});
