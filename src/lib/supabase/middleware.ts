import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Request header carrying the middleware-verified Supabase user to server
 * components, so requireUser() doesn't pay a SECOND Auth-server round-trip on
 * the same request. Only this middleware may set it: the incoming value is
 * always stripped below, so an external client cannot spoof it.
 */
export const VERIFIED_USER_HEADER = "x-sb-verified-user";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient() and the auth call.
  // Desktop trusts the locally stored session (getSession, no network) so every
  // navigation isn't gated on a Supabase round-trip; the cloud verifies via
  // getUser() as before.
  let user;
  if (process.env.APP_RUNTIME === "desktop") {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    user = session?.user ?? null;
  } else {
    const {
      data: { user: verified },
    } = await supabase.auth.getUser();
    user = verified;
  }

  const pathname = request.nextUrl.pathname;
  const isAuthRoute =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/mcp");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Forward the verified user to the server render (and strip any spoofed
  // incoming copy). Headers are snapshotted AFTER the auth call so the cookie
  // mutations from a token refresh are included; the cookies already written
  // to supabaseResponse (Set-Cookie for the browser) are re-applied onto the
  // rebuilt response.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete(VERIFIED_USER_HEADER);
  if (user && process.env.APP_RUNTIME !== "desktop") {
    // encodeURIComponent keeps the value ASCII-safe (user_metadata may hold
    // unicode names). Verified via getUser() above, so downstream can trust it.
    forwardedHeaders.set(VERIFIED_USER_HEADER, encodeURIComponent(JSON.stringify(user)));
  }
  const finalResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
  for (const cookie of supabaseResponse.cookies.getAll()) {
    finalResponse.cookies.set(cookie);
  }
  return finalResponse;
}
