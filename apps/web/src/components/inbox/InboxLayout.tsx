"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ConversationStatus, ConversationSummary, STATUS_LABEL, contactDisplayName } from "./types";

const FILTERS: { key: "ALL" | ConversationStatus; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "WAITING_HUMAN", label: "Aguardando" },
  { key: "HUMAN", label: "Em atendimento" },
  { key: "BOT", label: "Bot" },
  { key: "CLOSED", label: "Fechadas" },
];

const STATUS_DOT: Record<ConversationStatus, string> = {
  BOT: "bg-slate-300",
  WAITING_HUMAN: "bg-amber-500",
  HUMAN: "bg-emerald-500",
  CLOSED: "bg-slate-300",
};

export function InboxLayout({
  workspaceId,
  conversations,
  selectedConversationId,
  children,
}: {
  workspaceId: string;
  conversations: ConversationSummary[];
  selectedConversationId?: string;
  children: React.ReactNode;
}) {
  const [filter, setFilter] = useState<"ALL" | ConversationStatus>("ALL");

  const filtered = useMemo(
    () => (filter === "ALL" ? conversations : conversations.filter((c) => c.status === filter)),
    [conversations, filter],
  );

  return (
    <div className="flex h-[calc(100vh-49px)]">
      <aside className="flex w-80 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-200 p-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${
                filter === f.key ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <ul className="flex-1 overflow-y-auto">
          {filtered.length === 0 && <li className="p-4 text-sm text-slate-400">Nenhuma conversa aqui.</li>}
          {filtered.map((c) => (
            <li key={c.id}>
              <Link
                href={`/workspaces/${workspaceId}/inbox/${c.id}`}
                className={`block border-b border-slate-100 px-4 py-3 text-sm hover:bg-slate-50 ${
                  c.id === selectedConversationId ? "bg-slate-100" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{contactDisplayName(c.contact)}</span>
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[c.status]}`} title={STATUS_LABEL[c.status]} />
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                  <span className="uppercase">{c.channelConnection.provider}</span>
                  <span>{STATUS_LABEL[c.status]}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1 overflow-hidden">{children}</section>
    </div>
  );
}
