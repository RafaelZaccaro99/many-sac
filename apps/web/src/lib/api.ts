import { cookies } from "next/headers";
import { apiUrl, SESSION_COOKIE } from "./session";

/** Server Component / Route Handler fetch helper - reads the session cookie directly. */
export async function serverApiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const response = await fetch(`${apiUrl()}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed with status ${response.status}`);
  }
  return response.json();
}
