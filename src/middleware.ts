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
  // - api/cron: authed by CRON_SECRET bearer header, never by cookies; the
  //   session refresh is pure overhead and the !user redirect fights the 401
  //   the route itself returns.
  // - api/health: platform liveness probe. It is called without cookies, so
  //   the session check would answer a 307 to /login and the host would read
  //   a healthy deploy as failed.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|api/cron|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
