import { Injectable, Logger } from "@nestjs/common";
import { AutomationExecutionStatus, AutomationStepStatus, ChannelProvider, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CredentialsCipher } from "../../channels/credentials-cipher";
import { MetaAdapter } from "../../channels/adapters/meta/meta.adapter";
import { ExecutionQueueService } from "./execution-queue.service";
import { AutomationGraph, AutomationGraphNode, AutomationNodeType } from "../graph.types";
import { renderTemplate, VariableContext } from "./variable-resolver";
import { evaluateCondition, ConditionData } from "./condition-evaluator";
import { decodeCustomFieldValue } from "../../contacts/custom-field-coercion";

export const MAX_STEPS_PER_EXECUTION = 50;

const EXECUTION_INCLUDE = {
  automationVersion: true,
  contact: { include: { fieldValues: { include: { fieldDefinition: true } } } },
  channelConnection: true,
} satisfies Prisma.AutomationExecutionInclude;

type LoadedExecution = Prisma.AutomationExecutionGetPayload<{ include: typeof EXECUTION_INCLUDE }>;

/**
 * Advances one automation execution by exactly one node. Each BullMQ job calls
 * this once; the method decides whether to enqueue the next step (immediately
 * or delayed), leave the execution WAITING, or terminate it. Kept as plain
 * injectable business logic (no BullMQ types in the signature) so it's testable
 * without a live queue or Redis - see execution.processor.ts for the thin
 * framework adapter that actually gets invoked by BullMQ.
 */
@Injectable()
export class ExecutionRunnerService {
  private readonly logger = new Logger(ExecutionRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialsCipher: CredentialsCipher,
    private readonly metaAdapter: MetaAdapter,
    private readonly executionQueue: ExecutionQueueService,
  ) {}

