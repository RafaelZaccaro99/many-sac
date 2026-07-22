import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { CreateContactDto } from "./dto/create-contact.dto";
import { UpdateContactDto } from "./dto/update-contact.dto";
import { CreateTagDto } from "./dto/create-tag.dto";
import { CreateCustomFieldDto } from "./dto/create-custom-field.dto";
import { RecordConsentDto } from "./dto/record-consent.dto";
import { coerceCustomFieldValue, decodeCustomFieldValue } from "./custom-field-coercion";

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(workspaceId: string, actorUserId: string, dto: CreateContactDto) {
    const contact = await this.prisma.contact.create({
      data: { workspaceId, ...dto },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "contact.created",
      targetType: "Contact",
      targetId: contact.id,
    });

    return contact;
  }

  async list(workspaceId: string, take = 50, cursor?: string) {
    const limit = Math.min(take, 200);
    const items = await this.prisma.contact.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      // Cursor by id works correctly even though orderBy is on createdAt - id
      // is unique, so it unambiguously identifies where the previous page
      // ended, unlike offset/skip which drifts if rows are inserted between
      // page requests.
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { tags: { include: { tag: true } } },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    return { items: page, nextCursor };
  }

  async getOne(workspaceId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, workspaceId },
      include: {
        tags: { include: { tag: true } },
        identities: true,
        consents: true,
        fieldValues: { include: { fieldDefinition: true } },
      },
    });
    if (!contact) {
      throw new NotFoundException("Contact not found in this workspace");
    }
    return {
      ...contact,
      fieldValues: contact.fieldValues.map((fv) => ({
        key: fv.fieldDefinition.key,
        label: fv.fieldDefinition.label,
        type: fv.fieldDefinition.type,
        value: decodeCustomFieldValue(fv.fieldDefinition.type, fv),
      })),
    };
  }

  async update(workspaceId: string, contactId: string, actorUserId: string, dto: UpdateContactDto) {
    await this.getOne(workspaceId, contactId);
    const updated = await this.prisma.contact.update({
      where: { id: contactId },
      data: dto,
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "contact.updated",
      targetType: "Contact",
      targetId: contactId,
      metadata: { fields: Object.keys(dto) },
    });

    return updated;
  }

  // --- Tags ---

  async createTag(workspaceId: string, actorUserId: string, dto: CreateTagDto) {
    const existing = await this.prisma.tag.findUnique({ where: { workspaceId_name: { workspaceId, name: dto.name } } });
    if (existing) {
      throw new ConflictException("A tag with this name already exists in this workspace");
    }
    const tag = await this.prisma.tag.create({ data: { workspaceId, name: dto.name } });
    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "tag.created",
      targetType: "Tag",
      targetId: tag.id,
      metadata: { name: tag.name },
    });
    return tag;
  }

  async listTags(workspaceId: string) {
    return this.prisma.tag.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
  }

  async addTagToContact(workspaceId: string, contactId: string, actorUserId: string, tagName: string) {
    await this.getOne(workspaceId, contactId);
    const tag = await this.prisma.tag.findUnique({ where: { workspaceId_name: { workspaceId, name: tagName } } });
    if (!tag) {
      throw new NotFoundException(`Tag "${tagName}" does not exist in this workspace; create it first`);
    }

    await this.prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId, tagId: tag.id } },
      create: { contactId, tagId: tag.id },
      update: {},
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "contact.tag_added",
      targetType: "Contact",
      targetId: contactId,
      metadata: { tag: tagName },
    });
  }

  async removeTagFromContact(workspaceId: string, contactId: string, actorUserId: string, tagName: string) {
    await this.getOne(workspaceId, contactId);
    const tag = await this.prisma.tag.findUnique({ where: { workspaceId_name: { workspaceId, name: tagName } } });
    if (!tag) {
      return;
    }
    await this.prisma.contactTag.deleteMany({ where: { contactId, tagId: tag.id } });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "contact.tag_removed",
      targetType: "Contact",
      targetId: contactId,
      metadata: { tag: tagName },
    });
  }

  // --- Custom fields ---

  async createCustomField(workspaceId: string, actorUserId: string, dto: CreateCustomFieldDto) {
    const existing = await this.prisma.customFieldDefinition.findUnique({
      where: { workspaceId_key: { workspaceId, key: dto.key } },
    });
    if (existing) {
      throw new ConflictException("A custom field with this key already exists in this workspace");
    }
    const field = await this.prisma.customFieldDefinition.create({ data: { workspaceId, ...dto } });
    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "custom_field.created",
      targetType: "CustomFieldDefinition",
      targetId: field.id,
      metadata: { key: field.key, type: field.type },
    });
    return field;
  }

  async listCustomFields(workspaceId: string) {
    return this.prisma.customFieldDefinition.findMany({ where: { workspaceId }, orderBy: { key: "asc" } });
  }

  async setCustomFieldValue(workspaceId: string, contactId: string, actorUserId: string, key: string, rawValue: unknown) {
    await this.getOne(workspaceId, contactId);
    const definition = await this.prisma.customFieldDefinition.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
    });
    if (!definition) {
      throw new NotFoundException(`Custom field "${key}" is not defined in this workspace`);
    }

    const coerced = coerceCustomFieldValue(definition.type, rawValue);

    const value = await this.prisma.customFieldValue.upsert({
      where: { contactId_fieldDefinitionId: { contactId, fieldDefinitionId: definition.id } },
      create: { contactId, fieldDefinitionId: definition.id, ...coerced },
      update: coerced,
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "contact.custom_field_set",
      targetType: "Contact",
      targetId: contactId,
      metadata: { key },
    });

    return value;
  }

  // --- Consent ---

  async recordConsent(workspaceId: string, contactId: string, actorUserId: string, dto: RecordConsentDto) {
    await this.getOne(workspaceId, contactId);
    const consent = await this.prisma.contactConsent.create({
      data: {
        contactId,
        workspaceId,
        channel: dto.channel,
        purpose: dto.purpose,
        source: dto.source,
        consentText: dto.consentText,
        grantedAt: new Date(),
      },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "contact.consent_granted",
      targetType: "ContactConsent",
      targetId: consent.id,
      metadata: { channel: dto.channel, purpose: dto.purpose, source: dto.source },
    });

    return consent;
  }

  async revokeConsent(workspaceId: string, contactId: string, actorUserId: string, consentId: string) {
    const consent = await this.prisma.contactConsent.findFirst({ where: { id: consentId, contactId, workspaceId } });
    if (!consent) {
      throw new NotFoundException("Consent record not found");
    }
    if (consent.revokedAt) {
      return consent;
    }
    const updated = await this.prisma.contactConsent.update({
      where: { id: consentId },
      data: { revokedAt: new Date() },
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "contact.consent_revoked",
      targetType: "ContactConsent",
      targetId: consentId,
    });

    return updated;
  }
}
