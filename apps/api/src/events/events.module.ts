import { Module } from "@nestjs/common";
import { OutboxService } from "./outbox.service";
import { OutboxPublisherService } from "./outbox-publisher.service";

@Module({
  providers: [OutboxService, OutboxPublisherService],
  exports: [OutboxService],
})
export class EventsModule {}
