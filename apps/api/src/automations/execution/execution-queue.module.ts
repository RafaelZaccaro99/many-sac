import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ExecutionQueueService, AUTOMATION_EXECUTION_QUEUE, AUTOMATION_EXECUTION_DLQ } from "./execution-queue.service";

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>("REDIS_URL") },
      }),
    }),
    BullModule.registerQueue({ name: AUTOMATION_EXECUTION_QUEUE }, { name: AUTOMATION_EXECUTION_DLQ }),
  ],
  providers: [ExecutionQueueService],
  exports: [ExecutionQueueService, BullModule],
})
export class ExecutionQueueModule {}
