import { Injectable, Logger } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { AutomationExecutionStatus, AutomationStepStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ContactMessageReceivedPayload, EventType, OutboxEventEnvelope } from "../../events/event-types";
import { ExecutionQueueService } from "./execution-queue.service";
import { AutomationGraph, AutomationNodeType } from "../graph.types";

/**
 * Reacts to contact.message_received (same event TriggerMatcherService and
 * ConversationsEventListener consume) to resume every execution WAITING at a
 * collect_input node for this contact - unlike human_handoff/delay, resuming
 * here must also inject the message text into contextJson under the node's
 * variableName before advancing, which is why ExecutionRunnerService doesn't
 * pre-advance currentNodeId for this node type (see runCollectInput).
 */
@Injectable()
export class CollectInputListener {
  private readonly logger = new Logger(CollectInputListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executionQueue: ExecutionQueueService,
  ) {}

  @OnEvent(EventType.CONTACT_MESSAGE_RECEIVED)
  async handleContactMessageReceived(envelope: OutboxEventEnvelope<ContactMessageReceivedPayload>): Promise<void> {
    const payload = envelope.payload;

    const waitingExecutions = await this.prisma.automationExecution.findMany({
      where: { contactId: payload.contactId, workspaceId: payload.workspaceId, status: AutomationExecutionStatus.WAITING },
      include: { automationVersion: true },
    });

    for (const execution of waitingExecutions) {
      const graph = execution.automationVersion.graph as unknown as AutomationGraph;
      const node = graph.nodes.find((n) => n.id === execution.currentNodeId);
      if (node?.type !== AutomationNodeType.COLLECT_INPUT) {
        continue; // WAITING for a different reason (human_handoff, delay) - not ours to resume.
      }

      const variableName = typeof node.data.variableName === "string" ? node.data.variableName : null;
      const nextEdge = graph.edges.find((e) => e.source === node.id);
      if (!variableName || !nextEdge) {
        await this.failExecution(execution.id, node.id, "collect_input node is missing a variableName or outgoing edge");
        continue;
      }

      const contextJson = { ...(execution.contextJson as Record<string, unknown> | null), [variableName]: payload.text ?? "" };
      await this.prisma.automationExecution.update({
        where: { id: execution.id },
        data: {
          status: AutomationExecutionStatus.QUEUED,
          currentNodeId: nextEdge.target,
          contextJson: contextJson as Prisma.InputJsonValue,
        },
      });
      await this.executionQueue.enqueueStep(execution.id, 0);
    }
  }

  private async failExecution(executionId: string, nodeId: string, message: string): Promise<void> {
    await this.prisma.automationStepExecution.create({
      data: { executionId, nodeId, status: AutomationStepStatus.FAILED, error: message, finishedAt: new Date() },
    });
    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: { status: AutomationExecutionStatus.FAILED_PERMANENT },
    });
    this.logger.error(`Execution ${executionId} failed permanently: ${message}`);
  }
}
