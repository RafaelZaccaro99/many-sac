import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { AutomationsService } from "./automations.service";
import { CreateAutomationDto } from "./dto/create-automation.dto";
import { UpdateDraftDto } from "./dto/update-draft.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { WorkspaceRolesGuard } from "../common/guards/workspace-roles.guard";
import { WorkspaceRoles } from "../common/decorators/workspace-roles.decorator";
import { CurrentUser, RequestUser } from "../common/decorators/current-user.decorator";

const READ_ROLES = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.BUILDER,
  WorkspaceRole.AGENT,
  WorkspaceRole.ANALYST,
];
const MANAGE_ROLES = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.BUILDER];

@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
@Controller("workspaces/:workspaceId/automations")
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @WorkspaceRoles(...MANAGE_ROLES)
  @Post()
  create(@Param("workspaceId") workspaceId: string, @CurrentUser() user: RequestUser, @Body() dto: CreateAutomationDto) {
    return this.automationsService.create(workspaceId, user.id, dto);
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get()
  list(@Param("workspaceId") workspaceId: string) {
    return this.automationsService.list(workspaceId);
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get(":automationId")
  getOne(@Param("workspaceId") workspaceId: string, @Param("automationId") automationId: string) {
    return this.automationsService.getOne(workspaceId, automationId);
  }

  @WorkspaceRoles(...MANAGE_ROLES)
  @Patch(":automationId/draft")
  updateDraft(
    @Param("workspaceId") workspaceId: string,
    @Param("automationId") automationId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.automationsService.updateDraft(workspaceId, automationId, user.id, dto.graph);
  }

  @WorkspaceRoles(...MANAGE_ROLES)
  @Post(":automationId/validate")
  async validate(@Param("workspaceId") workspaceId: string, @Param("automationId") automationId: string) {
    const issues = await this.automationsService.validate(workspaceId, automationId);
    return { valid: issues.length === 0, issues };
  }

  @WorkspaceRoles(...MANAGE_ROLES)
  @Post(":automationId/publish")
  publish(
    @Param("workspaceId") workspaceId: string,
    @Param("automationId") automationId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.automationsService.publish(workspaceId, automationId, user.id);
  }
}
