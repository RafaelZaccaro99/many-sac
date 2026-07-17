import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from "@nestjs/bullmq";
import { Job, Queue } from "bullmq";
import { AutomationExecutionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ExecutionRunnerService } from "./execution-runner.service";
import { AUTOMATION_EXECUTION_DLQ, AUTOMATION_EXECUTION_QUEUE, ExecutionJobData, MAX_JOB_ATTEMPTS } from "./execution-queue.service";

/**
 * Thin BullMQ adapter: all actual step logic lives in ExecutionRunnerService,
 * which has no BullMQ dependency and is unit tested directly. This class only
 * exists to satisfy @nestjs/bullmq's Processor contract and to move a job to
 * the dead-letter queue once its retries are exhausted.
 */
@Injectable()
@Processor(AUTOMATION_EXECUTION_QUEUE)
export class ExecutionProcessor extends WorkerHost {
  private readonly logger = new Logger(ExecutionProcessor.name);

  constructor(
    private readonly executionRunner: ExecutionRunnerService,
    private readonly prisma: PrismaService,
    @InjectQueue(AUTOMATION_EXECUTION_DLQ) private readonly dlq: Queue,
  ) {
    super();
  }

  async process(job: Job<ExecutionJobData>): Promise<void> {
    await this.executionRunner.runStep(job.data.executionId);
  }

  @OnWorkerEvent("failed")
  async onFailed(job: Job<ExecutionJobData> | undefined, error: Error): Promise<void> {
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? MAX_JOB_ATTEMPTS;
    if (job.attemptsMade < maxAttempts) {
      return; // BullMQ will retry this job itself.
    }

    this.logger.error(`Execution ${job.data.executionId} exhausted retries: ${error.message}`);
    await this.prisma.automationExecution.update({
      where: { id: job.data.executionId },
      data: { status: AutomationExecutionStatus.FAILED_PERMANENT },
    });
    await this.dlq.add(
      "dead-letter",
      { executionId: job.data.executionId, error: error.message },
      { removeOnComplete: true },
    );
  }
}
