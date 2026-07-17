import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EventType } from "./event-types";

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes an outbox row using the given Prisma client - pass the `tx` from an
   * enclosing `$transaction` so the event is committed atomically with whatever
   * business data it describes. Never call this outside a transaction that also
   * writes the underlying state change, or the two can diverge.
   */
  async enqueue(
    tx: Prisma.TransactionClient | PrismaService,
    input: { workspaceId: string; eventType: EventType; payload: unknown },
  ) {
    return (tx ?? this.prisma).outboxEvent.create({
      data: {
        workspaceId: input.workspaceId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }
}
