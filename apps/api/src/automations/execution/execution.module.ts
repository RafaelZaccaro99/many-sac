import { Module } from "@nestjs/common";
import { ExecutionQueueModule } from "./execution-queue.module";
import { ExecutionRunnerService } from "./execution-runner.service";
import { ExecutionProcessor } from "./execution.processor";
import { TriggerMatcherService } from "./trigger-matcher.service";
import { CollectInputListener } from "./collect-input.listener";
import { ChannelsModule } from "../../channels/channels.module";
import { ConversationsModule } from "../../conversations/conversations.module";
import { PolicyModule } from "../../policy/policy.module";

@Module({
  imports: [ExecutionQueueModule, ChannelsModule, ConversationsModule, PolicyModule],
  providers: [ExecutionRunnerService, ExecutionProcessor, TriggerMatcherService, CollectInputListener],
  exports: [ExecutionRunnerService],
})
export class ExecutionModule {}
