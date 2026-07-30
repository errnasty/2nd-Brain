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
  // - .well-known: same uncredentialed-fetch problem, and worse to debug.
  //   Android's Digital Asset Links verifier fetches
  //   /.well-known/assetlinks.json with no cookies to decide whether the
  //   installed APK owns this domain. A 307 to /login fails that check
  //   SILENTLY — the app just shows a Chrome address bar forever, with nothing
  //   in any log pointing at the cause. See docs/ANDROID.md.
  // - api/cron: authed by CRON_SECRET bearer header, never by cookies; the
  //   session refresh is pure overhead and the !user redirect fights the 401
  //   the route itself returns.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|\\.well-known|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
