import { AutomationExecutionStatus, AutomationStepStatus, ChannelProvider } from "@prisma/client";
import { ExecutionRunnerService, MAX_STEPS_PER_EXECUTION } from "./execution-runner.service";
import { AutomationNodeType } from "../graph.types";

const BASE_GRAPH = {
  nodes: [
    { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
    { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: { text: "Hi {{contact.first_name}}" } },
    { id: "c1", type: AutomationNodeType.CONDITION, data: { field: "contact.custom.plan", operator: "equals", value: "pro" } },
    { id: "d1", type: AutomationNodeType.DELAY, data: { durationMs: 60000 } },
    { id: "e1", type: AutomationNodeType.END, data: {} },
    { id: "e2", type: AutomationNodeType.END, data: {} },
    { id: "h1", type: AutomationNodeType.HUMAN_HANDOFF, data: {} },
    { id: "a1", type: AutomationNodeType.ACTION, data: {} },
  ],
  edges: [
    { id: "e-t1-m1", source: "t1", target: "m1" },
    { id: "e-m1-c1", source: "m1", target: "c1" },
    { id: "e-c1-true", source: "c1", target: "e1", sourceHandle: "true" },
    { id: "e-c1-false", source: "c1", target: "d1", sourceHandle: "false" },
    { id: "e-d1-e2", source: "d1", target: "e2" },
    { id: "e-e1-nothing", source: "e1", target: "h1" }, // never taken; e1 has no outgoing edge processed
  ],
};

function buildRunner(overrides: Partial<any> = {}) {
  const execution: any = {
    id: "exec-1",
    workspaceId: "ws-1",
    contactId: "contact-1",
    channelConnectionId: "conn-1",
    automationVersionId: "ver-1",
    triggerEventId: "outbox-1",
    status: AutomationExecutionStatus.QUEUED,
    currentNodeId: "m1",
    stepCount: 0,
    automationVersion: { graph: BASE_GRAPH },
    contact: { firstName: "Ana", lastName: null, primaryEmail: null, primaryPhone: null, fieldValues: [] },
    channelConnection: { provider: ChannelProvider.INSTAGRAM, externalAccountId: "page-123", credentialsEncrypted: "enc-token" },
    ...overrides,
  };

  const stepExecutions: any[] = [];
  const updateCalls: any[] = [];

  const prisma = {
    automationExecution: {
      findUnique: jest.fn().mockImplementation(async () => (execution ? { ...execution } : null)),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        updateCalls.push(data);
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
    contactIdentity: {
      findFirst: jest.fn().mockResolvedValue({ externalId: "user-456" }),
    },
    workspace: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ name: "Acme" }),
    },
  } as any;

  const credentialsCipher = { decrypt: jest.fn().mockReturnValue("decrypted-token") } as any;
  const metaAdapter = { sendMessage: jest.fn().mockResolvedValue({ providerMessageId: "mid-1", status: "sent" }) } as any;
  const executionQueue = { enqueueStep: jest.fn().mockResolvedValue(undefined) } as any;

  const runner = new ExecutionRunnerService(prisma, credentialsCipher, metaAdapter, executionQueue);
  return { runner, prisma, credentialsCipher, metaAdapter, executionQueue, execution, stepExecutions, updateCalls };
}

