"use client";

import { Node } from "reactflow";
import { AutomationNodeData } from "./AutomationNode";

const OPERATORS = ["equals", "not_equals", "contains", "not_contains", "greater_than", "less_than", "exists", "not_exists"];
const ACTION_TYPES = ["add_tag", "remove_tag", "set_field"];
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

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

      {nodeType === "action" && (
        <>
          <Field label="Tipo de ação">
            <select
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={(fields.actionType as string) ?? "add_tag"}
              onChange={(e) => onChange({ ...fields, actionType: e.target.value })}
            >
              {ACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          {(fields.actionType === "remove_tag" || fields.actionType === undefined || fields.actionType === "add_tag") && (
            <Field label="Tag">
              <input
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                value={(fields.tag as string) ?? ""}
                onChange={(e) => onChange({ ...fields, tag: e.target.value })}
                placeholder="vip"
              />
            </Field>
          )}
          {fields.actionType === "set_field" && (
            <>
              <Field label="Chave do campo personalizado">
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={(fields.key as string) ?? ""}
                  onChange={(e) => onChange({ ...fields, key: e.target.value })}
                  placeholder="produto_interesse"
                />
              </Field>
              <Field label="Valor">
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  value={(fields.value as string) ?? ""}
                  onChange={(e) => onChange({ ...fields, value: e.target.value })}
                  placeholder="Ola {{contact.first_name}}"
                />
              </Field>
            </>
          )}
        </>
      )}

      {nodeType === "goal" && (
        <Field label="Nome da meta">
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={(fields.name as string) ?? ""}
            onChange={(e) => onChange({ ...fields, name: e.target.value })}
            placeholder="signup_concluido"
          />
        </Field>
      )}

      {nodeType === "start_another_flow" && (
        <Field label="ID da automação alvo">
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={(fields.automationId as string) ?? ""}
            onChange={(e) => onChange({ ...fields, automationId: e.target.value })}
            placeholder="cole o ID de outra automação publicada"
          />
        </Field>
      )}

      {nodeType === "collect_input" && (
        <Field label="Nome da variável">
          <input
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={(fields.variableName as string) ?? ""}
            onChange={(e) => onChange({ ...fields, variableName: e.target.value })}
            placeholder="cor_favorita"
          />
          <p className="mt-1 text-xs text-slate-400">
            Pausa até a próxima mensagem do contato. Use depois como {"{{flow."}
            {(fields.variableName as string) || "nome_da_variavel"}
            {"}}"}.
          </p>
        </Field>
      )}

      {nodeType === "external_request" && (
        <>
          <Field label="URL (https)">
            <input
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={(fields.url as string) ?? ""}
              onChange={(e) => onChange({ ...fields, url: e.target.value })}
              placeholder="https://api.exemplo.com/lookup"
            />
          </Field>
          <Field label="Método">
            <select
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={(fields.method as string)?.toUpperCase() ?? "GET"}
              onChange={(e) => onChange({ ...fields, method: e.target.value })}
            >
              {HTTP_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Corpo (opcional, JSON)">
            <textarea
              className="h-20 w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={(fields.body as string) ?? ""}
              onChange={(e) => onChange({ ...fields, body: e.target.value })}
              placeholder='{"contactId": "{{contact.custom.crm_id}}"}'
            />
          </Field>
          <Field label="Salvar resposta no campo personalizado (opcional)">
            <input
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={(fields.saveResponseAs as string) ?? ""}
              onChange={(e) => onChange({ ...fields, saveResponseAs: e.target.value })}
              placeholder="produto_interesse"
            />
          </Field>
          <p className="text-xs text-slate-400">
            O host precisa estar na allow-list configurada no servidor (EXTERNAL_REQUEST_ALLOWED_HOSTS).
          </p>
        </>
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
