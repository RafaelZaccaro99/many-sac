import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";

export default function Home() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  redirect(token ? "/workspaces" : "/login");
}
