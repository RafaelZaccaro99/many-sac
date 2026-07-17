import { Module } from "@nestjs/common";
import { ContactsService } from "./contacts.service";
import { ContactsController } from "./contacts.controller";
import { AuditModule } from "../common/audit/audit.module";
import { WorkspaceRolesGuard } from "../common/guards/workspace-roles.guard";

@Module({
  imports: [AuditModule],
  controllers: [ContactsController],
  providers: [ContactsService, WorkspaceRolesGuard],
  exports: [ContactsService],
})
export class ContactsModule {}
