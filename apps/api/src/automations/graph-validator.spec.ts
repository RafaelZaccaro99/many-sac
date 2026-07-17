import { validateGraph } from "./graph-validator";
import { AutomationGraph, AutomationNodeType } from "./graph.types";

const ctx = { customFieldKeys: ["product_interest"] };

function codes(graph: AutomationGraph) {
  return validateGraph(graph, ctx).map((i) => i.code);
}

describe("validateGraph", () => {
  it("rejects an empty graph", () => {
    expect(codes({ nodes: [], edges: [] })).toEqual(["EMPTY_GRAPH"]);
  });

  it("accepts a minimal valid trigger -> send_message -> end graph", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: { text: "Hi {{contact.first_name}}" } },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-m1", source: "t1", target: "m1" },
        { id: "e-m1-e1", source: "m1", target: "e1" },
      ],
    };
    expect(validateGraph(graph, ctx)).toEqual([]);
  });

  it("requires exactly one trigger node", () => {
    const noTrigger: AutomationGraph = { nodes: [{ id: "e1", type: AutomationNodeType.END, data: {} }], edges: [] };
    expect(codes(noTrigger)).toContain("NO_TRIGGER");

    const twoTriggers: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "t2", type: AutomationNodeType.TRIGGER, data: {} },
      ],
      edges: [],
    };
    expect(codes(twoTriggers)).toContain("MULTIPLE_TRIGGERS");
  });

  it("rejects a trigger node with an incoming edge", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [{ id: "e-e1-t1", source: "e1", target: "t1" }],
    };
    expect(codes(graph)).toContain("TRIGGER_HAS_INCOMING_EDGE");
  });

  it("flags a node unreachable from the trigger", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
        { id: "orphan", type: AutomationNodeType.SEND_MESSAGE, data: { text: "unreachable" } },
      ],
      edges: [{ id: "e-t1-e1", source: "t1", target: "e1" }],
    };
    const issues = validateGraph(graph, ctx);
    expect(issues.some((i) => i.code === "UNREACHABLE_NODE" && i.nodeId === "orphan")).toBe(true);
  });

  it("detects a cycle", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "a", type: AutomationNodeType.ACTION, data: {} },
        { id: "b", type: AutomationNodeType.ACTION, data: {} },
      ],
      edges: [
        { id: "e1", source: "t1", target: "a" },
        { id: "e2", source: "a", target: "b" },
        { id: "e3", source: "b", target: "a" },
      ],
    };
    expect(codes(graph)).toContain("CYCLE_DETECTED");
  });

  it("rejects an end node with an outgoing edge", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
        { id: "e2", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-e1", source: "t1", target: "e1" },
        { id: "e-e1-e2", source: "e1", target: "e2" },
      ],
    };
    expect(codes(graph)).toContain("END_HAS_OUTGOING_EDGE");
  });

  it("requires a condition node to have at least two outgoing branches", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "c1", type: AutomationNodeType.CONDITION, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-c1", source: "t1", target: "c1" },
        { id: "e-c1-e1", source: "c1", target: "e1" },
      ],
    };
    expect(codes(graph)).toContain("CONDITION_MISSING_BRANCHES");
  });

  it("requires a delay node to declare a positive durationMs", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "d1", type: AutomationNodeType.DELAY, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-d1", source: "t1", target: "d1" },
        { id: "e-d1-e1", source: "d1", target: "e1" },
      ],
    };
    expect(codes(graph)).toContain("DELAY_MISSING_DURATION");
  });

  it("flags a node with no outgoing edge that isn't an end or human_handoff", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: {} },
      ],
      edges: [{ id: "e-t1-m1", source: "t1", target: "m1" }],
    };
    expect(codes(graph)).toContain("DEAD_END");
  });

  it("allows a human_handoff node with no outgoing edge (execution pauses there)", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "h1", type: AutomationNodeType.HUMAN_HANDOFF, data: {} },
      ],
      edges: [{ id: "e-t1-h1", source: "t1", target: "h1" }],
    };
    expect(codes(graph)).not.toContain("DEAD_END");
  });

  it("rejects an edge referencing an unknown node", () => {
    const graph: AutomationGraph = {
      nodes: [{ id: "t1", type: AutomationNodeType.TRIGGER, data: {} }],
      edges: [{ id: "e1", source: "t1", target: "ghost" }],
    };
    expect(codes(graph)).toContain("EDGE_UNKNOWN_TARGET");
  });

  it("accepts a known built-in variable but rejects an undefined custom field", () => {
    const validGraph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: { text: "Hi {{contact.custom.product_interest}}" } },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-m1", source: "t1", target: "m1" },
        { id: "e-m1-e1", source: "m1", target: "e1" },
      ],
    };
    expect(codes(validGraph)).toEqual([]);

    const invalidGraph: AutomationGraph = {
      ...validGraph,
      nodes: validGraph.nodes.map((n) =>
        n.id === "m1" ? { ...n, data: { text: "Hi {{contact.custom.does_not_exist}}" } } : n,
      ),
    };
    expect(codes(invalidGraph)).toContain("UNKNOWN_VARIABLE");
  });

  it("rejects a reference to a completely unknown variable namespace", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: { text: "{{something.made_up}}" } },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-m1", source: "t1", target: "m1" },
        { id: "e-m1-e1", source: "m1", target: "e1" },
      ],
    };
    expect(codes(graph)).toContain("UNKNOWN_VARIABLE");
  });
});
