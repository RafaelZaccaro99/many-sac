import Link from "next/link";
import { serverApiFetch } from "@/lib/api";
import { CreateWorkspaceForm } from "@/components/CreateWorkspaceForm";
import { LogoutButton } from "@/components/LogoutButton";

interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  myRole: string;
}

export default async function WorkspacesPage() {
  const workspaces = await serverApiFetch<WorkspaceSummary[]>("/workspaces");

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Seus workspaces</h1>
        <LogoutButton />
      </div>

      <div className="mb-8">
        <CreateWorkspaceForm />
      </div>

      {workspaces.length === 0 ? (
        <p className="text-sm text-slate-500">Você ainda não tem nenhum workspace.</p>
      ) : (
        <ul className="space-y-2">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <Link
                href={`/workspaces/${ws.id}/automations`}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-4 py-3 text-sm hover:border-slate-400"
              >
                <span className="font-medium">{ws.name}</span>
                <span className="text-xs uppercase text-slate-400">{ws.myRole}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
