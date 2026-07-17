import { Module } from "@nestjs/common";
import { AutomationsService } from "./automations.service";
import { AutomationsController } from "./automations.controller";
import { AuditModule } from "../common/audit/audit.module";
import { WorkspaceRolesGuard } from "../common/guards/workspace-roles.guard";

@Module({
  imports: [AuditModule],
  controllers: [AutomationsController],
  providers: [AutomationsService, WorkspaceRolesGuard],
  exports: [AutomationsService],
})
export class AutomationsModule {}
