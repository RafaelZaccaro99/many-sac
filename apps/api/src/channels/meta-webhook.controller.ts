import { BadRequestException, Controller, Get, Header, HttpCode, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { ChannelsService } from "./channels.service";

/**
 * Public endpoints Meta calls directly - no JWT, since the caller is Meta's
 * servers. Authenticity is instead established per-request via the
 * hub.verify_token handshake (GET) and the X-Hub-Signature-256 HMAC (POST).
 */
@Controller("webhooks/meta")
export class MetaWebhookController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  @Header("content-type", "text/plain")
  handleVerification(@Query() query: Record<string, string>) {
    const challenge = this.channelsService.verifyWebhookChallenge(query);
    if (challenge === null) {
      throw new BadRequestException("Webhook verification failed");
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  async handleEvent(@Req() req: Request) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.header("x-hub-signature-256");

    if (!rawBody || !this.channelsService.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException("Invalid webhook signature");
    }

    const result = await this.channelsService.processInboundWebhook(req.body);
    return { received: true, ...result };
  }
}
