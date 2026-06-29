import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { distill } from "@/lib/ai/distill";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * #1 Key takeaways for an article — a one-line TL;DR + 3-5 bullets via the
 * shared distill helper. Uses the cached full text (falls back to the excerpt).
 * Returns { tldr, keyPoints } or 422 when there's nothing to summarize.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [article] = await db
    .select({ title: articles.title, fullText: articles.fullText, excerpt: articles.excerpt })
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.userId, user.id)))
    .limit(1);
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const text = (article.fullText ?? article.excerpt ?? "").replace(/<[^>]+>/g, " ").trim();
  if (!text) return NextResponse.json({ error: "Nothing to summarize yet" }, { status: 422 });

  const result = await distill(article.title, text);
  if (!result) return NextResponse.json({ error: "Couldn't generate takeaways" }, { status: 502 });

  return NextResponse.json(result);
}
