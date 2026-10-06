import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "@/lib/auth/session";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/devices")) return NextResponse.next();
  const session = await readSession(request.cookies.get("fc_session")?.value);
  const pay = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const payAccess = Boolean(request.cookies.get("sb_access")?.value);
  const signedIn = Boolean(session) && (!pay || payAccess);
  if (pathname === "/login") {
    if (signedIn) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }
  if (!signedIn) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    if (session && pay && !payAccess) response.cookies.delete("fc_session");
    return response;
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
