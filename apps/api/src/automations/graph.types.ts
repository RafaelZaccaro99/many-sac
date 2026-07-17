export const AutomationNodeType = {
  TRIGGER: "trigger",
  SEND_MESSAGE: "send_message",
  COLLECT_INPUT: "collect_input",
  CONDITION: "condition",
  ACTION: "action",
  DELAY: "delay",
  START_ANOTHER_FLOW: "start_another_flow",
  HUMAN_HANDOFF: "human_handoff",
  EXTERNAL_REQUEST: "external_request",
  GOAL: "goal",
  END: "end",
} as const;

export type AutomationNodeType = (typeof AutomationNodeType)[keyof typeof AutomationNodeType];

export interface AutomationGraphNode {
  id: string;
  type: AutomationNodeType;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface AutomationGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}

export interface AutomationGraph {
  nodes: AutomationGraphNode[];
  edges: AutomationGraphEdge[];
}
