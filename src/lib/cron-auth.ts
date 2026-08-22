import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared `Authorization: Bearer $CRON_SECRET` gate for the GitHub-Actions cron
 * endpoints (feed sync, trending, embeddings backfill).
 *
 * Both sides of this comparison are pasted by hand — into the host's service
 * variables and into a GitHub Actions secret — and a value copied out of a
 * terminal or a password manager routinely carries a trailing newline or
 * space. Neither dashboard renders that, so an exact `!==` rejects two values
 * a human would swear are identical. Comparing the trimmed forms costs nothing
 * and removes the most common false mismatch.
 *
 * Returns `null` when the request is authorised, or the 401 to send back.
 */
export function checkCronAuth(request: Request): NextResponse | null {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set in the server environment." },
      { status: 401 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (token && equalsConstantTime(token, secret)) return null;

  return NextResponse.json(
    {
      error: "Unauthorized — CRON_SECRET does not match the Authorization header.",
      // The workflow prints this body, so make one run enough to tell the three
      // real causes apart without echoing either value:
      //   "missing"      → the header never arrived. APP_URL points at another
      //                    deploy, or a cross-host redirect stripped it (curl
      //                    drops Authorization when -L crosses hosts).
      //   lengths differ → genuinely different secrets.
      //   lengths equal  → same-looking values that still differ. Usually the
      //                    running container booted before the variable was
      //                    updated; a host that injects env at start (Railway)
      //                    needs a redeploy to pick a new value up.
      diagnostic: {
        receivedToken: token ? `${token.length} chars` : "missing",
        expectedSecret: `${secret.length} chars`,
      },
    },
    { status: 401 },
  );
}

function equalsConstantTime(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, so that has to be checked
  // first — the length of a random token is not the secret.
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
