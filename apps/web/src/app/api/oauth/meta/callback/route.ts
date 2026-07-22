import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { apiUrl, SESSION_COOKIE } from "@/lib/session";
import { OAUTH_STATE_COOKIE } from "@/lib/oauth";

function redirectToChannels(origin: string, workspaceId: string | undefined, params: Record<string, string>) {
  const path = workspaceId ? `/workspaces/${workspaceId}/channels` : "/workspaces";
  const url = new URL(path, origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  const response = NextResponse.redirect(url);
  response.cookies.delete(OAUTH_STATE_COOKIE);
  return response;
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const metaError = request.nextUrl.searchParams.get("error_message") ?? request.nextUrl.searchParams.get("error");

  const stateCookie = cookies().get(OAUTH_STATE_COOKIE)?.value ?? "";
  const [cookieNonce, workspaceId] = stateCookie.split(".");

  if (metaError) {
    return redirectToChannels(origin, workspaceId, { oauthError: metaError });
  }
  if (!code || !state || !workspaceId || state !== cookieNonce) {
    return redirectToChannels(origin, workspaceId, { oauthError: "Falha na verificação de segurança do OAuth - tente novamente" });
  }

  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const redirectUri = `${process.env.APP_URL ?? origin}/api/oauth/meta/callback`;
  const response = await fetch(`${apiUrl()}/workspaces/${workspaceId}/channels/oauth/exchange`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirectUri }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    return redirectToChannels(origin, workspaceId, { oauthError: data.message ?? "Não foi possível conectar o canal via OAuth" });
  }

  return redirectToChannels(origin, workspaceId, { connected: "1" });
}
