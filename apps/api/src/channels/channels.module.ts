import { Module } from "@nestjs/common";
import { ChannelsService } from "./channels.service";
import { ChannelsController } from "./channels.controller";
import { MetaWebhookController } from "./meta-webhook.controller";
import { MetaAdapter } from "./adapters/meta/meta.adapter";
import { CredentialsCipher } from "./credentials-cipher";
import { AuditModule } from "../common/audit/audit.module";
import { EventsModule } from "../events/events.module";
import { WorkspaceRolesGuard } from "../common/guards/workspace-roles.guard";

@Module({
  imports: [AuditModule, EventsModule],
  controllers: [ChannelsController, MetaWebhookController],
  providers: [ChannelsService, MetaAdapter, CredentialsCipher, WorkspaceRolesGuard],
  exports: [ChannelsService, MetaAdapter, CredentialsCipher],
})
export class ChannelsModule {}
