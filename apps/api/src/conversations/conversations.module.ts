import { Module } from "@nestjs/common";
import { ConversationsService } from "./conversations.service";
import { ConversationsController } from "./conversations.controller";
import { ConversationsEventListener } from "./conversations.listener";
import { AuditModule } from "../common/audit/audit.module";
import { ChannelsModule } from "../channels/channels.module";
import { ExecutionQueueModule } from "../automations/execution/execution-queue.module";
import { PolicyModule } from "../policy/policy.module";
import { WorkspaceRolesGuard } from "../common/guards/workspace-roles.guard";

@Module({
  imports: [AuditModule, ChannelsModule, ExecutionQueueModule, PolicyModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, ConversationsEventListener, WorkspaceRolesGuard],
  exports: [ConversationsService],
})
export class ConversationsModule {}
