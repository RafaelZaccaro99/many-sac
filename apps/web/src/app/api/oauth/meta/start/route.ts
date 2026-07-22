import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { OAUTH_STATE_COOKIE } from "@/lib/oauth";

const GRAPH_API_VERSION = "v19.0";
const META_SCOPES = "pages_show_list,pages_messaging,instagram_basic,instagram_manage_messages,pages_read_engagement";

/**
 * Kicks off the Meta OAuth dialog with a real top-level browser redirect -
 * this can't go through the JSON proxy (/api/proxy) since that's fetch-based,
 * not a navigation the browser can follow to facebook.com.
 */
export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ message: "workspaceId is required" }, { status: 400 });
  }
  if (!cookies().get(SESSION_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  }

  const appId = process.env.META_APP_ID;
  if (!appId) {
    return NextResponse.json({ message: "META_APP_ID is not configured" }, { status: 500 });
  }

  const appUrl = process.env.APP_URL ?? request.nextUrl.origin;
  const redirectUri = `${appUrl}/api/oauth/meta/callback`;
  const nonce = randomBytes(16).toString("hex");

  const dialogUrl = new URL(`https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth`);
  dialogUrl.searchParams.set("client_id", appId);
  dialogUrl.searchParams.set("redirect_uri", redirectUri);
  dialogUrl.searchParams.set("state", nonce);
  dialogUrl.searchParams.set("scope", META_SCOPES);

  const response = NextResponse.redirect(dialogUrl);
  // Single-use CSRF token: the callback must see this exact nonce come back
  // in the `state` query param before it trusts the workspaceId bundled here.
  response.cookies.set(OAUTH_STATE_COOKIE, `${nonce}.${workspaceId}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 5 * 60,
    path: "/",
  });
  return response;
}