  async runStep(executionId: string): Promise<void> {
    const execution = await this.prisma.automationExecution.findUnique({
      where: { id: executionId },
      include: EXECUTION_INCLUDE,
    });

    if (!execution) {
      this.logger.warn(`Execution ${executionId} not found - skipping (already deleted?)`);
      return;
    }

    // Idempotent guard: a duplicate/late job delivery for an already-terminal
    // execution must be a no-op, never re-run a completed or failed execution.
    if (isTerminal(execution.status)) {
      return;
    }

    const nextStepCount = execution.stepCount + 1;
    if (nextStepCount > MAX_STEPS_PER_EXECUTION) {
      await this.failPermanently(executionId, execution.currentNodeId, "step limit exceeded (possible loop)");
      return;
    }

    const graph = execution.automationVersion.graph as unknown as AutomationGraph;
    const node = graph.nodes.find((n) => n.id === execution.currentNodeId);
    if (!node) {
      await this.failPermanently(executionId, execution.currentNodeId, `node ${execution.currentNodeId} not found in graph`);
      return;
    }

    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: { status: AutomationExecutionStatus.RUNNING, stepCount: nextStepCount },
    });

    const workspace = await this.prisma.workspace.findUniqueOrThrow({ where: { id: execution.workspaceId } });
    const varContext: VariableContext = {
      contact: {
        firstName: execution.contact.firstName,
        lastName: execution.contact.lastName,
        primaryEmail: execution.contact.primaryEmail,
        primaryPhone: execution.contact.primaryPhone,
      },
      workspaceName: workspace.name,
      customFieldValues: Object.fromEntries(
        execution.contact.fieldValues.map((fv) => [fv.fieldDefinition.key, decodeCustomFieldValue(fv.fieldDefinition.type, fv)]),
      ),
    };

    const nextEdge = graph.edges.find((e) => e.source === node.id);

    switch (node.type) {
      case AutomationNodeType.SEND_MESSAGE:
        await this.runSendMessage(execution, node, graph, varContext, nextEdge);
        return;

      case AutomationNodeType.CONDITION:
        await this.runCondition(executionId, node, graph, varContext);
        return;

      case AutomationNodeType.DELAY:
        await this.runDelay(executionId, node, nextEdge);
        return;

      case AutomationNodeType.END:
        await this.recordStep(executionId, node.id, AutomationStepStatus.COMPLETED);
        await this.prisma.automationExecution.update({
          where: { id: executionId },
          data: { status: AutomationExecutionStatus.COMPLETED, currentNodeId: null },
        });
        return;

      case AutomationNodeType.HUMAN_HANDOFF:
        // Conversation/Inbox model lands in a later milestone; for now the
        // execution simply pauses here rather than pretending to hand off.
        await this.recordStep(executionId, node.id, AutomationStepStatus.COMPLETED, undefined, undefined);
        await this.prisma.automationExecution.update({
          where: { id: executionId },
          data: { status: AutomationExecutionStatus.WAITING },
        });
        return;

      default:
        await this.failPermanently(executionId, node.id, `node type "${node.type}" is not supported by the runtime yet`);
    }
  }

  private async runSendMessage(
    execution: LoadedExecution,
    node: AutomationGraphNode,
    graph: AutomationGraph,
    varContext: VariableContext,
    nextEdge: AutomationGraph["edges"][number] | undefined,
  ): Promise<void> {
    const text = typeof node.data.text === "string" ? renderTemplate(node.data.text, varContext) : undefined;

    try {
      const recipientExternalId = await this.resolveRecipientExternalId(execution);
      const credentials = this.credentialsCipher.decrypt(execution.channelConnection.credentialsEncrypted);

      await this.metaAdapter.sendMessage(
        {
          externalAccountId: execution.channelConnection.externalAccountId,
          recipientExternalId,
          text,
        },
        credentials,
      );

      await this.recordStep(execution.id, node.id, AutomationStepStatus.COMPLETED, { text }, undefined);
      await this.advance(execution.id, nextEdge?.target ?? null);
    } catch (err: any) {
      await this.recordStep(execution.id, node.id, AutomationStepStatus.FAILED, { text }, err?.message ?? String(err));
      await this.prisma.automationExecution.update({
        where: { id: execution.id },
        data: { status: AutomationExecutionStatus.FAILED_RETRYABLE },
      });
      // Rethrown so BullMQ's attempts/backoff retries this step; only a send
      // failure is treated as transient - structural errors never throw here.
      throw err;
    }
  }

  private async resolveRecipientExternalId(execution: {
    workspaceId: string;
    contactId: string;
    channelConnection: { provider: ChannelProvider };
  }): Promise<string> {
    const identity = await this.prisma.contactIdentity.findFirst({
      where: { workspaceId: execution.workspaceId, contactId: execution.contactId, channel: execution.channelConnection.provider },
    });
    if (!identity) {
      throw new Error(`No contact identity found for channel ${execution.channelConnection.provider}`);
    }
    return identity.externalId;
  }

  private async runCondition(executionId: string, node: AutomationGraphNode, graph: AutomationGraph, varContext: VariableContext): Promise<void> {
    const result = evaluateCondition(node.data as unknown as ConditionData, varContext);
    const branch = result ? "true" : "false";
    const edge = graph.edges.find((e) => e.source === node.id && e.sourceHandle === branch);

    if (!edge) {
      await this.failPermanently(executionId, node.id, `condition node has no outgoing edge for branch "${branch}"`);
      return;
    }

    await this.recordStep(executionId, node.id, AutomationStepStatus.COMPLETED, { result }, undefined);
    await this.advance(executionId, edge.target);
  }

  private async runDelay(executionId: string, node: AutomationGraphNode, nextEdge: AutomationGraph["edges"][number] | undefined): Promise<void> {
    const durationMs = typeof node.data.durationMs === "number" ? node.data.durationMs : 0;
    if (!nextEdge) {
      await this.failPermanently(executionId, node.id, "delay node has no outgoing edge");
      return;
    }

    await this.recordStep(executionId, node.id, AutomationStepStatus.COMPLETED, { durationMs }, undefined);
    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: { status: AutomationExecutionStatus.WAITING, currentNodeId: nextEdge.target },
    });
    await this.executionQueue.enqueueStep(executionId, durationMs);
  }

  private async advance(executionId: string, nextNodeId: string | null): Promise<void> {
    if (!nextNodeId) {
      await this.failPermanently(executionId, null, "node has no outgoing edge to advance to");
      return;
    }
    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: { status: AutomationExecutionStatus.QUEUED, currentNodeId: nextNodeId },
    });
    await this.executionQueue.enqueueStep(executionId, 0);
  }

  private async failPermanently(executionId: string, nodeId: string | null, message: string): Promise<void> {
    if (nodeId) {
      await this.recordStep(executionId, nodeId, AutomationStepStatus.FAILED, undefined, message);
    }
    await this.prisma.automationExecution.update({
      where: { id: executionId },
      data: { status: AutomationExecutionStatus.FAILED_PERMANENT },
    });
    this.logger.error(`Execution ${executionId} failed permanently: ${message}`);
  }

  private async recordStep(
    executionId: string,
    nodeId: string,
    status: AutomationStepStatus,
    input?: unknown,
    error?: string,
  ): Promise<void> {
    await this.prisma.automationStepExecution.create({
      data: {
        executionId,
        nodeId,
        status,
        input: input as Prisma.InputJsonValue | undefined,
        error,
        finishedAt: new Date(),
      },
    });
  }
}

function isTerminal(status: AutomationExecutionStatus): boolean {
  return (
    status === AutomationExecutionStatus.COMPLETED ||
    status === AutomationExecutionStatus.FAILED_PERMANENT ||
    status === AutomationExecutionStatus.CANCELED
  );
}
