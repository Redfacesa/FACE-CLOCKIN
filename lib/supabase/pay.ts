import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function payConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return { url, anon, enabled: Boolean(url && anon) };
}

export function payClient() {
  const { url, anon } = payConfig();
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

export async function savePaySession(accessToken: string, refreshToken: string) {
  const jar = await cookies();
  jar.set("sb_access", accessToken, cookieBase);
  jar.set("sb_refresh", refreshToken, cookieBase);
}

export async function clearPaySession() {
  const jar = await cookies();
  jar.delete("sb_access");
  jar.delete("sb_refresh");
}

/** User-scoped client so Redface Pay row-level security applies. */
export async function paySession(): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const { enabled } = payConfig();
  if (!enabled) return null;
  const jar = await cookies();
  const access = jar.get("sb_access")?.value;
  const refresh = jar.get("sb_refresh")?.value;
  const supabase = payClient();
  if (access) {
    const { data, error } = await supabase.auth.getUser(access);
    if (!error && data.user) {
      await supabase.auth.setSession({ access_token: access, refresh_token: refresh || access });
      return { supabase, user: data.user };
    }
  }
  if (!refresh) return null;
  const refreshed = await supabase.auth.refreshSession({ refresh_token: refresh });
  if (refreshed.error || !refreshed.data.session || !refreshed.data.user) return null;
  await savePaySession(refreshed.data.session.access_token, refreshed.data.session.refresh_token);
  return { supabase, user: refreshed.data.user };
}
