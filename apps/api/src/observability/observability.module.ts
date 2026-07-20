import { Module } from "@nestjs/common";
import { MetricsService } from "./metrics.service";
import { MetricsController } from "./metrics.controller";
import { ExecutionQueueModule } from "../automations/execution/execution-queue.module";

@Module({
  imports: [ExecutionQueueModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class ObservabilityModule {}
