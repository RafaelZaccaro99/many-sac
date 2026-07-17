import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { AutomationExecutionStatus, AutomationVersionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { EventType, ContactMessageReceivedPayload, OutboxEventEnvelope } from "../../events/event-types";
import { ExecutionQueueService } from "./execution-queue.service";
import { AutomationGraph, AutomationGraphNode, AutomationNodeType } from "../graph.types";

/**
 * Reacts to canonical events (currently just contact.message_received) and
 * opens an AutomationExecution for every published automation whose trigger
 * matches - idempotently, via the DB unique constraint on
 * (automationVersionId, contactId, triggerEventId), never by checking-then-creating.
 */
@Injectable()
export class TriggerMatcherService {
  private readonly logger = new Logger(TriggerMatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executionQueue: ExecutionQueueService,
  ) {}

  @OnEvent(EventType.CONTACT_MESSAGE_RECEIVED)
  async handleContactMessageReceived(envelope: OutboxEventEnvelope<ContactMessageReceivedPayload>): Promise<void> {
    const payload = envelope.payload;

    const publishedVersions = await this.prisma.automationVersion.findMany({
      where: { status: AutomationVersionStatus.PUBLISHED, automation: { workspaceId: payload.workspaceId } },
    });

    for (const version of publishedVersions) {
      const graph = version.graph as unknown as AutomationGraph;
      const triggerNode = graph.nodes.find((n) => n.type === AutomationNodeType.TRIGGER);
      if (!triggerNode || !matchesTrigger(triggerNode, payload.text)) {
        continue;
      }

      const firstEdge = graph.edges.find((e) => e.source === triggerNode.id);
      if (!firstEdge) {
        this.logger.warn(`Automation version ${version.id} has a trigger with no outgoing edge - skipping`);
        continue;
      }

      try {
        const execution = await this.prisma.automationExecution.create({
          data: {
            automationVersionId: version.id,
            workspaceId: payload.workspaceId,
            contactId: payload.contactId,
            channelConnectionId: payload.channelConnectionId,
            triggerEventId: envelope.outboxEventId,
            status: AutomationExecutionStatus.QUEUED,
            currentNodeId: firstEdge.target,
          },
        });
        await this.executionQueue.enqueueStep(execution.id, 0);
      } catch (err: any) {
        if (err?.code === "P2002") {
          // Unique (automationVersionId, contactId, triggerEventId): this
          // trigger event already opened an execution - never open a second.
          continue;
        }
        throw err;
      }
    }
  }
}

function matchesTrigger(node: AutomationGraphNode, text: string | undefined): boolean {
  const keyword = node.data?.keyword;
  if (typeof keyword !== "string" || keyword.length === 0) {
    return true;
  }
  return typeof text === "string" && text.toLowerCase().includes(keyword.toLowerCase());
}
