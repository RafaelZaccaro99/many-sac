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

  it("requires a human_handoff node to have an outgoing edge - the runtime resumes execution from there", () => {
    const withoutEdge: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "h1", type: AutomationNodeType.HUMAN_HANDOFF, data: {} },
      ],
      edges: [{ id: "e-t1-h1", source: "t1", target: "h1" }],
    };
    expect(codes(withoutEdge)).toContain("DEAD_END");

    const withEdge: AutomationGraph = {
      nodes: [...withoutEdge.nodes, { id: "e1", type: AutomationNodeType.END, data: {} }],
      edges: [...withoutEdge.edges, { id: "e-h1-e1", source: "h1", target: "e1" }],
    };
    expect(codes(withEdge)).not.toContain("DEAD_END");
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

  it("requires an action node to declare a valid actionType", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "a1", type: AutomationNodeType.ACTION, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-a1", source: "t1", target: "a1" },
        { id: "e-a1-e1", source: "a1", target: "e1" },
      ],
    };
    expect(codes(graph)).toContain("ACTION_MISSING_TYPE");
  });

  it("requires add_tag/remove_tag actions to declare a tag, and set_field to declare a key", () => {
    const base: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "a1", type: AutomationNodeType.ACTION, data: { actionType: "add_tag" } },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-a1", source: "t1", target: "a1" },
        { id: "e-a1-e1", source: "a1", target: "e1" },
      ],
    };
    expect(codes(base)).toContain("ACTION_MISSING_TAG");

    const withTag: AutomationGraph = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "a1" ? { ...n, data: { actionType: "add_tag", tag: "vip" } } : n)),
    };
    expect(codes(withTag)).not.toContain("ACTION_MISSING_TAG");

    const setField: AutomationGraph = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "a1" ? { ...n, data: { actionType: "set_field" } } : n)),
    };
    expect(codes(setField)).toContain("ACTION_MISSING_FIELD_KEY");
  });

  it("requires a start_another_flow node to declare a target automationId", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "s1", type: AutomationNodeType.START_ANOTHER_FLOW, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-s1", source: "t1", target: "s1" },
        { id: "e-s1-e1", source: "s1", target: "e1" },
      ],
    };
    expect(codes(graph)).toContain("START_ANOTHER_FLOW_MISSING_TARGET");

    const withTarget: AutomationGraph = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === "s1" ? { ...n, data: { automationId: "auto-123" } } : n)),
    };
    expect(codes(withTarget)).not.toContain("START_ANOTHER_FLOW_MISSING_TARGET");
  });

  it("requires a collect_input node to declare a valid variableName", () => {
    const base: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "ci1", type: AutomationNodeType.COLLECT_INPUT, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-ci1", source: "t1", target: "ci1" },
        { id: "e-ci1-e1", source: "ci1", target: "e1" },
      ],
    };
    expect(codes(base)).toContain("COLLECT_INPUT_MISSING_VARIABLE");

    const invalidName: AutomationGraph = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "ci1" ? { ...n, data: { variableName: "not valid!" } } : n)),
    };
    expect(codes(invalidName)).toContain("COLLECT_INPUT_MISSING_VARIABLE");

    const withName: AutomationGraph = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "ci1" ? { ...n, data: { variableName: "favorite_color" } } : n)),
    };
    expect(codes(withName)).not.toContain("COLLECT_INPUT_MISSING_VARIABLE");
  });

  it("accepts a reference to a flow variable declared by a collect_input node, rejects an undeclared one", () => {
    const graph: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "ci1", type: AutomationNodeType.COLLECT_INPUT, data: { variableName: "favorite_color" } },
        { id: "m1", type: AutomationNodeType.SEND_MESSAGE, data: { text: "You picked {{flow.favorite_color}}!" } },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-ci1", source: "t1", target: "ci1" },
        { id: "e-ci1-m1", source: "ci1", target: "m1" },
        { id: "e-m1-e1", source: "m1", target: "e1" },
      ],
    };
    expect(codes(graph)).not.toContain("UNKNOWN_VARIABLE");

    const typo: AutomationGraph = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === "m1" ? { ...n, data: { text: "{{flow.favorite_colour}}" } } : n)),
    };
    expect(codes(typo)).toContain("UNKNOWN_VARIABLE");
  });

  it("requires an external_request node to declare an https url and a valid method", () => {
    const base: AutomationGraph = {
      nodes: [
        { id: "t1", type: AutomationNodeType.TRIGGER, data: {} },
        { id: "x1", type: AutomationNodeType.EXTERNAL_REQUEST, data: {} },
        { id: "e1", type: AutomationNodeType.END, data: {} },
      ],
      edges: [
        { id: "e-t1-x1", source: "t1", target: "x1" },
        { id: "e-x1-e1", source: "x1", target: "e1" },
      ],
    };
    expect(codes(base)).toContain("EXTERNAL_REQUEST_INVALID_URL");

    const httpUrl: AutomationGraph = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "x1" ? { ...n, data: { url: "http://insecure.example.com" } } : n)),
    };
    expect(codes(httpUrl)).toContain("EXTERNAL_REQUEST_INVALID_URL");

    const badMethod: AutomationGraph = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "x1" ? { ...n, data: { url: "https://api.example.com", method: "CONNECT" } } : n)),
    };
    expect(codes(badMethod)).toContain("EXTERNAL_REQUEST_INVALID_METHOD");

    const valid: AutomationGraph = {
      ...base,
      nodes: base.nodes.map((n) => (n.id === "x1" ? { ...n, data: { url: "https://api.example.com", method: "post" } } : n)),
    };
    expect(codes(valid)).not.toContain("EXTERNAL_REQUEST_INVALID_URL");
    expect(codes(valid)).not.toContain("EXTERNAL_REQUEST_INVALID_METHOD");
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
