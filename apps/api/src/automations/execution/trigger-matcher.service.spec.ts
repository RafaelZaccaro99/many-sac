import { AutomationExecutionStatus, AutomationVersionStatus } from "@prisma/client";
import { TriggerMatcherService } from "./trigger-matcher.service";
import { EventType } from "../../events/event-types";
import { AutomationNodeType } from "../graph.types";

const GRAPH = {
  nodes: [
    { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
    { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: { text: "hi" } },
  ],
  edges: [{ id: "e1", source: "t1", target: "m1" }],
};

const KEYWORD_GRAPH = {
  nodes: [
    { id: "t1", type: AutomationNodeType.TRIGGER, data: { keyword: "pricing" } },
    { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: { text: "hi" } },
  ],
  edges: [{ id: "e1", source: "t1", target: "m1" }],
};

function buildMatcher(versions: any[]) {
  const executions: any[] = [];
  const prisma = {
    automationVersion: { findMany: jest.fn().mockResolvedValue(versions) },
    automationExecution: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const key = `${data.automationVersionId}:${data.contactId}:${data.triggerEventId}`;
        if (executions.some((e) => e.key === key)) {
          const err: any = new Error("Unique constraint failed");
          err.code = "P2002";
          throw err;
        }
        const execution = { id: `exec-${executions.length + 1}`, key, ...data };
        executions.push(execution);
        return execution;
      }),
    },
  } as any;
  const executionQueue = { enqueueStep: jest.fn().mockResolvedValue(undefined) } as any;
  const matcher = new TriggerMatcherService(prisma, executionQueue);
  return { matcher, prisma, executionQueue, executions };
}

function envelope(text?: string) {
  return {
    outboxEventId: "outbox-1",
    workspaceId: "ws-1",
    eventType: EventType.CONTACT_MESSAGE_RECEIVED,
    payload: {
      contactId: "contact-1",
      workspaceId: "ws-1",
      channelConnectionId: "conn-1",
      inboundEventId: "inbound-1",
      externalEventId: "mid-1",
      text,
      occurredAt: new Date().toISOString(),
    },
  };
}

describe("TriggerMatcherService.handleContactMessageReceived", () => {
  it("opens an execution for a published automation with no keyword filter", async () => {
    const { matcher, executions, executionQueue } = buildMatcher([
      { id: "ver-1", status: AutomationVersionStatus.PUBLISHED, graph: GRAPH },
    ]);

    await matcher.handleContactMessageReceived(envelope("anything"));

    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({
      automationVersionId: "ver-1",
      contactId: "contact-1",
      currentNodeId: "m1",
      status: AutomationExecutionStatus.QUEUED,
    });
    expect(executionQueue.enqueueStep).toHaveBeenCalledWith("exec-1", 0);
  });

  it("only matches when the keyword is present in the message text", async () => {
    const { matcher, executions } = buildMatcher([
      { id: "ver-1", status: AutomationVersionStatus.PUBLISHED, graph: KEYWORD_GRAPH },
    ]);

    await matcher.handleContactMessageReceived(envelope("what's your pricing?"));
    expect(executions).toHaveLength(1);

    const { matcher: matcher2, executions: executions2 } = buildMatcher([
      { id: "ver-1", status: AutomationVersionStatus.PUBLISHED, graph: KEYWORD_GRAPH },
    ]);
    await matcher2.handleContactMessageReceived(envelope("hello there"));
    expect(executions2).toHaveLength(0);
  });

  it("never opens a second execution for the same (version, contact, triggerEvent)", async () => {
    const { matcher, executions } = buildMatcher([
      { id: "ver-1", status: AutomationVersionStatus.PUBLISHED, graph: GRAPH },
    ]);

    await matcher.handleContactMessageReceived(envelope("hi"));
    await matcher.handleContactMessageReceived(envelope("hi")); // same outboxEventId (retry/redelivery)

    expect(executions).toHaveLength(1);
  });

  it("skips automations whose trigger has no outgoing edge instead of crashing", async () => {
    const danglingGraph = { nodes: [{ id: "t1", type: AutomationNodeType.TRIGGER, data: {} }], edges: [] };
    const { matcher, executions } = buildMatcher([
      { id: "ver-1", status: AutomationVersionStatus.PUBLISHED, graph: danglingGraph },
    ]);

    await expect(matcher.handleContactMessageReceived(envelope("hi"))).resolves.toBeUndefined();
    expect(executions).toHaveLength(0);
  });
});