describe("ExecutionRunnerService.runStep", () => {
  it("is a no-op when the execution is already terminal (idempotent against duplicate job delivery)", async () => {
    const { runner, prisma } = buildRunner({ status: AutomationExecutionStatus.COMPLETED });
    await runner.runStep("exec-1");
    expect(prisma.automationExecution.update).not.toHaveBeenCalled();
  });

  it("logs and returns when the execution no longer exists", async () => {
    const { runner } = buildRunner();
    const runnerNoExec = new ExecutionRunnerService(
      { automationExecution: { findUnique: jest.fn().mockResolvedValue(null) } } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await expect(runnerNoExec.runStep("missing")).resolves.toBeUndefined();
    void runner;
  });

  it("sends a rendered message, advances to the next node, and enqueues the next step immediately", async () => {
    const { runner, metaAdapter, executionQueue, updateCalls, stepExecutions } = buildRunner();

    await runner.runStep("exec-1");

    expect(metaAdapter.sendMessage).toHaveBeenCalledWith(
      { externalAccountId: "page-123", recipientExternalId: "user-456", text: "Hi Ana" },
      "decrypted-token",
    );
    expect(stepExecutions.at(-1)).toMatchObject({ nodeId: "m1", status: AutomationStepStatus.COMPLETED });
    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.QUEUED, currentNodeId: "c1" });
    expect(executionQueue.enqueueStep).toHaveBeenCalledWith("exec-1", 0);
  });

  it("marks FAILED_RETRYABLE and rethrows when sending the message fails, so BullMQ retries", async () => {
    const { runner, metaAdapter, updateCalls, stepExecutions } = buildRunner();
    metaAdapter.sendMessage.mockRejectedValue(new Error("Graph API down"));

    await expect(runner.runStep("exec-1")).rejects.toThrow("Graph API down");

    expect(stepExecutions.at(-1)).toMatchObject({ nodeId: "m1", status: AutomationStepStatus.FAILED, error: "Graph API down" });
    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_RETRYABLE });
  });

  it("follows the true branch of a condition node", async () => {
    const { runner, updateCalls } = buildRunner({ currentNodeId: "c1", contact: { firstName: "Ana", fieldValues: [] } });
    // plan field is undefined -> equals "pro" is false, so this should take the false branch by default;
    // override with a custom field value matching "pro" to force the true branch.
    const { runner: runnerTrue, prisma, updateCalls: updateCallsTrue } = buildRunner({
      currentNodeId: "c1",
      contact: {
        firstName: "Ana",
        fieldValues: [{ fieldDefinition: { key: "plan", type: "TEXT" }, valueText: "pro" }],
      },
    });

    await runnerTrue.runStep("exec-1");
    expect(updateCallsTrue.at(-1)).toMatchObject({ currentNodeId: "e1" });

    await runner.runStep("exec-1");
    expect(updateCalls.at(-1)).toMatchObject({ currentNodeId: "d1" });
    void prisma;
  });

  it("fails permanently (without throwing) when a condition branch has no matching edge", async () => {
    const brokenGraph = {
      nodes: BASE_GRAPH.nodes,
      edges: [{ id: "e-c1-true-only", source: "c1", target: "e1", sourceHandle: "true" }],
    };
    const { runner, updateCalls, stepExecutions } = buildRunner({
      currentNodeId: "c1",
      automationVersion: { graph: brokenGraph },
      contact: { firstName: "Ana", fieldValues: [] },
    });

    await expect(runner.runStep("exec-1")).resolves.toBeUndefined();
    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    expect(stepExecutions.at(-1).status).toBe(AutomationStepStatus.FAILED);
  });

  it("schedules a delayed job for a delay node and moves currentNodeId to the node after it", async () => {
    const { runner, executionQueue, updateCalls } = buildRunner({ currentNodeId: "d1" });

    await runner.runStep("exec-1");

    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.WAITING, currentNodeId: "e2" });
    expect(executionQueue.enqueueStep).toHaveBeenCalledWith("exec-1", 60000);
  });

  it("completes the execution at an end node", async () => {
    const { runner, updateCalls, executionQueue } = buildRunner({ currentNodeId: "e2" });

    await runner.runStep("exec-1");

    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.COMPLETED, currentNodeId: null });
    expect(executionQueue.enqueueStep).not.toHaveBeenCalled();
  });

  it("pauses at a human_handoff node without enqueuing further work", async () => {
    const { runner, updateCalls, executionQueue } = buildRunner({ currentNodeId: "h1" });

    await runner.runStep("exec-1");

    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.WAITING });
    expect(executionQueue.enqueueStep).not.toHaveBeenCalled();
  });

  it("fails permanently for a node type the runtime doesn't support yet", async () => {
    const { runner, updateCalls } = buildRunner({ currentNodeId: "a1" });

    await runner.runStep("exec-1");

    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
  });

  it("fails permanently once the step limit is exceeded, without touching the queue", async () => {
    const { runner, updateCalls, executionQueue } = buildRunner({ stepCount: MAX_STEPS_PER_EXECUTION });

    await runner.runStep("exec-1");

    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    expect(executionQueue.enqueueStep).not.toHaveBeenCalled();
  });

  it("fails permanently if currentNodeId points at a node that no longer exists in the graph", async () => {
    const { runner, updateCalls } = buildRunner({ currentNodeId: "ghost-node" });

    await runner.runStep("exec-1");

    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
  });
});
