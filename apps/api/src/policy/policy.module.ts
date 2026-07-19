import { Module } from "@nestjs/common";
import { PolicyService } from "./policy.service";
import { OptOutListener } from "./opt-out.listener";
import { ChannelsModule } from "../channels/channels.module";

@Module({
  imports: [ChannelsModule],
  providers: [PolicyService, OptOutListener],
  exports: [PolicyService],
})
export class PolicyModule {}
