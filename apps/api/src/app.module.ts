import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { AppController } from "./app.controller";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./common/audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { WorkspacesModule } from "./workspaces/workspaces.module";
import { ContactsModule } from "./contacts/contacts.module";
import { ChannelsModule } from "./channels/channels.module";
import { EventsModule } from "./events/events.module";
import { AutomationsModule } from "./automations/automations.module";
import { ExecutionModule } from "./automations/execution/execution.module";
import { ExecutionQueueModule } from "./automations/execution/execution-queue.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { PolicyModule } from "./policy/policy.module";
import { ObservabilityModule } from "./observability/observability.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    PrismaModule,
    AuditModule,
    AuthModule,
    WorkspacesModule,
    ContactsModule,
    ChannelsModule,
    EventsModule,
    PolicyModule,
    ConversationsModule,
    AutomationsModule,
    ExecutionModule,
    ExecutionQueueModule,
    ObservabilityModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
