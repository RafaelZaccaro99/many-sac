import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ConversationStatus, WorkspaceRole } from "@prisma/client";
import { ConversationsService } from "./conversations.service";
import { SendConversationMessageDto } from "./dto/send-message.dto";
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
const AGENT_ROLES = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.BUILDER, WorkspaceRole.AGENT];

@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
@Controller("workspaces/:workspaceId/conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @WorkspaceRoles(...READ_ROLES)
  @Get()
  list(
    @Param("workspaceId") workspaceId: string,
    @Query("status") status?: ConversationStatus,
    @Query("assignedToUserId") assignedToUserId?: string,
  ) {
    return this.conversationsService.list(workspaceId, { status, assignedToUserId });
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get(":conversationId")
  getOne(@Param("workspaceId") workspaceId: string, @Param("conversationId") conversationId: string) {
    return this.conversationsService.getOne(workspaceId, conversationId);
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get(":conversationId/messages")
  listMessages(
    @Param("workspaceId") workspaceId: string,
    @Param("conversationId") conversationId: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    return this.conversationsService.listMessages(
      workspaceId,
      conversationId,
      take ? Number(take) : undefined,
      skip ? Number(skip) : undefined,
    );
  }

  @WorkspaceRoles(...AGENT_ROLES)
  @Post(":conversationId/messages")
  sendMessage(
    @Param("workspaceId") workspaceId: string,
    @Param("conversationId") conversationId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SendConversationMessageDto,
  ) {
    return this.conversationsService.sendMessage(workspaceId, conversationId, user.id, dto.body);
  }

  @WorkspaceRoles(...AGENT_ROLES)
  @Post(":conversationId/claim")
  claim(@Param("workspaceId") workspaceId: string, @Param("conversationId") conversationId: string, @CurrentUser() user: RequestUser) {
    return this.conversationsService.claim(workspaceId, conversationId, user.id);
  }

  @WorkspaceRoles(...AGENT_ROLES)
  @Post(":conversationId/close")
  close(@Param("workspaceId") workspaceId: string, @Param("conversationId") conversationId: string, @CurrentUser() user: RequestUser) {
    return this.conversationsService.close(workspaceId, conversationId, user.id);
  }

  @WorkspaceRoles(...AGENT_ROLES)
  @Post(":conversationId/resume")
  resume(@Param("workspaceId") workspaceId: string, @Param("conversationId") conversationId: string, @CurrentUser() user: RequestUser) {
    return this.conversationsService.resume(workspaceId, conversationId, user.id);
  }
}
