import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth/session";

const cookieBase = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 7,
};

function tokenUnexpired(token: string) {
  const part = token.split(".")[1];
  if (!part) return false;
  try {
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now() + 60_000;
  } catch {
    return false;
  }
}

async function refreshedPay(refreshToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !anon) return null;
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const refreshed = await supabase.auth.refreshSession({ refresh_token: refreshToken });
  if (refreshed.error || !refreshed.data.session) return null;
  return {
    access: refreshed.data.session.access_token,
    refresh: refreshed.data.session.refresh_token,
  };
}

function finish(response: NextResponse, refreshed: { access: string; refresh: string } | null) {
  if (!refreshed) return response;
  response.cookies.set("sb_access", refreshed.access, cookieBase);
  response.cookies.set("sb_refresh", refreshed.refresh, cookieBase);
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/devices")) return NextResponse.next();
  const isCamera = pathname === "/" || pathname === "/api/face/clock";
  const session = await readSession(request.cookies.get("fc_session")?.value);
  const pay = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const refresh = request.cookies.get("sb_refresh")?.value ?? "";
  let access = request.cookies.get("sb_access")?.value ?? "";
  let refreshed: { access: string; refresh: string } | null = null;
  if (pay && refresh && !tokenUnexpired(access)) {
    refreshed = await refreshedPay(refresh);
    if (!refreshed) {
      if (pathname === "/login" || isCamera) return NextResponse.next();
      return NextResponse.redirect(new URL("/login", request.url));
    }
    access = refreshed.access;
    request.cookies.set("sb_access", refreshed.access);
    request.cookies.set("sb_refresh", refreshed.refresh);
  }
  const payAccess = Boolean(access);
  const signedIn = Boolean(session) && (!pay || payAccess);
  if (pathname === "/login") {
    if (signedIn) return finish(NextResponse.redirect(new URL("/dashboard", request.url)), refreshed);
    return finish(NextResponse.next(), refreshed);
  }
  if (isCamera) return finish(NextResponse.next({ request }), refreshed);
  if (!signedIn) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    if (session && pay && !payAccess) response.cookies.delete("fc_session");
    return finish(response, refreshed);
  }
  return finish(NextResponse.next({ request }), refreshed);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
