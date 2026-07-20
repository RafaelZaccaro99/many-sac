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
    { id: "a1", type: AutomationNodeType.ACTION, data: { actionType: "add_tag", tag: "vip" } },
    { id: "g1", type: AutomationNodeType.GOAL, data: { name: "signup_started" } },
    { id: "s1", type: AutomationNodeType.START_ANOTHER_FLOW, data: { automationId: "auto-other" } },
    { id: "ci1", type: AutomationNodeType.COLLECT_INPUT, data: { variableName: "favorite_color" } },
    { id: "x1", type: AutomationNodeType.EXTERNAL_REQUEST, data: { url: "https://api.example.com/lookup", method: "post", saveResponseAs: "plan" } },
  ],
  edges: [
    { id: "e-t1-m1", source: "t1", target: "m1" },
    { id: "e-m1-c1", source: "m1", target: "c1" },
    { id: "e-c1-true", source: "c1", target: "e1", sourceHandle: "true" },
    { id: "e-c1-false", source: "c1", target: "d1", sourceHandle: "false" },
    { id: "e-d1-e2", source: "d1", target: "e2" },
    { id: "e-h1-e2", source: "h1", target: "e2" },
    { id: "e-a1-e2", source: "a1", target: "e2" },
    { id: "e-g1-e2", source: "g1", target: "e2" },
    { id: "e-s1-e2", source: "s1", target: "e2" },
    { id: "e-ci1-e2", source: "ci1", target: "e2" },
    { id: "e-x1-e2", source: "x1", target: "e2" },
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
    automationVersion: { graph: BASE_GRAPH, automationId: "auto-self" },
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
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: "spawned-exec-1", ...data })),
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
    tag: {
      findUnique: jest.fn().mockResolvedValue({ id: "tag-1", name: "vip" }),
    },
    contactTag: {
      upsert: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    customFieldDefinition: {
      findUnique: jest.fn().mockResolvedValue({ id: "field-1", key: "plan", type: "TEXT" }),
    },
    customFieldValue: {
      upsert: jest.fn().mockResolvedValue(undefined),
    },
    automationVersion: {
      findFirst: jest.fn().mockResolvedValue({
        id: "other-ver-1",
        automationId: "auto-other",
        graph: { nodes: [{ id: "ot1", type: AutomationNodeType.TRIGGER, data: {} }], edges: [{ id: "e-ot1-oe1", source: "ot1", target: "oe1" }] },
      }),
    },
  } as any;

  const credentialsCipher = { decrypt: jest.fn().mockReturnValue("decrypted-token") } as any;
  const metaAdapter = { sendMessage: jest.fn().mockResolvedValue({ providerMessageId: "mid-1", status: "sent" }) } as any;
  const executionQueue = { enqueueStep: jest.fn().mockResolvedValue(undefined) } as any;
  const conversationsService = { openForHandoff: jest.fn().mockResolvedValue("conv-1") } as any;
  const policyService = { canSend: jest.fn().mockResolvedValue({ allowed: true, reasonCode: null }) } as any;
  const configService = { get: jest.fn().mockReturnValue("") } as any;

  const runner = new ExecutionRunnerService(
    prisma,
    credentialsCipher,
    metaAdapter,
    executionQueue,
    conversationsService,
    policyService,
    configService,
  );
  return {
    runner,
    prisma,
    credentialsCipher,
    metaAdapter,
    executionQueue,
    conversationsService,
    policyService,
    configService,
    execution,
    stepExecutions,
    updateCalls,
  };
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

  it("fails permanently without retrying when the Policy Engine denies the send", async () => {
    const { runner, metaAdapter, executionQueue, policyService, updateCalls } = buildRunner();
    policyService.canSend.mockResolvedValue({ allowed: false, reasonCode: "OPTED_OUT" });

    await runner.runStep("exec-1");

    expect(policyService.canSend).toHaveBeenCalledWith("contact-1", "conn-1", ChannelProvider.INSTAGRAM);
    expect(metaAdapter.sendMessage).not.toHaveBeenCalled();
    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    expect(executionQueue.enqueueStep).not.toHaveBeenCalled();
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

  it("opens a conversation and pauses at the node after human_handoff, without enqueuing further work", async () => {
    const { runner, updateCalls, executionQueue, conversationsService } = buildRunner({ currentNodeId: "h1" });

    await runner.runStep("exec-1");

    expect(conversationsService.openForHandoff).toHaveBeenCalledWith("ws-1", "contact-1", "conn-1");
    expect(updateCalls.at(-1)).toMatchObject({
      status: AutomationExecutionStatus.WAITING,
      currentNodeId: "e2",
      conversationId: "conv-1",
    });
    expect(executionQueue.enqueueStep).not.toHaveBeenCalled();
  });

  it("fails permanently when a human_handoff node has no outgoing edge", async () => {
    const brokenGraph = {
      nodes: BASE_GRAPH.nodes,
      edges: BASE_GRAPH.edges.filter((e) => e.source !== "h1"),
    };
    const { runner, updateCalls, conversationsService } = buildRunner({
      currentNodeId: "h1",
      automationVersion: { graph: brokenGraph },
    });

    await runner.runStep("exec-1");

    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    expect(conversationsService.openForHandoff).not.toHaveBeenCalled();
  });

  it("fails permanently for a node type the runtime doesn't support yet", async () => {
    const futureTypeGraph = {
      nodes: [...BASE_GRAPH.nodes, { id: "future1", type: "some_future_node_type" as any, data: {} }],
      edges: BASE_GRAPH.edges,
    };
    const { runner, updateCalls } = buildRunner({ currentNodeId: "future1", automationVersion: { graph: futureTypeGraph, automationId: "auto-self" } });

    await runner.runStep("exec-1");

    expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
  });

  describe("action node", () => {
    it("adds a tag to the contact and advances", async () => {
      const { runner, prisma, updateCalls, stepExecutions } = buildRunner({ currentNodeId: "a1" });

      await runner.runStep("exec-1");

      expect(prisma.tag.findUnique).toHaveBeenCalledWith({ where: { workspaceId_name: { workspaceId: "ws-1", name: "vip" } } });
      expect(prisma.contactTag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: { contactId: "contact-1", tagId: "tag-1" } }),
      );
      expect(stepExecutions.at(-1)).toMatchObject({ nodeId: "a1", status: AutomationStepStatus.COMPLETED });
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.QUEUED, currentNodeId: "e2" });
    });

    it("fails permanently when add_tag references a tag that doesn't exist", async () => {
      const { runner, prisma, updateCalls } = buildRunner({ currentNodeId: "a1" });
      prisma.tag.findUnique.mockResolvedValue(null);

      await runner.runStep("exec-1");

      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
      expect(prisma.contactTag.upsert).not.toHaveBeenCalled();
    });

    it("removes a tag from the contact, tolerating a tag that no longer exists", async () => {
      const removeGraph = {
        nodes: BASE_GRAPH.nodes.map((n) => (n.id === "a1" ? { ...n, data: { actionType: "remove_tag", tag: "vip" } } : n)),
        edges: BASE_GRAPH.edges,
      };
      const { runner, prisma, updateCalls } = buildRunner({ currentNodeId: "a1", automationVersion: { graph: removeGraph, automationId: "auto-self" } });
      prisma.tag.findUnique.mockResolvedValue(null);

      await runner.runStep("exec-1");

      expect(prisma.contactTag.deleteMany).not.toHaveBeenCalled();
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.QUEUED, currentNodeId: "e2" });
    });

    it("coerces and sets a custom field value, rendering variables in a string value", async () => {
      const setFieldGraph = {
        nodes: BASE_GRAPH.nodes.map((n) =>
          n.id === "a1" ? { ...n, data: { actionType: "set_field", key: "plan", value: "{{contact.first_name}}-plan" } } : n,
        ),
        edges: BASE_GRAPH.edges,
      };
      const { runner, prisma, updateCalls } = buildRunner({
        currentNodeId: "a1",
        automationVersion: { graph: setFieldGraph, automationId: "auto-self" },
      });

      await runner.runStep("exec-1");

      expect(prisma.customFieldValue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ valueText: "Ana-plan" }) }),
      );
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.QUEUED, currentNodeId: "e2" });
    });

    it("fails permanently for an unknown actionType", async () => {
      const badGraph = {
        nodes: BASE_GRAPH.nodes.map((n) => (n.id === "a1" ? { ...n, data: { actionType: "delete_contact" } } : n)),
        edges: BASE_GRAPH.edges,
      };
      const { runner, updateCalls } = buildRunner({ currentNodeId: "a1", automationVersion: { graph: badGraph, automationId: "auto-self" } });

      await runner.runStep("exec-1");

      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    });
  });

  describe("goal node", () => {
    it("records reaching the goal and advances, without any side effect", async () => {
      const { runner, updateCalls, stepExecutions } = buildRunner({ currentNodeId: "g1" });

      await runner.runStep("exec-1");

      expect(stepExecutions.at(-1)).toMatchObject({ nodeId: "g1", status: AutomationStepStatus.COMPLETED, input: { name: "signup_started" } });
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.QUEUED, currentNodeId: "e2" });
    });
  });

  describe("start_another_flow node", () => {
    it("spawns an execution for the target automation's published trigger and advances past itself", async () => {
      const { runner, prisma, executionQueue, updateCalls, stepExecutions } = buildRunner({ currentNodeId: "s1" });

      await runner.runStep("exec-1");

      expect(prisma.automationVersion.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ automationId: "auto-other" }) }),
      );
      expect(prisma.automationExecution.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            automationVersionId: "other-ver-1",
            contactId: "contact-1",
            currentNodeId: "oe1",
            triggerEventId: "start_another_flow:exec-1:s1",
          }),
        }),
      );
      expect(executionQueue.enqueueStep).toHaveBeenCalledWith("spawned-exec-1", 0);
      expect(stepExecutions.at(-1)).toMatchObject({ nodeId: "s1", status: AutomationStepStatus.COMPLETED });
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.QUEUED, currentNodeId: "e2" });
    });

    it("fails permanently instead of spawning when the target automation is the same one currently running", async () => {
      const selfGraph = {
        nodes: BASE_GRAPH.nodes.map((n) => (n.id === "s1" ? { ...n, data: { automationId: "auto-self" } } : n)),
        edges: BASE_GRAPH.edges,
      };
      const { runner, prisma, updateCalls } = buildRunner({ currentNodeId: "s1", automationVersion: { graph: selfGraph, automationId: "auto-self" } });

      await runner.runStep("exec-1");

      expect(prisma.automationExecution.create).not.toHaveBeenCalled();
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    });

    it("fails permanently when the target automation has no published version", async () => {
      const { runner, prisma, updateCalls } = buildRunner({ currentNodeId: "s1" });
      prisma.automationVersion.findFirst.mockResolvedValue(null);

      await runner.runStep("exec-1");

      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    });

    it("treats a duplicate spawn (unique constraint) as an idempotent no-op and still advances", async () => {
      const { runner, prisma, updateCalls } = buildRunner({ currentNodeId: "s1" });
      const conflict: any = new Error("duplicate");
      conflict.code = "P2002";
      prisma.automationExecution.create.mockRejectedValue(conflict);

      await runner.runStep("exec-1");

      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.QUEUED, currentNodeId: "e2" });
    });
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

  describe("collect_input node", () => {
    it("pauses WAITING without pre-advancing currentNodeId or touching the queue", async () => {
      const { runner, updateCalls, stepExecutions, executionQueue } = buildRunner({ currentNodeId: "ci1" });

      await runner.runStep("exec-1");

      expect(stepExecutions.at(-1)).toMatchObject({ nodeId: "ci1", status: AutomationStepStatus.COMPLETED, input: { variableName: "favorite_color" } });
      expect(updateCalls.at(-1)).toEqual({ status: AutomationExecutionStatus.WAITING });
      expect(executionQueue.enqueueStep).not.toHaveBeenCalled();
    });

    it("fails permanently when a collect_input node has no outgoing edge", async () => {
      const brokenGraph = { nodes: BASE_GRAPH.nodes, edges: BASE_GRAPH.edges.filter((e) => e.source !== "ci1") };
      const { runner, updateCalls } = buildRunner({ currentNodeId: "ci1", automationVersion: { graph: brokenGraph, automationId: "auto-self" } });

      await runner.runStep("exec-1");

      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    });

    it("fails permanently when a collect_input node has no variableName", async () => {
      const badGraph = {
        nodes: BASE_GRAPH.nodes.map((n) => (n.id === "ci1" ? { ...n, data: {} } : n)),
        edges: BASE_GRAPH.edges,
      };
      const { runner, updateCalls } = buildRunner({ currentNodeId: "ci1", automationVersion: { graph: badGraph, automationId: "auto-self" } });

      await runner.runStep("exec-1");

      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    });
  });

  describe("external_request node", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("fails permanently (without calling fetch) when the host isn't on the allow-list", async () => {
      const fetchSpy = jest.spyOn(global, "fetch");
      const { runner, updateCalls, configService } = buildRunner({ currentNodeId: "x1" });
      configService.get.mockReturnValue("");

      await runner.runStep("exec-1");

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    });

    it("fails permanently for a non-https url even if the host is allow-listed", async () => {
      const insecureGraph = {
        nodes: BASE_GRAPH.nodes.map((n) => (n.id === "x1" ? { ...n, data: { ...n.data, url: "http://api.example.com/lookup" } } : n)),
        edges: BASE_GRAPH.edges,
      };
      const fetchSpy = jest.spyOn(global, "fetch");
      const { runner, updateCalls, configService } = buildRunner({
        currentNodeId: "x1",
        automationVersion: { graph: insecureGraph, automationId: "auto-self" },
      });
      configService.get.mockReturnValue("api.example.com");

      await runner.runStep("exec-1");

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_PERMANENT });
    });

    it("calls the allow-listed host, saves the response into a custom field, and advances", async () => {
      // Not valid JSON on purpose - the default mocked custom field is TEXT, so
      // this exercises parseResponseBody's fallback to the raw response text.
      const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "pro",
      } as any);
      const { runner, prisma, updateCalls, stepExecutions, configService } = buildRunner({ currentNodeId: "x1" });
      configService.get.mockReturnValue("api.example.com, other.example.com");

      await runner.runStep("exec-1");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://api.example.com/lookup",
        expect.objectContaining({ method: "POST" }),
      );
      expect(prisma.customFieldValue.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ valueText: "pro" }) }),
      );
      expect(stepExecutions.at(-1)).toMatchObject({ nodeId: "x1", status: AutomationStepStatus.COMPLETED });
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.QUEUED, currentNodeId: "e2" });
    });

    it("marks FAILED_RETRYABLE and rethrows on a non-2xx response, so BullMQ retries", async () => {
      jest.spyOn(global, "fetch").mockResolvedValue({ ok: false, status: 500, text: async () => "boom" } as any);
      const { runner, updateCalls, stepExecutions, configService } = buildRunner({ currentNodeId: "x1" });
      configService.get.mockReturnValue("api.example.com");

      await expect(runner.runStep("exec-1")).rejects.toThrow(/500/);

      expect(stepExecutions.at(-1)).toMatchObject({ nodeId: "x1", status: AutomationStepStatus.FAILED });
      expect(updateCalls.at(-1)).toMatchObject({ status: AutomationExecutionStatus.FAILED_RETRYABLE });
    });
  });
});
