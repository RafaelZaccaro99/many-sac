import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AutomationVersionStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../common/audit/audit.service";
import { validateGraph, ValidationIssue } from "./graph-validator";
import { AutomationGraph } from "./graph.types";
import { CreateAutomationDto } from "./dto/create-automation.dto";

const EMPTY_GRAPH: AutomationGraph = { nodes: [], edges: [] };

export class InvalidGraphShapeError extends BadRequestException {
  constructor() {
    super("graph must be an object with `nodes` and `edges` arrays");
  }
}

function assertGraphShape(value: unknown): asserts value is AutomationGraph {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as any).nodes) ||
    !Array.isArray((value as any).edges)
  ) {
    throw new InvalidGraphShapeError();
  }
}

@Injectable()
export class AutomationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(workspaceId: string, actorUserId: string, dto: CreateAutomationDto) {
    const automation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.automation.create({
        data: { workspaceId, name: dto.name, folderId: dto.folderId },
      });
      await tx.automationVersion.create({
        data: {
          automationId: created.id,
          versionNumber: 1,
          status: AutomationVersionStatus.DRAFT,
          graph: EMPTY_GRAPH as unknown as Prisma.InputJsonValue,
        },
      });
      return created;
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "automation.created",
      targetType: "Automation",
      targetId: automation.id,
      metadata: { name: automation.name },
    });

    return automation;
  }

  async list(workspaceId: string) {
    const automations = await this.prisma.automation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: { versions: { select: { status: true, versionNumber: true, publishedAt: true } } },
    });

    return automations.map((a) => ({
      id: a.id,
      name: a.name,
      folderId: a.folderId,
      createdAt: a.createdAt,
      hasDraft: a.versions.some((v) => v.status === AutomationVersionStatus.DRAFT),
      publishedVersion: a.versions.find((v) => v.status === AutomationVersionStatus.PUBLISHED)?.versionNumber ?? null,
    }));
  }

  async getOne(workspaceId: string, automationId: string) {
    const automation = await this.prisma.automation.findFirst({
      where: { id: automationId, workspaceId },
      include: { versions: { orderBy: { versionNumber: "desc" } } },
    });
    if (!automation) {
      throw new NotFoundException("Automation not found in this workspace");
    }
    return automation;
  }

  async updateDraft(workspaceId: string, automationId: string, actorUserId: string, rawGraph: unknown) {
    assertGraphShape(rawGraph);

    const automation = await this.getOne(workspaceId, automationId);
    const draft = automation.versions.find((v) => v.status === AutomationVersionStatus.DRAFT);

    const updated = draft
      ? await this.prisma.automationVersion.update({
          where: { id: draft.id },
          data: { graph: rawGraph as unknown as Prisma.InputJsonValue },
        })
      : await this.prisma.automationVersion.create({
          data: {
            automationId,
            versionNumber: nextVersionNumber(automation.versions),
            status: AutomationVersionStatus.DRAFT,
            graph: rawGraph as unknown as Prisma.InputJsonValue,
          },
        });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "automation.draft_updated",
      targetType: "Automation",
      targetId: automationId,
    });

    return updated;
  }

  async validate(workspaceId: string, automationId: string): Promise<ValidationIssue[]> {
    const automation = await this.getOne(workspaceId, automationId);
    const draft = automation.versions.find((v) => v.status === AutomationVersionStatus.DRAFT);
    if (!draft) {
      return [{ code: "NO_DRAFT", message: "There is no draft version to validate" }];
    }

    const customFieldKeys = (
      await this.prisma.customFieldDefinition.findMany({ where: { workspaceId }, select: { key: true } })
    ).map((f) => f.key);

    return validateGraph(draft.graph as unknown as AutomationGraph, { customFieldKeys });
  }

  /**
   * Publishing freezes the current draft as an immutable version and immediately
   * opens a new draft (a copy) so future edits never touch a version that might
   * already have live executions running against it.
   */
  async publish(workspaceId: string, automationId: string, actorUserId: string) {
    const issues = await this.validate(workspaceId, automationId);
    if (issues.length > 0) {
      throw new BadRequestException({ message: "Automation graph is not valid for publishing", issues });
    }

    const automation = await this.getOne(workspaceId, automationId);
    const draft = automation.versions.find((v) => v.status === AutomationVersionStatus.DRAFT)!;
    const previouslyPublished = automation.versions.find((v) => v.status === AutomationVersionStatus.PUBLISHED);

    const published = await this.prisma.$transaction(async (tx) => {
      if (previouslyPublished) {
        await tx.automationVersion.update({
          where: { id: previouslyPublished.id },
          data: { status: AutomationVersionStatus.ARCHIVED },
        });
      }

      const publishedVersion = await tx.automationVersion.update({
        where: { id: draft.id },
        data: { status: AutomationVersionStatus.PUBLISHED, publishedAt: new Date() },
      });

      await tx.automationVersion.create({
        data: {
          automationId,
          versionNumber: publishedVersion.versionNumber + 1,
          status: AutomationVersionStatus.DRAFT,
          graph: publishedVersion.graph as Prisma.InputJsonValue,
        },
      });

      return publishedVersion;
    });

    await this.auditService.record({
      workspaceId,
      actorUserId,
      action: "automation.published",
      targetType: "Automation",
      targetId: automationId,
      metadata: { versionNumber: published.versionNumber },
    });

    return published;
  }
}

function nextVersionNumber(versions: { versionNumber: number }[]): number {
  return versions.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
}
