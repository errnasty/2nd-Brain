import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Excluded beyond static assets:
  // - manifest.webmanifest + sw.js: public PWA files. Browsers fetch the
  //   manifest WITHOUT credentials, so the session check sees no user and
  //   redirects it to /login (broken install prompt) while paying a Supabase
  //   round-trip. Same failure mode for sw.js once the session cookie expires.
  // - api/cron, api/embeddings/cron-backfill, api/mcp: authed by a token
  //   header (CRON_SECRET / X-MCP-Token), never by cookies. The session
  //   refresh is pure overhead, and worse, the !user redirect answers 307 to
  //   /login BEFORE the route's own auth check runs — so the caller gets an
  //   HTML login page instead of its 200, and a curl following that redirect
  //   loses its Authorization header on the way.
  //
  //   These are prefixes, not patterns: `api/cron` skips only paths literally
  //   starting with it, which is why api/embeddings/cron-backfill had to be
  //   listed separately despite being a cron endpoint. ANY NEW ROUTE THAT
  //   AUTHENTICATES ITSELF WITH A TOKEN MUST BE ADDED HERE — middleware-matcher
  //   .test.ts asserts that, and will fail if one is missed.
  //
  //   Note api/embeddings/backfill (no `cron-`) is deliberately NOT excluded:
  //   it is the session-authed one and must keep its cookie check.
  // - api/health: platform liveness probe. It is called without cookies, so
  //   the session check would answer a 307 to /login and the host would read
  //   a healthy deploy as failed.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|api/cron|api/embeddings/cron-backfill|api/mcp|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
