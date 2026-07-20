"use client";

import { useCallback, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Connection,
  Controls,
  Edge,
  Node,
  addEdge,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { AutomationNode, AutomationNodeData } from "./AutomationNode";
import { NodePropertiesPanel } from "./NodePropertiesPanel";

export interface BackendGraphNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
  position?: { x: number; y: number };
}
export interface BackendGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
}
export interface BackendGraph {
  nodes: BackendGraphNode[];
  edges: BackendGraphEdge[];
}

export interface ValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
}

const NODE_TYPES = { automationNode: AutomationNode };
const PALETTE: { type: string; label: string }[] = [
  { type: "trigger", label: "+ Gatilho" },
  { type: "send_message", label: "+ Mensagem" },
  { type: "condition", label: "+ Condição" },
  { type: "delay", label: "+ Espera" },
  { type: "human_handoff", label: "+ Atendimento humano" },
  { type: "action", label: "+ Ação" },
  { type: "goal", label: "+ Meta" },
  { type: "start_another_flow", label: "+ Iniciar outro fluxo" },
  { type: "collect_input", label: "+ Coletar resposta" },
  { type: "external_request", label: "+ Chamada externa" },
  { type: "end", label: "+ Fim" },
];

function toFlowNodes(graph: BackendGraph): Node<AutomationNodeData>[] {
  return graph.nodes.map((n, i) => ({
    id: n.id,
    type: "automationNode",
    position: n.position ?? { x: 80 + (i % 4) * 220, y: 80 + Math.floor(i / 4) * 140 },
    data: { nodeType: n.type, fields: n.data ?? {} },
  }));
}

function toFlowEdges(graph: BackendGraph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    label: e.sourceHandle,
  }));
}

function toBackendGraph(nodes: Node<AutomationNodeData>[], edges: Edge[]): BackendGraph {
  return {
    nodes: nodes.map((n) => ({ id: n.id, type: n.data.nodeType, data: n.data.fields, position: n.position })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined })),
  };
}

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

export function FlowBuilder({
  workspaceId,
  automationId,
  initialGraph,
  initialStatus,
}: {
  workspaceId: string;
  automationId: string;
  initialGraph: BackendGraph;
  initialStatus: { hasDraft: boolean; publishedVersion: number | null };
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<AutomationNodeData>(toFlowNodes(initialGraph));
  const [edges, setEdges, onEdgesChange] = useEdgesState(toFlowEdges(initialGraph));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [status, setStatus] = useState(initialStatus);

  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) ?? null, [nodes, selectedNodeId]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, label: connection.sourceHandle }, eds)),
    [setEdges],
  );

  function addNode(type: string) {
    const id = nextId(type);
    setNodes((nds) => [
      ...nds,
      {
        id,
        type: "automationNode",
        position: { x: 100 + nds.length * 40, y: 100 + nds.length * 30 },
        data: { nodeType: type, fields: defaultFieldsFor(type) },
      },
    ]);
  }

  function updateSelectedFields(fields: Record<string, unknown>) {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...n.data, fields } } : n)));
  }

  async function saveDraft(): Promise<boolean> {
    setSaving(true);
    setSaveMessage(null);
    const graph = toBackendGraph(nodes, edges);
    const res = await fetch(`/api/proxy/workspaces/${workspaceId}/automations/${automationId}/draft`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setSaveMessage(data.message ?? "Não foi possível salvar o rascunho");
      return false;
    }
    setSaveMessage("Rascunho salvo.");
    return true;
  }

  async function validate() {
    const savedOk = await saveDraft();
    if (!savedOk) return;
    const res = await fetch(`/api/proxy/workspaces/${workspaceId}/automations/${automationId}/validate`, {
      method: "POST",
    });
    const data = await res.json();
    setIssues(data.issues ?? []);
  }

  async function publish() {
    const savedOk = await saveDraft();
    if (!savedOk) return;
    const res = await fetch(`/api/proxy/workspaces/${workspaceId}/automations/${automationId}/publish`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setIssues(data.issues ?? [{ code: "ERROR", message: data.message ?? "Falha ao publicar" }]);
      return;
    }
    setIssues([]);
    setSaveMessage(`Publicada como versão ${data.versionNumber}.`);
    setStatus({ hasDraft: true, publishedVersion: data.versionNumber });
  }

  return (
    <div className="flex h-[calc(100vh-64px)]">
      <div className="flex-1">
        <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
          {PALETTE.map((p) => (
            <button
              key={p.type}
              onClick={() => addNode(p.type)}
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-100"
            >
              {p.label}
            </button>
          ))}
          <span className="flex-1" />
          <button
            onClick={saveDraft}
            disabled={saving}
            className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100 disabled:opacity-50"
          >
            Salvar rascunho
          </button>
          <button onClick={validate} className="rounded border border-slate-300 px-3 py-1 text-xs hover:bg-slate-100">
            Validar
          </button>
          <button
            onClick={publish}
            className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white hover:bg-slate-700"
          >
            Publicar
          </button>
        </div>

        {(saveMessage || issues) && (
          <div className="border-b border-slate-200 bg-white px-4 py-2 text-xs">
            {saveMessage && <p className="text-slate-600">{saveMessage}</p>}
            {issues && issues.length === 0 && <p className="text-emerald-600">Grafo válido.</p>}
            {issues && issues.length > 0 && (
              <ul className="list-inside list-disc text-red-600">
                {issues.map((iss, i) => (
                  <li key={i}>{iss.message}</li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-slate-400">
              {status.publishedVersion ? `Publicada: v${status.publishedVersion}` : "Ainda não publicada"}
            </p>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={NODE_TYPES}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          onPaneClick={() => setSelectedNodeId(null)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <NodePropertiesPanel node={selectedNode} onChange={updateSelectedFields} />
    </div>
  );
}

function defaultFieldsFor(type: string): Record<string, unknown> {
  switch (type) {
    case "send_message":
      return { text: "" };
    case "condition":
      return { field: "contact.first_name", operator: "exists" };
    case "delay":
      return { durationMs: 60000 };
    case "action":
      return { actionType: "add_tag", tag: "" };
    case "goal":
      return { name: "" };
    case "start_another_flow":
      return { automationId: "" };
    case "collect_input":
      return { variableName: "" };
    case "external_request":
      return { url: "", method: "GET" };
    default:
      return {};
  }
}
