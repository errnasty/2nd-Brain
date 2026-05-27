import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { findRelated } from "@/lib/embeddings/backfill";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  let user;
  try {
    ({ user } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const articleId = url.searchParams.get("articleId");
  if (!articleId) return NextResponse.json({ error: "articleId required" }, { status: 400 });

  // Build the query text from the article itself
  const [article] = await db
    .select({ title: articles.title, excerpt: articles.excerpt, fullText: articles.fullText })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.userId, user.id)))
    .limit(1);

  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const query = `${article.title}\n\n${article.excerpt ?? article.fullText?.slice(0, 800) ?? ""}`.trim();

  try {
    const items = await findRelated(user.id, query, 8, articleId);
    // Only return items with reasonable similarity — otherwise show "no related yet"
    const filtered = items.filter((i) => i.similarity > 0.35);
    return NextResponse.json({ items: filtered });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ items: [], error: message }, { status: 500 });
  }
}
