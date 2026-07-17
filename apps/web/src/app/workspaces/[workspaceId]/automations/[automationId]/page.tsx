import Link from "next/link";
import { serverApiFetch } from "@/lib/api";
import { FlowBuilder, BackendGraph } from "@/components/flow/FlowBuilder";

interface AutomationVersion {
  id: string;
  versionNumber: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  graph: BackendGraph;
}
interface AutomationDetail {
  id: string;
  name: string;
  versions: AutomationVersion[];
}

export default async function AutomationBuilderPage({
  params,
}: {
  params: { workspaceId: string; automationId: string };
}) {
  const automation = await serverApiFetch<AutomationDetail>(
    `/workspaces/${params.workspaceId}/automations/${params.automationId}`,
  );

  const draft = automation.versions.find((v) => v.status === "DRAFT");
  const published = automation.versions.find((v) => v.status === "PUBLISHED");
  const graph: BackendGraph = draft?.graph ?? { nodes: [], edges: [] };

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link
          href={`/workspaces/${params.workspaceId}/automations`}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          ← automações
        </Link>
        <h1 className="text-sm font-semibold">{automation.name}</h1>
      </div>
      <FlowBuilder
        workspaceId={params.workspaceId}
        automationId={params.automationId}
        initialGraph={graph}
        initialStatus={{ hasDraft: Boolean(draft), publishedVersion: published?.versionNumber ?? null }}
      />
    </div>
  );
}
