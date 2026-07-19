import Link from "next/link";
import { serverApiFetch } from "@/lib/api";
import { CreateAutomationForm } from "@/components/CreateAutomationForm";

interface AutomationSummary {
  id: string;
  name: string;
  hasDraft: boolean;
  publishedVersion: number | null;
}

export default async function AutomationsPage({ params }: { params: { workspaceId: string } }) {
  const automations = await serverApiFetch<AutomationSummary[]>(
    `/workspaces/${params.workspaceId}/automations`,
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Automações</h1>
        <div className="flex items-center gap-4">
          <Link href={`/workspaces/${params.workspaceId}/inbox`} className="text-sm text-slate-500 hover:text-slate-800">
            Inbox
          </Link>
          <Link href={`/workspaces/${params.workspaceId}/channels`} className="text-sm text-slate-500 hover:text-slate-800">
            Canais
          </Link>
          <Link href="/workspaces" className="text-sm text-slate-500 hover:text-slate-800">
            ← workspaces
          </Link>
        </div>
      </div>

      <div className="mb-8">
        <CreateAutomationForm workspaceId={params.workspaceId} />
      </div>

      {automations.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma automação ainda.</p>
      ) : (
        <ul className="space-y-2">
          {automations.map((a) => (
            <li key={a.id}>
              <Link
                href={`/workspaces/${params.workspaceId}/automations/${a.id}`}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-sm hover:border-slate-400"
              >
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-slate-400">
                  {a.publishedVersion ? `publicada v${a.publishedVersion}` : "rascunho"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
