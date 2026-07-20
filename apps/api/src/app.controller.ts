import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "./prisma/prisma.service";
import { AUTOMATION_EXECUTION_QUEUE } from "./automations/execution/execution-queue.service";

type CheckResult = "ok" | "down";

/**
 * Render's healthCheckPath hits this. A bare "process is up" response would
 * never catch a DB/Redis outage - Render would keep routing traffic to a
 * replica that can't actually serve a single real request. Checking both
 * dependencies here means a broken deploy fails the health check instead of
 * silently going live.
 */
@Controller()
export class AppController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AUTOMATION_EXECUTION_QUEUE) private readonly executionQueue: Queue,
  ) {}

  @Get("health")
  async health() {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const checks = { database, redis };

    if (database !== "ok" || redis !== "ok") {
      throw new ServiceUnavailableException({ status: "degraded", checks });
    }

    return { status: "ok", checks };
  }

  private async checkDatabase(): Promise<CheckResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "ok";
    } catch {
      return "down";
    }
  }

  private async checkRedis(): Promise<CheckResult> {
    try {
      // BullMQ's abstracted client interface has no ping() - info() is the
      // lightest call it exposes that still forces a real round trip.
      const client = await this.executionQueue.client;
      await client.info();
      return "ok";
    } catch {
      return "down";
    }
  }
}
