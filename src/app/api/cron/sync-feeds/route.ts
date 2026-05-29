import { NextResponse, type NextRequest } from "next/server";
import { syncAllFeeds } from "@/lib/rss/sync";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Cron entry point, hit by .github/workflows/sync-feeds.yml with
 * `Authorization: Bearer $CRON_SECRET`.
 *
 * The GitHub workflow fails the job on any non-200 and prints the JSON body,
 * so we always return a JSON body that explains what happened:
 *   401 → CRON_SECRET mismatch between the GitHub secret and the host env var
 *   500 → the error message from syncAllFeeds (now surfaced, not hidden)
 *   200 → { total, ok, failed } summary
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: "CRON_SECRET is not set in the server environment." },
      { status: 401 },
    );
  }
  if (auth !== expected) {
    return NextResponse.json(
      { error: "Unauthorized — CRON_SECRET does not match the Authorization header." },
      { status: 401 },
    );
  }

  try {
    const summary = await syncAllFeeds();
    return NextResponse.json(summary);
  } catch (err) {
    // syncFeed isolates per-feed errors already; this only fires on a
    // top-level failure (e.g. DB connection). Surface it so the cron log is
    // actually diagnosable instead of a bare 500.
    const message = err instanceof Error ? err.message : "Unknown sync error";
    console.error("cron sync-feeds failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
