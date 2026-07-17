import { NextRequest, NextResponse } from "next/server";
import { apiUrl, SESSION_COOKIE } from "@/lib/session";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const mode = body.mode === "signup" ? "signup" : "login";

  const response = await fetch(`${apiUrl()}/auth/${mode}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: body.email, password: body.password, name: body.name }),
  });

  const data = await response.json();
  if (!response.ok) {
    return NextResponse.json({ message: data.message ?? "Login failed" }, { status: response.status });
  }

  const res = NextResponse.json({ user: data.user });
  res.cookies.set(SESSION_COOKIE, data.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return res;
}
