export const SESSION_COOKIE = "mz_token";

export function apiUrl(): string {
  return process.env.API_URL ?? "http://localhost:3001";
}
