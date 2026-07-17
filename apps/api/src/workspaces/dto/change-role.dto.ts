import { IsEnum } from "class-validator";
import { WorkspaceRole } from "@prisma/client";

export class ChangeRoleDto {
  @IsEnum(WorkspaceRole)
  role!: WorkspaceRole;
}
