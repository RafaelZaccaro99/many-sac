import { NextRequest, NextResponse } from "next/server";
import { apiUrl, SESSION_COOKIE } from "@/lib/session";

/**
 * Every authenticated client-side call goes through this proxy instead of
 * hitting the API directly, so the JWT stays in an httpOnly cookie and never
 * touches client-side JS (no localStorage, no Authorization header set by
 * the browser).
 */
async function handle(request: NextRequest, path: string[]): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const targetUrl = `${apiUrl()}/${path.join("/")}${request.nextUrl.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const response = await fetch(targetUrl, {
    method: request.method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    body: hasBody ? await request.text() : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  return NextResponse.json(data, { status: response.status });
}

export async function GET(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handle(request, params.path);
}
export async function POST(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handle(request, params.path);
}
export async function PATCH(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handle(request, params.path);
}
export async function PUT(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handle(request, params.path);
}
export async function DELETE(request: NextRequest, { params }: { params: { path: string[] } }) {
  return handle(request, params.path);
}
