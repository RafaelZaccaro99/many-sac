import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AutomationExecutionStatus, AutomationStepStatus, AutomationVersionStatus, ChannelProvider, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CredentialsCipher } from "../../channels/credentials-cipher";
import { MetaAdapter } from "../../channels/adapters/meta/meta.adapter";
import { ConversationsService } from "../../conversations/conversations.service";
import { PolicyService } from "../../policy/policy.service";
import { POLICY_DENIAL_MESSAGES } from "../../policy/policy.types";
import { ExecutionQueueService } from "./execution-queue.service";
import { AutomationGraph, AutomationGraphNode, AutomationNodeType } from "../graph.types";
import { renderTemplate, VariableContext } from "./variable-resolver";
import { evaluateCondition, ConditionData } from "./condition-evaluator";
import { coerceCustomFieldValue, decodeCustomFieldValue } from "../../contacts/custom-field-coercion";

export const MAX_STEPS_PER_EXECUTION = 50;
const EXTERNAL_REQUEST_DEFAULT_TIMEOUT_MS = 10_000;

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
    private readonly conversationsService: ConversationsService,
    private readonly policyService: PolicyService,
    private readonly configService: ConfigService,
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
      flowVariables: (execution.contextJson as Record<string, unknown> | null) ?? {},
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
        await this.runHumanHandoff(execution, node, nextEdge);
        return;

      case AutomationNodeType.GOAL:
        await this.runGoal(executionId, node, nextEdge);
        return;

      case AutomationNodeType.ACTION:
        await this.runAction(execution, node, varContext, nextEdge);
        return;

      case AutomationNodeType.START_ANOTHER_FLOW:
        await this.runStartAnotherFlow(execution, node, nextEdge);
        return;

      case AutomationNodeType.COLLECT_INPUT:
        await this.runCollectInput(execution, node, nextEdge);
        return;

      case AutomationNodeType.EXTERNAL_REQUEST:
        await this.runExternalRequest(execution, node, varContext, nextEdge);
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

    const decision = await this.policyService.canSend(execution.contactId, execution.channelConnectionId, execution.channelConnection.provider);
    if (!decision.allowed) {
      // Not retryable: backoff won't reopen a messaging window or undo an opt-out.
      await this.failPermanently(execution.id, node.id, POLICY_DENIAL_MESSAGES[decision.reasonCode!]);
      return;
    }

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

  /**
   * Opens (or reuses) a Conversation for a human to pick up in the Inbox, and
   * parks the execution WAITING at the node after human_handoff - mirroring
   * runDelay's approach of pre-advancing currentNodeId - so that resuming it
   * later is just "flip status back to QUEUED and enqueue", the same as any
   * other resumed step.
   */
  private async runHumanHandoff(
    execution: LoadedExecution,
    node: AutomationGraphNode,
    nextEdge: AutomationGraph["edges"][number] | undefined,
  ): Promise<void> {
    if (!nextEdge) {
      await this.failPermanently(execution.id, node.id, "human_handoff node has no outgoing edge");
      return;
    }

    const conversationId = await this.conversationsService.openForHandoff(
      execution.workspaceId,
      execution.contactId,
      execution.channelConnectionId,
    );

    await this.recordStep(execution.id, node.id, AutomationStepStatus.COMPLETED, undefined, undefined);
    await this.prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: AutomationExecutionStatus.WAITING, currentNodeId: nextEdge.target, conversationId },
    });
  }

  /**
   * Pauses waiting for the contact's next message, unlike human_handoff/delay:
   * currentNodeId deliberately stays on this node (not pre-advanced to
   * nextEdge.target) because resuming needs to know which variableName to
   * fill and where to advance to - see CollectInputListener, which does both
   * atomically when the next contact.message_received event arrives.
   */
  private async runCollectInput(
    execution: LoadedExecution,
    node: AutomationGraphNode,
    nextEdge: AutomationGraph["edges"][number] | undefined,
  ): Promise<void> {
    if (!nextEdge) {
      await this.failPermanently(execution.id, node.id, "collect_input node has no outgoing edge");
      return;
    }
    if (typeof node.data.variableName !== "string" || !node.data.variableName) {
      await this.failPermanently(execution.id, node.id, "collect_input node needs a variableName");
      return;
    }

    await this.recordStep(execution.id, node.id, AutomationStepStatus.COMPLETED, { variableName: node.data.variableName }, undefined);
    await this.prisma.automationExecution.update({
      where: { id: execution.id },
      data: { status: AutomationExecutionStatus.WAITING },
    });
  }

  /**
   * Fails closed by default: EXTERNAL_REQUEST_ALLOWED_HOSTS (comma-separated
   * hostnames) must explicitly list a host before any node can call it. An
   * unset/empty allow-list means every external_request node fails - a
   * workspace Builder's automation must never be able to make the runtime
   * call an arbitrary URL (SSRF) just because they typed one into a node.
   */
  private isHostAllowed(hostname: string): boolean {
    const allowList = this.configService.get<string>("EXTERNAL_REQUEST_ALLOWED_HOSTS", "");
    const allowedHosts = allowList
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    return allowedHosts.includes(hostname);
  }

  private async runExternalRequest(
    execution: LoadedExecution,
    node: AutomationGraphNode,
    varContext: VariableContext,
    nextEdge: AutomationGraph["edges"][number] | undefined,
  ): Promise<void> {
    if (!nextEdge) {
      await this.failPermanently(execution.id, node.id, "external_request node has no outgoing edge");
      return;
    }

    const rawUrl = node.data.url;
    if (typeof rawUrl !== "string") {
      await this.failPermanently(execution.id, node.id, "external_request node needs a url");
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      await this.failPermanently(execution.id, node.id, `external_request node has an invalid url "${rawUrl}"`);
      return;
    }

    if (parsedUrl.protocol !== "https:" || !this.isHostAllowed(parsedUrl.hostname)) {
      await this.failPermanently(
        execution.id,
        node.id,
        `external_request host "${parsedUrl.hostname}" is not on the EXTERNAL_REQUEST_ALLOWED_HOSTS allow-list`,
      );
      return;
    }

    const method = typeof node.data.method === "string" ? node.data.method.toUpperCase() : "GET";
    const hasBody = method !== "GET" && method !== "DELETE";
    const renderedBody = typeof node.data.body === "string" ? renderTemplate(node.data.body, varContext) : node.data.body;
    const timeoutMs =
      typeof node.data.timeoutMs === "number" && node.data.timeoutMs > 0 ? node.data.timeoutMs : EXTERNAL_REQUEST_DEFAULT_TIMEOUT_MS;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      let responseText: string;
      try {
        response = await fetch(parsedUrl.toString(), {
          method,
          headers: { "Content-Type": "application/json" },
          body: hasBody ? JSON.stringify(renderedBody ?? {}) : undefined,
          signal: controller.signal,
        });
        responseText = await response.text();
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(`external_request failed (${response.status}): ${responseText.slice(0, 500)}`);
      }

      if (typeof node.data.saveResponseAs === "string" && node.data.saveResponseAs) {
        await this.setCustomFieldValue(execution, node.data.saveResponseAs, parseResponseBody(responseText));
      }

      await this.recordStep(
        execution.id,
        node.id,
        AutomationStepStatus.COMPLETED,
        { url: parsedUrl.toString(), method, status: response.status },
        undefined,
      );
      await this.advance(execution.id, nextEdge.target);
    } catch (err: any) {
      await this.recordStep(
        execution.id,
        node.id,
        AutomationStepStatus.FAILED,
        { url: parsedUrl.toString(), method },
        err?.message ?? String(err),
      );
      await this.prisma.automationExecution.update({
        where: { id: execution.id },
        data: { status: AutomationExecutionStatus.FAILED_RETRYABLE },
      });
      // Rethrown so BullMQ's attempts/backoff retries this step - same treatment as send_message.
      throw err;
    }
  }

  /** Pure marker/analytics node - has no side effect beyond recording that the contact reached it. */
  private async runGoal(executionId: string, node: AutomationGraphNode, nextEdge: AutomationGraph["edges"][number] | undefined): Promise<void> {
    const name = typeof node.data.name === "string" ? node.data.name : undefined;
    await this.recordStep(executionId, node.id, AutomationStepStatus.COMPLETED, { name }, undefined);
    await this.advance(executionId, nextEdge?.target ?? null);
  }

  private async runAction(
    execution: LoadedExecution,
    node: AutomationGraphNode,
    varContext: VariableContext,
    nextEdge: AutomationGraph["edges"][number] | undefined,
  ): Promise<void> {
    const actionType = node.data.actionType;

    try {
      switch (actionType) {
        case "add_tag":
          await this.runAddTag(execution, node);
          break;
        case "remove_tag":
          await this.runRemoveTag(execution, node);
          break;
        case "set_field":
          await this.runSetField(execution, node, varContext);
          break;
        default:
          await this.failPermanently(execution.id, node.id, `action node has unsupported actionType "${String(actionType)}"`);
          return;
      }
    } catch (err: any) {
      // Misconfiguration (unknown tag/field, bad value type) - not retryable.
      await this.failPermanently(execution.id, node.id, err?.message ?? String(err));
      return;
    }

    await this.recordStep(execution.id, node.id, AutomationStepStatus.COMPLETED, { actionType }, undefined);
    await this.advance(execution.id, nextEdge?.target ?? null);
  }

  private async runAddTag(execution: LoadedExecution, node: AutomationGraphNode): Promise<void> {
    const tagName = node.data.tag;
    if (typeof tagName !== "string" || !tagName) {
      throw new Error("add_tag action needs a tag name");
    }
    const tag = await this.prisma.tag.findUnique({ where: { workspaceId_name: { workspaceId: execution.workspaceId, name: tagName } } });
    if (!tag) {
      throw new Error(`Tag "${tagName}" does not exist in this workspace`);
    }
    await this.prisma.contactTag.upsert({
      where: { contactId_tagId: { contactId: execution.contactId, tagId: tag.id } },
      create: { contactId: execution.contactId, tagId: tag.id },
      update: {},
    });
  }

  private async runRemoveTag(execution: LoadedExecution, node: AutomationGraphNode): Promise<void> {
    const tagName = node.data.tag;
    if (typeof tagName !== "string" || !tagName) {
      throw new Error("remove_tag action needs a tag name");
    }
    const tag = await this.prisma.tag.findUnique({ where: { workspaceId_name: { workspaceId: execution.workspaceId, name: tagName } } });
    if (!tag) {
      return; // Nothing to remove.
    }
    await this.prisma.contactTag.deleteMany({ where: { contactId: execution.contactId, tagId: tag.id } });
  }

  private async runSetField(execution: LoadedExecution, node: AutomationGraphNode, varContext: VariableContext): Promise<void> {
    const key = node.data.key;
    if (typeof key !== "string" || !key) {
      throw new Error("set_field action needs a field key");
    }
    const rawValue = typeof node.data.value === "string" ? renderTemplate(node.data.value, varContext) : node.data.value;
    await this.setCustomFieldValue(execution, key, rawValue);
  }

  private async setCustomFieldValue(execution: LoadedExecution, key: string, rawValue: unknown): Promise<void> {
    const definition = await this.prisma.customFieldDefinition.findUnique({
      where: { workspaceId_key: { workspaceId: execution.workspaceId, key } },
    });
    if (!definition) {
      throw new Error(`Custom field "${key}" is not defined in this workspace`);
    }

    const coerced = coerceCustomFieldValue(definition.type, rawValue);

    await this.prisma.customFieldValue.upsert({
      where: { contactId_fieldDefinitionId: { contactId: execution.contactId, fieldDefinitionId: definition.id } },
      create: { contactId: execution.contactId, fieldDefinitionId: definition.id, ...coerced },
      update: coerced,
    });
  }

  /**
   * Fire-and-forget: spawns a new AutomationExecution for another published
   * automation against the same contact, then immediately advances past this
   * node - it does not wait for the spawned flow to finish. Deduped on
   * (automationVersionId, contactId, triggerEventId) like any other execution,
   * using a key tied to this exact step so a retried job never double-spawns.
   */
  private async runStartAnotherFlow(
    execution: LoadedExecution,
    node: AutomationGraphNode,
    nextEdge: AutomationGraph["edges"][number] | undefined,
  ): Promise<void> {
    const targetAutomationId = node.data.automationId;
    if (typeof targetAutomationId !== "string" || !targetAutomationId) {
      await this.failPermanently(execution.id, node.id, "start_another_flow node needs a target automationId");
      return;
    }
    if (targetAutomationId === execution.automationVersion.automationId) {
      // Guards the direct self-loop; an indirect cycle (A -> B -> A) is not detected.
      await this.failPermanently(execution.id, node.id, "start_another_flow cannot target its own automation");
      return;
    }

    const targetVersion = await this.prisma.automationVersion.findFirst({
      where: {
        automationId: targetAutomationId,
        status: AutomationVersionStatus.PUBLISHED,
        automation: { workspaceId: execution.workspaceId },
      },
    });
    if (!targetVersion) {
      await this.failPermanently(execution.id, node.id, `Automation ${targetAutomationId} has no published version in this workspace`);
      return;
    }

    const targetGraph = targetVersion.graph as unknown as AutomationGraph;
    const triggerNode = targetGraph.nodes.find((n) => n.type === AutomationNodeType.TRIGGER);
    const firstEdge = triggerNode ? targetGraph.edges.find((e) => e.source === triggerNode.id) : undefined;
    if (!triggerNode || !firstEdge) {
      await this.failPermanently(execution.id, node.id, `Target automation ${targetAutomationId} has no usable trigger`);
      return;
    }

    let spawnedExecutionId: string | null = null;
    try {
      const spawned = await this.prisma.automationExecution.create({
        data: {
          automationVersionId: targetVersion.id,
          workspaceId: execution.workspaceId,
          contactId: execution.contactId,
          channelConnectionId: execution.channelConnectionId,
          triggerEventId: `start_another_flow:${execution.id}:${node.id}`,
          status: AutomationExecutionStatus.QUEUED,
          currentNodeId: firstEdge.target,
        },
      });
      spawnedExecutionId = spawned.id;
      await this.executionQueue.enqueueStep(spawned.id, 0);
    } catch (err: any) {
      if (err?.code !== "P2002") {
        throw err;
      }
      // Already spawned by a prior attempt at this exact step - idempotent no-op.
    }

    await this.recordStep(execution.id, node.id, AutomationStepStatus.COMPLETED, { targetAutomationId, spawnedExecutionId }, undefined);
    await this.advance(execution.id, nextEdge?.target ?? null);
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

/** external_request responses are usually JSON; fall back to the raw text for anything else. */
function parseResponseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
