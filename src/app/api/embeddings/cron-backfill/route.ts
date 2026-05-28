import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { backfillEmbeddings } from "@/lib/embeddings/backfill";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Unauthenticated-but-token-secured backfill for cron.
 *
 * Verifies `Authorization: Bearer $CRON_SECRET`, then runs backfillEmbeddings
 * for every user — embedding any articles, document chunks, and notes that
 * don't have a vector yet. Idempotent and cheap when there's nothing to do.
 *
 * Driven by .github/workflows/backfill-embeddings.yml every 6 hours.
 */
export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const perUserLimit = Math.min(Number(url.searchParams.get("limit") ?? 500), 2000);

  const users = await db.select({ id: profiles.id }).from(profiles);

  let articles = 0;
  let chunks = 0;
  let notes = 0;
  let failed = 0;
  const perUser: Array<{ userId: string; articles: number; chunks: number; notes: number }> = [];

  for (const u of users) {
    try {
      const r = await backfillEmbeddings(u.id, perUserLimit);
      articles += r.articlesEmbedded;
      chunks += r.chunksEmbedded;
      notes += r.notesEmbedded;
      failed += r.failed;
      if (r.articlesEmbedded + r.chunksEmbedded + r.notesEmbedded > 0) {
        perUser.push({
          userId: u.id,
          articles: r.articlesEmbedded,
          chunks: r.chunksEmbedded,
          notes: r.notesEmbedded,
        });
      }
    } catch (err) {
      failed += 1;
      console.error(`Backfill failed for user ${u.id}:`, err instanceof Error ? err.message : err);
    }
  }

  return NextResponse.json({
    ok: true,
    users: users.length,
    embedded: { articles, chunks, notes },
    failed,
    perUser,
  });
}
