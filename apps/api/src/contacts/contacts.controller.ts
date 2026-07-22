import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { WorkspaceRole } from "@prisma/client";
import { ContactsService } from "./contacts.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";
import { CreateTagDto } from "./dto/create-tag.dto";
import { CreateCustomFieldDto } from "./dto/create-custom-field.dto";
import { SetCustomFieldValueDto } from "./dto/set-custom-field-value.dto";
import { RecordConsentDto } from "./dto/record-consent.dto";
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
const WRITE_CONTACT_ROLES = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.BUILDER, WorkspaceRole.AGENT];
const MANAGE_SCHEMA_ROLES = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN, WorkspaceRole.BUILDER];

@UseGuards(JwtAuthGuard, WorkspaceRolesGuard)
@Controller("workspaces/:workspaceId")
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @WorkspaceRoles(...WRITE_CONTACT_ROLES)
  @Post("contacts")
  create(@Param("workspaceId") workspaceId: string, @CurrentUser() user: RequestUser, @Body() dto: CreateContactDto) {
    return this.contactsService.create(workspaceId, user.id, dto);
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get("contacts")
  list(@Param("workspaceId") workspaceId: string, @Query("take") take?: string, @Query("cursor") cursor?: string) {
    return this.contactsService.list(workspaceId, take ? Number(take) : undefined, cursor);
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get("contacts/:contactId")
  getOne(@Param("workspaceId") workspaceId: string, @Param("contactId") contactId: string) {
    return this.contactsService.getOne(workspaceId, contactId);
  }

  @WorkspaceRoles(...WRITE_CONTACT_ROLES)
  @Patch("contacts/:contactId")
  update(
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(workspaceId, contactId, user.id, dto);
  }

  @WorkspaceRoles(...MANAGE_SCHEMA_ROLES)
  @Post("tags")
  createTag(@Param("workspaceId") workspaceId: string, @CurrentUser() user: RequestUser, @Body() dto: CreateTagDto) {
    return this.contactsService.createTag(workspaceId, user.id, dto);
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get("tags")
  listTags(@Param("workspaceId") workspaceId: string) {
    return this.contactsService.listTags(workspaceId);
  }

  @WorkspaceRoles(...WRITE_CONTACT_ROLES)
  @Post("contacts/:contactId/tags/:tagName")
  addTag(
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Param("tagName") tagName: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.contactsService.addTagToContact(workspaceId, contactId, user.id, tagName);
  }

  @WorkspaceRoles(...WRITE_CONTACT_ROLES)
  @Delete("contacts/:contactId/tags/:tagName")
  removeTag(
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Param("tagName") tagName: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.contactsService.removeTagFromContact(workspaceId, contactId, user.id, tagName);
  }

  @WorkspaceRoles(...MANAGE_SCHEMA_ROLES)
  @Post("custom-fields")
  createCustomField(
    @Param("workspaceId") workspaceId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCustomFieldDto,
  ) {
    return this.contactsService.createCustomField(workspaceId, user.id, dto);
  }

  @WorkspaceRoles(...READ_ROLES)
  @Get("custom-fields")
  listCustomFields(@Param("workspaceId") workspaceId: string) {
    return this.contactsService.listCustomFields(workspaceId);
  }

  @WorkspaceRoles(...WRITE_CONTACT_ROLES)
  @Put("contacts/:contactId/fields/:key")
  setFieldValue(
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Param("key") key: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: SetCustomFieldValueDto,
  ) {
    return this.contactsService.setCustomFieldValue(workspaceId, contactId, user.id, key, dto.value);
  }

  @WorkspaceRoles(...WRITE_CONTACT_ROLES)
  @Post("contacts/:contactId/consents")
  recordConsent(
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @CurrentUser() user: RequestUser,
    @Body() dto: RecordConsentDto,
  ) {
    return this.contactsService.recordConsent(workspaceId, contactId, user.id, dto);
  }

  @WorkspaceRoles(...WRITE_CONTACT_ROLES)
  @Post("contacts/:contactId/consents/:consentId/revoke")
  revokeConsent(
    @Param("workspaceId") workspaceId: string,
    @Param("contactId") contactId: string,
    @Param("consentId") consentId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.contactsService.revokeConsent(workspaceId, contactId, user.id, consentId);
  }
}
