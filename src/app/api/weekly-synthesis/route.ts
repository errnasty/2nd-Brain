import { NextResponse } from "next/server";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { weeklySynthesis } from "@/lib/ai/weekly-synthesis";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Enough reading for a through-line to mean anything. Below this, any pattern
 *  found would be noise dressed up as insight. */
const MIN_ARTICLES = 5;
/** Cap the corpus — cost scales with it and the signal plateaus. */
const MAX_ARTICLES = 40;

/**
 * What connected the last 7 days of reading: a through-line, recurring themes,
 * and places sources disagreed. Titles and excerpts only — never full text.
 */
export async function POST() {
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ title: articles.title, excerpt: articles.excerpt })
    .from(articles)
    .where(
      and(
        eq(articles.userId, user.id),
        eq(articles.readStatus, "read"),
        gte(articles.updatedAt, since),
      ),
    )
    .orderBy(desc(articles.updatedAt))
    .limit(MAX_ARTICLES);

  if (rows.length < MIN_ARTICLES) {
    return NextResponse.json({ error: "Not enough reading this week" }, { status: 422 });
  }

  const result = await weeklySynthesis(rows);
  if (!result) return NextResponse.json({ error: "Couldn't synthesize this week" }, { status: 502 });

  return NextResponse.json({ ...result, articleCount: rows.length });
}
