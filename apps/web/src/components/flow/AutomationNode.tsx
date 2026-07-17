"use client";

import { Handle, Position, NodeProps } from "reactflow";

const NODE_STYLES: Record<string, { label: string; color: string }> = {
  trigger: { label: "Gatilho", color: "bg-emerald-100 border-emerald-400" },
  send_message: { label: "Mensagem", color: "bg-sky-100 border-sky-400" },
  condition: { label: "Condição", color: "bg-amber-100 border-amber-400" },
  delay: { label: "Espera", color: "bg-violet-100 border-violet-400" },
  end: { label: "Fim", color: "bg-slate-200 border-slate-400" },
  human_handoff: { label: "Atendimento humano", color: "bg-rose-100 border-rose-400" },
};

export interface AutomationNodeData {
  nodeType: string;
  fields: Record<string, unknown>;
}

export function AutomationNode({ data, selected }: NodeProps<AutomationNodeData>) {
  const style = NODE_STYLES[data.nodeType] ?? { label: data.nodeType, color: "bg-white border-slate-300" };
  const isCondition = data.nodeType === "condition";
  const isTrigger = data.nodeType === "trigger";
  const isEnd = data.nodeType === "end" || data.nodeType === "human_handoff";

  return (
    <div
      className={`min-w-[160px] rounded-md border-2 px-3 py-2 text-sm shadow-sm ${style.color} ${
        selected ? "ring-2 ring-offset-1 ring-slate-500" : ""
      }`}
    >
      {!isTrigger && <Handle type="target" position={Position.Top} />}
      <div className="font-medium">{style.label}</div>
      <div className="mt-0.5 truncate text-xs text-slate-600">
        {typeof data.fields?.text === "string" && data.fields.text}
        {typeof data.fields?.keyword === "string" && `palavra-chave: ${data.fields.keyword}`}
        {typeof data.fields?.durationMs === "number" && `${data.fields.durationMs}ms`}
        {isCondition && typeof data.fields?.field === "string" && `${data.fields.field} ${data.fields.operator ?? ""}`}
      </div>

      {isCondition ? (
        <>
          <Handle type="source" position={Position.Bottom} id="true" style={{ left: "30%" }} />
          <Handle type="source" position={Position.Bottom} id="false" style={{ left: "70%" }} />
          <div className="mt-1 flex justify-between text-[10px] text-slate-500">
            <span>verdadeiro</span>
            <span>falso</span>
          </div>
        </>
      ) : (
        !isEnd && <Handle type="source" position={Position.Bottom} />
      )}
    </div>
  );
}
