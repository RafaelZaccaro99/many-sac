import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { ChannelsService } from "./channels.service";
import { ConnectChannelDto } from "./dto/connect-channel.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { WorkspaceRolesGuard } from "../common/guards/workspace-roles.guard";
import { WorkspaceRoles } from "../common/decorators/workspace-roles.decorator";
import { CurrentUser, RequestUser } from "../common/decorators/current-user.decorator";

const MANAGE_CHANNEL_ROLES = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN];
const READ_ROLES = [
  WorkspaceRole.OWNER,
  WorkspaceRole.ADMIN,
  WorkspaceRole.BUILDER,
  WorkspaceRole.AGENT,
  WorkspaceRole.ANALYST,
];

@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
@Controller("workspaces/:workspaceId/channels")
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @WorkspaceRoles(...MANAGE_CHANNEL_ROLES)
  @Post()
  connect(@Param("workspaceId") workspaceId: string, @CurrentUser() user: RequestUser, @Body() dto: ConnectChannelDto) {
    return this.channelsService.connect(workspaceId, user.id, dto);
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get()
  list(@Param("workspaceId") workspaceId: string) {
    return this.channelsService.listConnections(workspaceId);
  }
}
