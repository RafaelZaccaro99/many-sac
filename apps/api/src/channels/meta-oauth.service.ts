import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChannelProvider } from "@prisma/client";
import { GRAPH_API_BASE_URL, GRAPH_API_VERSION } from "./adapters/meta/meta.adapter";
import { ChannelsService } from "./channels.service";

interface MetaPage {
  id: string;
  name: string;
  access_token: string;
}

/**
 * Handles the Meta OAuth2 handshake so connecting a channel is "click and
 * authorize" instead of pasting a token manually. Deliberately scoped to the
 * common case - a Facebook user with exactly one Page. Multiple Pages still
 * go through the existing manual connect form; a page-picker is a bigger
 * feature saved for when it's actually needed.
 */
@Injectable()
export class MetaOAuthService {
  private readonly logger = new Logger(MetaOAuthService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly channelsService: ChannelsService,
  ) {}

  async connectFromCode(workspaceId: string, actorUserId: string, code: string, redirectUri: string) {
    const shortLivedToken = await this.exchangeCodeForToken(code, redirectUri);
    const longLivedToken = await this.exchangeForLongLivedToken(shortLivedToken);
    const pages = await this.listPages(longLivedToken);

    if (pages.length === 0) {
      throw new BadRequestException("No Facebook Page found for this account - grant Page permissions and try again");
    }
    if (pages.length > 1) {
      throw new BadRequestException(
        "Multiple Facebook Pages found - automatic connect only supports one Page per account right now; use the manual connect form for this one",
      );
    }

    const [page] = pages;
    // What we get from /me/accounts is a Facebook Page (Page id + Page access
    // token), so the connection is MESSENGER. An Instagram account linked to
    // the Page has its own IG business account id and would be a separate
    // connection - out of scope for the single-Page automatic flow.
    return this.channelsService.connect(workspaceId, actorUserId, {
      provider: ChannelProvider.MESSENGER,
      externalAccountId: page.id,
      displayName: page.name,
      accessToken: page.access_token,
    });
  }

  private async exchangeCodeForToken(code: string, redirectUri: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.configService.getOrThrow<string>("META_APP_ID"),
      client_secret: this.configService.getOrThrow<string>("META_APP_SECRET"),
      redirect_uri: redirectUri,
      code,
    });
    const body = await this.callGraphApi(`/oauth/access_token?${params.toString()}`);
    return this.requireAccessToken(body);
  }

  private async exchangeForLongLivedToken(shortLivedToken: string): Promise<string> {
    const params = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: this.configService.getOrThrow<string>("META_APP_ID"),
      client_secret: this.configService.getOrThrow<string>("META_APP_SECRET"),
      fb_exchange_token: shortLivedToken,
    });
    const body = await this.callGraphApi(`/oauth/access_token?${params.toString()}`);
    return this.requireAccessToken(body);
  }

  private requireAccessToken(body: any): string {
    if (typeof body?.access_token !== "string" || body.access_token.length === 0) {
      throw new BadRequestException("Meta OAuth request failed: response did not include an access token");
    }
    return body.access_token;
  }

  private async listPages(userAccessToken: string): Promise<MetaPage[]> {
    const params = new URLSearchParams({ access_token: userAccessToken });
    const body = await this.callGraphApi(`/me/accounts?${params.toString()}`);
    const pages = (body.data as MetaPage[]) ?? [];
    // Temporary diagnostic for the first real Meta App connect - /me/accounts
    // can come back empty for reasons the "No Page found" error can't tell
    // apart (no role on the app, Page owned by a Business Manager the account
    // doesn't have Facebook-level access to, wrong permission granted at
    // consent, etc). Logs page count/id/name only, never the token.
    this.logger.log(
      `/me/accounts returned ${pages.length} page(s): ${JSON.stringify(pages.map((p) => ({ id: p.id, name: p.name })))}`,
    );
    return pages;
  }

  private async callGraphApi(path: string): Promise<any> {
    const response = await fetch(`${GRAPH_API_BASE_URL}/${GRAPH_API_VERSION}${path}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new BadRequestException(`Meta OAuth request failed: ${body?.error?.message ?? "unknown error"}`);
    }
    return body;
  }
}
