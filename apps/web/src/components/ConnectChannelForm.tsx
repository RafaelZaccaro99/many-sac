"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ConnectChannelForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [provider, setProvider] = useState<"INSTAGRAM" | "MESSENGER">("INSTAGRAM");
  const [externalAccountId, setExternalAccountId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/proxy/workspaces/${workspaceId}/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, externalAccountId, displayName: displayName || undefined, accessToken }),
    });

    setLoading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.message ?? "Não foi possível conectar o canal");
      return;
    }

    setExternalAccountId("");
    setDisplayName("");
    setAccessToken("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Canal</label>
        <select
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={provider}
          onChange={(e) => setProvider(e.target.value as "INSTAGRAM" | "MESSENGER")}
        >
          <option value="INSTAGRAM">Instagram</option>
          <option value="MESSENGER">Messenger</option>
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">
          ID da Page / conta do Instagram (externalAccountId)
        </label>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={externalAccountId}
          onChange={(e) => setExternalAccountId(e.target.value)}
          placeholder="ex: 17841400000000000"
          required
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Nome (opcional)</label>
        <input
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Minha Page"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-600">Access token</label>
        <input
          type="password"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={accessToken}
          onChange={(e) => setAccessToken(e.target.value)}
          placeholder="Token gerado no Meta for Developers"
          required
        />
        <p className="mt-1 text-xs text-slate-400">
          Fica criptografado no banco (AES-256-GCM) e nunca aparece de volta na tela.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={loading}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {loading ? "Conectando..." : "Conectar canal"}
      </button>
    </form>
  );
}
