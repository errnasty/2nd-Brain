import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { simplifyArticle } from "@/lib/ai/simplify";
import { cleanHtml } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Rewrite an article at a plainer reading level, preserving its markup.
 *
 * The result is sanitized again on the way out: it's model-generated HTML built
 * from third-party source markup, so it gets the same treatment as any other
 * untrusted body before the reader injects it.
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

  const source = article.fullText ?? article.excerpt ?? "";
  if (!source.trim()) {
    return NextResponse.json({ error: "Nothing to simplify yet" }, { status: 422 });
  }

  const result = await simplifyArticle(article.title, source);
  if (!result) return NextResponse.json({ error: "Couldn't simplify this article" }, { status: 502 });

  return NextResponse.json({ title: result.title, content: cleanHtml(result.content) });
}
