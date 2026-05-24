import { NextResponse, type NextRequest } from "next/server";
import { syncAllFeeds } from "@/lib/rss/sync";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron entry point. Configured in vercel.json.
 *
 * Vercel signs cron invocations with `Authorization: Bearer $CRON_SECRET`
 * — we verify that. In dev, you can also call this manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/sync-feeds
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await syncAllFeeds();
  return NextResponse.json(summary);
}
