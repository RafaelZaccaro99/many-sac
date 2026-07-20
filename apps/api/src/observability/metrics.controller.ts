import { Controller, Get, Headers, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { MetricsService } from "./metrics.service";

/**
 * Fails closed like EXTERNAL_REQUEST_ALLOWED_HOSTS: an unset METRICS_TOKEN
 * means every request is denied, not "metrics are open by default". Plain
 * equality (not timing-safe) - same tolerance the codebase already accepts
 * for META_WEBHOOK_VERIFY_TOKEN, since this isn't a per-request auth secret
 * shared with untrusted clients, just a shared token for internal scraping.
 */
@Controller("metrics")
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async getMetrics(@Headers("x-metrics-token") token: string | undefined) {
    const expected = this.configService.get<string>("METRICS_TOKEN", "");
    if (!expected || token !== expected) {
      throw new UnauthorizedException();
    }
    return this.metricsService.collect();
  }
}
