import { Module } from "@nestjs/common";
import { WorkspacesService } from "./workspaces.service";
import { WorkspacesController } from "./workspaces.controller";
import { AuditModule } from "../common/audit/audit.module";
import { WorkspaceRolesGuard } from "../common/guards/workspace-roles.guard";

@Module({
  imports: [AuditModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, WorkspaceRolesGuard],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
