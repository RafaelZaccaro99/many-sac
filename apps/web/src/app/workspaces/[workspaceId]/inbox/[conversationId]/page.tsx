import Link from "next/link";
import { serverApiFetch } from "@/lib/api";
import { InboxLayout } from "@/components/inbox/InboxLayout";
import { ConversationThread } from "@/components/inbox/ConversationThread";
import { ConversationDetail, ConversationSummary } from "@/components/inbox/types";

export default async function InboxConversationPage({
  params,
}: {
  params: { workspaceId: string; conversationId: string };
}) {
  const [conversations, conversation] = await Promise.all([
    serverApiFetch<ConversationSummary[]>(`/workspaces/${params.workspaceId}/conversations`),
    serverApiFetch<ConversationDetail>(`/workspaces/${params.workspaceId}/conversations/${params.conversationId}`),
  ]);

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link href={`/workspaces/${params.workspaceId}/automations`} className="text-sm text-slate-500 hover:text-slate-800">
          ← automações
        </Link>
        <h1 className="text-sm font-semibold">Inbox</h1>
      </div>
      <InboxLayout workspaceId={params.workspaceId} conversations={conversations} selectedConversationId={conversation.id}>
        <ConversationThread key={conversation.id} workspaceId={params.workspaceId} conversation={conversation} />
      </InboxLayout>
    </div>
  );
}
