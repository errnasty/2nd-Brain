import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { chunkHtml } from "@/lib/html/chunk-html";
import { translateHtml, translateText } from "@/lib/i18n/machine-translate";
import { cleanHtml } from "@/lib/sanitize";
import { detectLanguage, LANGUAGE_NAMES } from "@/lib/i18n/detect-language";

export const runtime = "nodejs";

/**
 * Translate one chunk of an article with a real machine-translation engine.
 *
 * Two deliberate properties:
 *
 * 1. **No model call.** Translation is deterministic work with a correct
 *    answer; an LLM costs tokens, is slower by an order of magnitude, and can
 *    decide to summarise instead. See lib/i18n/machine-translate.
 *
 * 2. **One chunk per request.** This deploys to Netlify, where a synchronous
 *    function is killed at ~10s regardless of any `maxDuration` export (that
 *    directive is Vercel-only). Whole-article translation cannot fit in that
 *    budget, so the client walks the chunks and renders them as they land.
 *    Chunking is derived from the stored body, so chunk N is the same slice on
 *    every request without any server-side session state.
 */

/** MT is ~20x faster per character than a model, so chunks can be far larger
 *  than the model path's — while still leaving headroom under the 10s cap. */
const MT_CHUNK_CHARS = 8000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const body = await req.json().catch(() => ({}));
  const target = typeof body.target === "string" ? body.target : "";
  if (!(target in LANGUAGE_NAMES)) {
    return NextResponse.json({ error: "Unsupported target language" }, { status: 400 });
  }
  const chunkIndex = Number.isInteger(body.chunk) && body.chunk >= 0 ? (body.chunk as number) : 0;

  const [article] = await db
    .select({ title: articles.title, fullText: articles.fullText, excerpt: articles.excerpt })
    .from(articles)
    .where(and(eq(articles.id, id), eq(articles.userId, user.id)))
    .limit(1);
  if (!article) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const source = article.fullText ?? article.excerpt ?? "";
  if (!source.trim()) {
    return NextResponse.json({ error: "Nothing to translate yet" }, { status: 422 });
  }

  const detected = detectLanguage(`${article.title} ${source}`);
  if (detected && detected.code === target) {
    return NextResponse.json(
      { error: "Already in that language", sourceLang: detected.code },
      { status: 409 },
    );
  }

  const chunks = chunkHtml(source, MT_CHUNK_CHARS);
  if (chunkIndex >= chunks.length) {
    return NextResponse.json({ error: "No such chunk" }, { status: 416 });
  }

  // An unsure detector is not a reason to refuse: hand the engine `null` and
  // let it auto-detect, which it does better than a stopword heuristic anyway.
  const sourceLang = detected?.code ?? null;

  try {
    // The title rides along with the first chunk so the header doesn't sit in
    // the source language while the body is already translated.
    const [content, title] = await Promise.all([
      translateHtml(chunks[chunkIndex], target, { source: sourceLang, budgetMs: 7000 }),
      chunkIndex === 0 && article.title.trim()
        ? translateText(article.title, target, { source: sourceLang, budgetMs: 7000 })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      // Re-sanitized on the way out: the body came from a third-party feed and
      // has been through an external service, so it gets the same treatment as
      // any other untrusted markup before the reader injects it.
      content: cleanHtml(content),
      title,
      chunkIndex,
      chunkCount: chunks.length,
      sourceLang,
      target,
    });
  } catch (err) {
    console.warn("translate chunk failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "The translation service didn't respond. Try again in a moment." },
      { status: 502 },
    );
  }
}
