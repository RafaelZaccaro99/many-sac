import Link from "next/link";
import { serverApiFetch } from "@/lib/api";
import { InboxLayout } from "@/components/inbox/InboxLayout";
import { ConversationSummary } from "@/components/inbox/types";

export default async function InboxPage({ params }: { params: { workspaceId: string } }) {
  const conversations = await serverApiFetch<ConversationSummary[]>(`/workspaces/${params.workspaceId}/conversations`);

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link href={`/workspaces/${params.workspaceId}/automations`} className="text-sm text-slate-500 hover:text-slate-800">
          ← automações
        </Link>
        <h1 className="text-sm font-semibold">Inbox</h1>
      </div>
      <InboxLayout workspaceId={params.workspaceId} conversations={conversations}>
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          Selecione uma conversa à esquerda.
        </div>
      </InboxLayout>
    </div>
  );
}
