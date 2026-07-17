import Link from "next/link";
import { serverApiFetch } from "@/lib/api";
import { ConnectChannelForm } from "@/components/ConnectChannelForm";

interface ChannelConnection {
  id: string;
  provider: string;
  externalAccountId: string;
  displayName: string | null;
  status: string;
  createdAt: string;
}

export default async function ChannelsPage({ params }: { params: { workspaceId: string } }) {
  const connections = await serverApiFetch<ChannelConnection[]>(`/workspaces/${params.workspaceId}/channels`);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Canais</h1>
        <Link href={`/workspaces/${params.workspaceId}/automations`} className="text-sm text-slate-500 hover:text-slate-800">
          ← automações
        </Link>
      </div>

      <div className="mb-8">
        <ConnectChannelForm workspaceId={params.workspaceId} />
      </div>

      {connections.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhum canal conectado ainda.</p>
      ) : (
        <ul className="space-y-2">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-sm">
              <div>
                <span className="font-medium">{c.displayName || c.externalAccountId}</span>
                <span className="ml-2 text-xs uppercase text-slate-400">{c.provider}</span>
              </div>
              <span className={`text-xs ${c.status === "ACTIVE" ? "text-emerald-600" : "text-slate-400"}`}>{c.status}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
