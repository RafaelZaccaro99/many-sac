"use client";

import { Node } from "reactflow";
import { AutomationNodeData } from "./AutomationNode";

const OPERATORS = ["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "exists", "not_exists"];

export function NodePropertiesPanel({
  node,
  onChange,
}: {
  node: Node<AutomationNodeData> | null;
  onChange: (fields: Record<string, unknown>) => void;
}) {
  if (!node) {
    return (
      <aside className="w-72 shrink-0 border-l border-slate-200 bg-white p-4 text-sm text-slate-400">
        Selecione um nó para editar.
      </aside>
    );
  }

  const { nodeType, fields } = node.data;

  return (
    <aside className="w-72 shrink-0 space-y-3 border-l border-slate-200 bg-white p-4 text-sm">
      <h2 className="font-medium">{node.id}</h2>
      <p className="text-xs uppercase text-slate-400">{nodeType}</p>

      {nodeType === "trigger" && (
        <Field label="Palavra-chave (opcional)">
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={(fields.keyword as string) ?? ""}
            onChange={(e) => onChange({ ...fields, keyword: e.target.value })}
            placeholder="Casa com qualquer mensagem se vazio"
          />
        </Field>
      )}

      {nodeType === "send_message" && (
        <Field label="Texto da mensagem">
          <textarea
            className="h-28 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={(fields.text as string) ?? ""}
            onChange={(e) => onChange({ ...fields, text: e.target.value })}
            placeholder="Ola {{contact.first_name}}!"
          />
        </Field>
      )}

      {nodeType === "condition" && (
        <>
          <Field label="Campo (ex: contact.custom.plano)">
            <input
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={(fields.field as string) ?? ""}
              onChange={(e) => onChange({ ...fields, field: e.target.value })}
            />
          </Field>
          <Field label="Operador">
            <select
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={(fields.operator as string) ?? "exists"}
              onChange={(e) => onChange({ ...fields, operator: e.target.value })}
            >
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor de comparação">
            <input
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={(fields.value as string) ?? ""}
              onChange={(e) => onChange({ ...fields, value: e.target.value })}
            />
          </Field>
        </>
      )}

      {nodeType === "delay" && (
        <Field label="Duração (ms)">
          <input
            type="number"
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={(fields.durationMs as number) ?? 0}
            onChange={(e) => onChange({ ...fields, durationMs: Number(e.target.value) })}
          />
        </Field>
      )}

      {(nodeType === "end" || nodeType === "human_handoff") && (
        <p className="text-xs text-slate-400">Este nó não tem propriedades.</p>
      )}
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
