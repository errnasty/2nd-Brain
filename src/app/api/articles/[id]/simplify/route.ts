import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { simplifyChunk, simplifyTitle, SIMPLIFY_CHUNK_CHARS } from "@/lib/ai/simplify";
import { chunkHtml } from "@/lib/html/chunk-html";
import { cleanHtml } from "@/lib/sanitize";

export const runtime = "nodejs";

/**
 * Rewrite one chunk of an article at a plainer reading level.
 *
 * Unlike translation there is no non-AI way to do this, so it stays a model
 * call — but only ONE per request. This deploys to Netlify, where a
 * synchronous function is killed at ~10s no matter what `maxDuration` says
 * (that export is Vercel-only), and the previous version looped over every
 * chunk of the article inside a single request. On anything longer than a few
 * paragraphs it could never finish, which is why it always failed.
 *
 * The client now walks the chunks and renders each as it arrives, so a long
 * article fills in progressively instead of timing out with nothing to show.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const body = await req.json().catch(() => ({}));
  const chunkIndex = Number.isInteger(body.chunk) && body.chunk >= 0 ? (body.chunk as number) : 0;

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

  const chunks = chunkHtml(source, SIMPLIFY_CHUNK_CHARS);
  if (chunkIndex >= chunks.length) {
    return NextResponse.json({ error: "No such chunk" }, { status: 416 });
  }

  // The title rides along with the first chunk, and runs in parallel with it:
  // it's a separate short call, so waiting for it in sequence would spend part
  // of a budget that has none to spare.
  const [content, title] = await Promise.all([
    simplifyChunk(chunks[chunkIndex]),
    chunkIndex === 0 && article.title.trim() ? simplifyTitle(article.title) : Promise.resolve(null),
  ]);

  if (content === null) {
    return NextResponse.json({ error: "Couldn't simplify this article" }, { status: 502 });
  }

  return NextResponse.json({
    // Model-generated HTML built from third-party source markup — sanitized
    // again before the reader injects it.
    content: cleanHtml(content),
    title,
    chunkIndex,
    chunkCount: chunks.length,
  });
}
