import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { AutomationStepStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AUTOMATION_EXECUTION_DLQ, AUTOMATION_EXECUTION_QUEUE } from "../automations/execution/execution-queue.service";
import { POLICY_DENIAL_MESSAGES } from "../policy/policy.types";

const POLICY_DENIAL_ERRORS = Object.values(POLICY_DENIAL_MESSAGES);

/**
 * Aggregate, system-wide operational metrics - not scoped to a workspace,
 * meant for whoever runs the deploy (Render logs/alerts), not tenants.
 * Deliberately a plain JSON snapshot rather than Prometheus text format:
 * there's no scrape target set up yet, and a hand-rolled histogram would be
 * speculative infra for a monitoring stack that doesn't exist.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AUTOMATION_EXECUTION_QUEUE) private readonly executionQueue: Queue,
    @InjectQueue(AUTOMATION_EXECUTION_DLQ) private readonly deadLetterQueue: Queue,
  ) {}

  async collect() {
    const [executionsByStatus, executionQueueCounts, deadLetterQueueCounts, outboxUnprocessed, oldestUnprocessedOutbox, policyDenialsTotal] =
      await Promise.all([
        this.prisma.automationExecution.groupBy({ by: ["status"], _count: { _all: true } }),
        this.executionQueue.getJobCounts(),
        this.deadLetterQueue.getJobCounts(),
        this.prisma.outboxEvent.count({ where: { processedAt: null } }),
        this.prisma.outboxEvent.findFirst({ where: { processedAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
        this.prisma.automationStepExecution.count({
          where: { status: AutomationStepStatus.FAILED, error: { in: POLICY_DENIAL_ERRORS } },
        }),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      executionsByStatus: Object.fromEntries(executionsByStatus.map((row) => [row.status, row._count._all])),
      executionQueue: executionQueueCounts,
      deadLetterQueue: deadLetterQueueCounts,
      outbox: {
        unprocessed: outboxUnprocessed,
        oldestUnprocessedAgeMs: oldestUnprocessedOutbox ? Date.now() - oldestUnprocessedOutbox.createdAt.getTime() : null,
      },
      policyDenialsTotal,
    };
  }
}
