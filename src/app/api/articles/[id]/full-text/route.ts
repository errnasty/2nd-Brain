import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { extractReadable } from "@/lib/readability/extract";
import { cleanHtml } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * On-demand full-text fetch. Triggered when the user opens an article whose
 * `full_text` is still null (RSS only gave us a snippet).
 *
 * Returns { content, title? } so the client can hydrate the reader pane.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.userId, user.id)))
    .limit(1);
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (article.fullText) {
    // Sanitize on read too, in case it was cached before sanitization existed.
    return NextResponse.json({ content: cleanHtml(article.fullText), cached: true });
  }

  try {
    const extracted = await extractReadable(article.url);
    const safe = cleanHtml(extracted.content);
    await db
      .update(articles)
      .set({
        fullText: safe, // store clean HTML at rest
        fullTextFetchedAt: new Date(),
        wordCount: extracted.textContent.split(/\s+/).length,
      })
      .where(eq(articles.id, id));

    return NextResponse.json({ content: safe, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Extraction failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
