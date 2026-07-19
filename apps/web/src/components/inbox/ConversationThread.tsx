"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConversationDetail, ConversationMessageItem, STATUS_LABEL, contactDisplayName } from "./types";

const POLL_INTERVAL_MS = 4000;

export function ConversationThread({ workspaceId, conversation }: { workspaceId: string; conversation: ConversationDetail }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ConversationMessageItem[]>(conversation.messages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [busyAction, setBusyAction] = useState<"claim" | "close" | "resume" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const base = `/api/proxy/workspaces/${workspaceId}/conversations/${conversation.id}`;

  useEffect(() => {
    setMessages(conversation.messages);
  }, [conversation.id, conversation.messages]);

  useEffect(() => {
    if (conversation.status === "CLOSED") return;
    const timer = setInterval(async () => {
      const res = await fetch(`${base}/messages`);
      if (!res.ok) return;
      const fresh: ConversationMessageItem[] = await res.json();
      setMessages(fresh);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [base, conversation.status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError(null);

    const res = await fetch(`${base}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft }),
    });

    setSending(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Não foi possível enviar a mensagem");
      return;
    }
    const message: ConversationMessageItem = await res.json();
    setMessages((prev) => [...prev, message]);
    setDraft("");
    router.refresh();
  }

  async function runAction(action: "claim" | "close" | "resume") {
    setBusyAction(action);
    setError(null);
    const res = await fetch(`${base}/${action}`, { method: "POST" });
    setBusyAction(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Não foi possível concluir a ação");
      return;
    }
    router.refresh();
  }

  const isClosed = conversation.status === "CLOSED";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <div className="text-sm font-semibold">{contactDisplayName(conversation.contact)}</div>
          <div className="text-xs text-slate-400">
            {conversation.channelConnection.displayName || conversation.channelConnection.externalAccountId} ·{" "}
            {STATUS_LABEL[conversation.status]}
          </div>
        </div>
        <div className="flex gap-2">
          {(conversation.status === "BOT" || conversation.status === "WAITING_HUMAN") && (
            <button
              onClick={() => runAction("claim")}
              disabled={busyAction !== null}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {busyAction === "claim" ? "Assumindo..." : "Assumir"}
            </button>
          )}
          {!isClosed && (
            <button
              onClick={() => runAction("resume")}
              disabled={busyAction !== null}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 disabled:opacity-50"
            >
              {busyAction === "resume" ? "Devolvendo..." : "Devolver para o bot"}
            </button>
          )}
          {!isClosed && (
            <button
              onClick={() => runAction("close")}
              disabled={busyAction !== null}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {busyAction === "close" ? "Fechando..." : "Fechar"}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "OUT" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-md rounded-lg px-3 py-2 text-sm ${
                m.direction === "OUT" ? "bg-slate-900 text-white" : "bg-white text-slate-800"
              } shadow-sm`}
            >
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={`mt-1 text-[10px] ${m.direction === "OUT" ? "text-slate-300" : "text-slate-400"}`}>
                {m.senderType === "AGENT" ? "Atendente" : m.senderType === "BOT" ? "Bot" : "Contato"} ·{" "}
                {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <p className="px-4 pb-1 text-xs text-red-600">{error}</p>}

      {isClosed ? (
        <div className="border-t border-slate-200 bg-white p-4 text-xs text-slate-400">Esta conversa está fechada.</div>
      ) : (
        <form onSubmit={handleSend} className="flex gap-2 border-t border-slate-200 bg-white p-3">
          <input
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Responder ao contato..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            {sending ? "Enviando..." : "Enviar"}
          </button>
        </form>
      )}
    </div>
  );
}
