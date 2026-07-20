import { AutomationExecutionStatus, AutomationStepStatus } from "@prisma/client";
import { CollectInputListener } from "./collect-input.listener";
import { ContactMessageReceivedPayload, EventType, OutboxEventEnvelope } from "../../events/event-types";
import { AutomationNodeType } from "../graph.types";

const GRAPH = {
  nodes: [
    { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
    { id: "ci1", type: AutomationNodeType.COLLECT_INPUT, data: { variableName: "favorite_color" } },
    { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: { text: "You picked {{flow.favorite_color}}" } },
  ],
  edges: [
    { id: "e-t1-ci1", source: "t1", target: "ci1" },
    { id: "e-ci1-m1", source: "ci1", target: "m1" },
  ],
};

const HANDOFF_GRAPH = {
  nodes: [
    { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
    { id: "h1", type: AutomationNodeType.HUMAN_HANDOFF, data: {} },
  ],
  edges: [{ id: "e-t1-h1", source: "t1", target: "h1" }],
};

function buildListener(executions: any[]) {
  const stepExecutions: any[] = [];
  const updateCalls: Record<string, any> = {};

  const prisma = {
    automationExecution: {
      findMany: jest.fn().mockResolvedValue(executions),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        updateCalls[where.id] = data;
        const execution = executions.find((e) => e.id === where.id);
        Object.assign(execution, data);
        return execution;
      }),
    },
    automationStepExecution: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        stepExecutions.push(data);
        return data;
      }),
    },
  } as any;

  const executionQueue = { enqueueStep: jest.fn().mockResolvedValue(undefined) } as any;
  const listener = new CollectInputListener(prisma, executionQueue);
  return { listener, prisma, executionQueue, stepExecutions, updateCalls };
}

function envelope(text: string): OutboxEventEnvelope<ContactMessageReceivedPayload> {
  return {
    outboxEventId: "outbox-1",
    workspaceId: "ws-1",
    eventType: EventType.CONTACT_MESSAGE_RECEIVED,
    payload: {
      contactId: "contact-1",
      workspaceId: "ws-1",
      channelConnectionId: "conn-1",
      inboundEventId: "in-1",
      externalEventId: "ext-1",
      text,
      occurredAt: new Date().toISOString(),
    },
  };
}

describe("CollectInputListener", () => {
  it("injects the message text into contextJson under the node's variableName, advances, and enqueues", async () => {
    const execution = {
      id: "exec-1",
      currentNodeId: "ci1",
      contextJson: { already_there: "kept" },
      automationVersion: { graph: GRAPH },
    };
    const { listener, prisma, executionQueue, updateCalls } = buildListener([execution]);

    await listener.handleContactMessageReceived(envelope("blue"));

    expect(prisma.automationExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exec-1" },
        data: expect.objectContaining({
          status: AutomationExecutionStatus.QUEUED,
          currentNodeId: "m1",
          contextJson: { already_there: "kept", favorite_color: "blue" },
        }),
      }),
    );
    expect(executionQueue.enqueueStep).toHaveBeenCalledWith("exec-1", 0);
    void updateCalls;
  });

  it("ignores an execution WAITING for a different reason (e.g. human_handoff)", async () => {
    const execution = { id: "exec-2", currentNodeId: "h1", contextJson: {}, automationVersion: { graph: HANDOFF_GRAPH } };
    const { listener, prisma, executionQueue } = buildListener([execution]);

    await listener.handleContactMessageReceived(envelope("hello"));

    expect(prisma.automationExecution.update).not.toHaveBeenCalled();
    expect(executionQueue.enqueueStep).not.toHaveBeenCalled();
  });

  it("fails the execution permanently if the collect_input node is missing its outgoing edge", async () => {
    const brokenGraph = { nodes: GRAPH.nodes, edges: [{ id: "e-t1-ci1", source: "t1", target: "ci1" }] };
    const execution = { id: "exec-3", currentNodeId: "ci1", contextJson: {}, automationVersion: { graph: brokenGraph } };
    const { listener, prisma, stepExecutions } = buildListener([execution]);

    await listener.handleContactMessageReceived(envelope("blue"));

    expect(stepExecutions.at(-1)).toMatchObject({ executionId: "exec-3", status: AutomationStepStatus.FAILED });
    expect(prisma.automationExecution.update).toHaveBeenCalledWith({
      where: { id: "exec-3" },
      data: { status: AutomationExecutionStatus.FAILED_PERMANENT },
    });
  });

  it("stores an empty string when the inbound message has no text (e.g. an attachment-only message)", async () => {
    const execution = { id: "exec-4", currentNodeId: "ci1", contextJson: {}, automationVersion: { graph: GRAPH } };
    const { listener, prisma } = buildListener([execution]);

    await listener.handleContactMessageReceived(envelope(undefined as unknown as string));

    expect(prisma.automationExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contextJson: { favorite_color: "" } }) }),
    );
  });

  it("processes multiple contacts' WAITING executions independently in the same event", async () => {
    const executionA = { id: "exec-a", currentNodeId: "ci1", contextJson: {}, automationVersion: { graph: GRAPH } };
    const executionB = { id: "exec-b", currentNodeId: "h1", contextJson: {}, automationVersion: { graph: HANDOFF_GRAPH } };
    const { listener, executionQueue } = buildListener([executionA, executionB]);

    await listener.handleContactMessageReceived(envelope("blue"));

    expect(executionQueue.enqueueStep).toHaveBeenCalledTimes(1);
    expect(executionQueue.enqueueStep).toHaveBeenCalledWith("exec-a", 0);
  });
});
