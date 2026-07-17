import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PrismaService } from "../prisma/prisma.service";
import { OutboxEventEnvelope } from "./event-types";

const POLL_INTERVAL_MS = 2000;
const BATCH_SIZE = 20;
const MAX_ATTEMPTS = 5;

/**
 * Polls unprocessed outbox rows and fans them out via EventEmitter2. This is the
 * "publish" half of the transactional outbox pattern: writers only ever commit a
 * row inside their own transaction (see OutboxService.enqueue); this poller is
 * the sole place that turns a committed row into an in-process event, so
 * producers and consumers stay decoupled.
 *
 * A plain interval poller is enough at this stage - BullMQ/Redis are introduced
 * later for the automation execution queue, and reusing that infra here now
 * would add an operational dependency for no benefit yet.
 */
@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async pollOnce(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: { processedAt: null },
        orderBy: { createdAt: "asc" },
        take: BATCH_SIZE,
      });

      for (const event of events) {
        await this.processOne(event.id, event.workspaceId, event.eventType, event.payload, event.attempts);
      }
    } finally {
      this.polling = false;
    }
  }

  private async processOne(
    outboxEventId: string,
    workspaceId: string,
    eventType: string,
    payload: unknown,
    priorAttempts: number,
  ): Promise<void> {
    const envelope: OutboxEventEnvelope = {
      outboxEventId,
      workspaceId,
      eventType: eventType as OutboxEventEnvelope["eventType"],
      payload,
    };

    try {
      await this.eventEmitter.emitAsync(eventType, envelope);
      await this.prisma.outboxEvent.update({
        where: { id: outboxEventId },
        data: { processedAt: new Date() },
      });
    } catch (err: any) {
      const attempts = priorAttempts + 1;
      const lastError = err?.message ?? String(err);
      this.logger.error(`Failed to publish outbox event ${outboxEventId} (${eventType}), attempt ${attempts}`, err?.stack);

      const gaveUp = attempts >= MAX_ATTEMPTS;
      if (gaveUp) {
        this.logger.error(`Giving up on outbox event ${outboxEventId} after ${attempts} attempts`);
      }

      await this.prisma.outboxEvent.update({
        where: { id: outboxEventId },
        data: {
          attempts,
          lastError,
          // Stop retrying a poison event so it doesn't block the rest of the
          // batch forever, but keep lastError so it's visible it never truly succeeded.
          processedAt: gaveUp ? new Date() : null,
        },
      });
    }
  }
}
