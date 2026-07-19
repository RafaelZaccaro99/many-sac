import { AutomationGraph, AutomationGraphNode, AutomationNodeType } from "./graph.types";

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface GraphValidationContext {
  /** Custom field keys defined for the workspace, e.g. "product_interest". */
  customFieldKeys: string[];
}

const BUILT_IN_VARIABLES = new Set([
  "contact.first_name",
  "contact.last_name",
  "contact.primary_email",
  "contact.primary_phone",
  "workspace.name",
  "conversation.assignee.name",
]);

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const CUSTOM_FIELD_PREFIX = "contact.custom.";

/**
 * Structural + semantic validation for a draft automation graph, run before a
 * version is allowed to publish. Returns an empty array when the graph is
 * publishable. Kept as a pure function (no DB access) except for the field
 * keys passed in via context, so it's cheap to unit test exhaustively.
 */
export function validateGraph(graph: AutomationGraph, context: GraphValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (graph.nodes.length === 0) {
    return [{ code: "EMPTY_GRAPH", message: "The automation has no nodes" }];
  }

  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));

  for (const edge of graph.edges) {
    if (!nodesById.has(edge.source)) {
      issues.push({ code: "EDGE_UNKNOWN_SOURCE", message: `Edge ${edge.id} references unknown source node ${edge.source}`, edgeId: edge.id });
    }
    if (!nodesById.has(edge.target)) {
      issues.push({ code: "EDGE_UNKNOWN_TARGET", message: `Edge ${edge.id} references unknown target node ${edge.target}`, edgeId: edge.id });
    }
  }

  const validEdges = graph.edges.filter((e) => nodesById.has(e.source) && nodesById.has(e.target));
  const outgoing = new Map<string, typeof validEdges>();
  const incoming = new Map<string, typeof validEdges>();
  for (const edge of validEdges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }

  const triggerNodes = graph.nodes.filter((n) => n.type === AutomationNodeType.TRIGGER);
  if (triggerNodes.length === 0) {
    issues.push({ code: "NO_TRIGGER", message: "The automation must have exactly one trigger node" });
  } else if (triggerNodes.length > 1) {
    issues.push({ code: "MULTIPLE_TRIGGERS", message: "The automation must have exactly one trigger node" });
  }

  for (const trigger of triggerNodes) {
    if ((incoming.get(trigger.id) ?? []).length > 0) {
      issues.push({ code: "TRIGGER_HAS_INCOMING_EDGE", message: "A trigger node cannot have incoming edges", nodeId: trigger.id });
    }
  }

  // Reachability from the first trigger (only meaningful when there is exactly one).
  const reachable = new Set<string>();
  if (triggerNodes.length === 1) {
    const stack = [triggerNodes[0].id];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const edge of outgoing.get(current) ?? []) {
        stack.push(edge.target);
      }
    }

    for (const node of graph.nodes) {
      if (!reachable.has(node.id)) {
        issues.push({ code: "UNREACHABLE_NODE", message: `Node ${node.id} is not reachable from the trigger`, nodeId: node.id });
      }
    }
  }

  const cycleNodeId = findCycle(graph.nodes, outgoing);
  if (cycleNodeId) {
    issues.push({ code: "CYCLE_DETECTED", message: `Cycle detected involving node ${cycleNodeId}`, nodeId: cycleNodeId });
  }

  for (const node of graph.nodes) {
    const nodeOutgoing = outgoing.get(node.id) ?? [];

    if (node.type === AutomationNodeType.END && nodeOutgoing.length > 0) {
      issues.push({ code: "END_HAS_OUTGOING_EDGE", message: "An end node cannot have outgoing edges", nodeId: node.id });
    }

    if (node.type === AutomationNodeType.CONDITION && nodeOutgoing.length < 2) {
      issues.push({ code: "CONDITION_MISSING_BRANCHES", message: "A condition node needs at least two outgoing branches", nodeId: node.id });
    }

    if (node.type === AutomationNodeType.DELAY) {
      const duration = node.data?.durationMs;
      if (typeof duration !== "number" || duration <= 0) {
        issues.push({ code: "DELAY_MISSING_DURATION", message: "A delay node needs a positive durationMs", nodeId: node.id });
      }
    }

    if (node.type === AutomationNodeType.ACTION) {
      issues.push(...validateActionNode(node));
    }

    if (node.type === AutomationNodeType.START_ANOTHER_FLOW) {
      const automationId = node.data?.automationId;
      if (typeof automationId !== "string" || automationId.length === 0) {
        issues.push({ code: "START_ANOTHER_FLOW_MISSING_TARGET", message: "A start_another_flow node needs a target automationId", nodeId: node.id });
      }
    }

    if (nodeOutgoing.length === 0 && node.type !== AutomationNodeType.END) {
      issues.push({ code: "DEAD_END", message: `Node ${node.id} has no outgoing edge and no explicit end`, nodeId: node.id });
    }

    issues.push(...validateVariableReferences(node, context));
  }

  return issues;
}

const ACTION_TYPES_REQUIRING_TAG = new Set(["add_tag", "remove_tag"]);

function validateActionNode(node: AutomationGraphNode): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const actionType = node.data?.actionType;

  if (typeof actionType !== "string" || !["add_tag", "remove_tag", "set_field"].includes(actionType)) {
    issues.push({
      code: "ACTION_MISSING_TYPE",
      message: 'An action node needs actionType "add_tag", "remove_tag", or "set_field"',
      nodeId: node.id,
    });
    return issues;
  }

  if (ACTION_TYPES_REQUIRING_TAG.has(actionType) && typeof node.data?.tag !== "string") {
    issues.push({ code: "ACTION_MISSING_TAG", message: `Action "${actionType}" needs a tag name`, nodeId: node.id });
  }

  if (actionType === "set_field" && typeof node.data?.key !== "string") {
    issues.push({ code: "ACTION_MISSING_FIELD_KEY", message: 'Action "set_field" needs a field key', nodeId: node.id });
  }

  return issues;
}

function validateVariableReferences(node: AutomationGraphNode, context: GraphValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const textFields = [node.data?.text, node.data?.expression].filter((v): v is string => typeof v === "string");

  for (const text of textFields) {
    for (const match of text.matchAll(VARIABLE_PATTERN)) {
      const variable = match[1];
      if (BUILT_IN_VARIABLES.has(variable)) continue;
      if (variable.startsWith(CUSTOM_FIELD_PREFIX)) {
        const key = variable.slice(CUSTOM_FIELD_PREFIX.length);
        if (!context.customFieldKeys.includes(key)) {
          issues.push({
            code: "UNKNOWN_VARIABLE",
            message: `Node ${node.id} references undefined custom field "${key}"`,
            nodeId: node.id,
          });
        }
        continue;
      }
      issues.push({ code: "UNKNOWN_VARIABLE", message: `Node ${node.id} references unknown variable "${variable}"`, nodeId: node.id });
    }
  }

  return issues;
}

function findCycle(
  nodes: AutomationGraphNode[],
  outgoing: Map<string, { target: string }[]>,
): string | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));

  function visit(nodeId: string): string | null {
    color.set(nodeId, GRAY);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const targetColor = color.get(edge.target);
      if (targetColor === GRAY) return edge.target;
      if (targetColor === WHITE) {
        const found = visit(edge.target);
        if (found) return found;
      }
    }
    color.set(nodeId, BLACK);
    return null;
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      const found = visit(node.id);
      if (found) return found;
    }
  }
  return null;
}
