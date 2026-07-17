import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";

export const AUTOMATION_EXECUTION_QUEUE = "automation-execution";
export const AUTOMATION_EXECUTION_DLQ = "automation-execution-dlq";
export const MAX_JOB_ATTEMPTS = 5;

export interface ExecutionJobData {
  executionId: string;
}

@Injectable()
export class ExecutionQueueService {
  constructor(@InjectQueue(AUTOMATION_EXECUTION_QUEUE) private readonly queue: Queue<ExecutionJobData>) {}

  async enqueueStep(executionId: string, delayMs = 0): Promise<void> {
    await this.queue.add(
      "run-step",
      { executionId },
      {
        delay: delayMs,
        attempts: MAX_JOB_ATTEMPTS,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }
}
