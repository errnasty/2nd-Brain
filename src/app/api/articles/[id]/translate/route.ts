import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles } from "@/lib/db/schema";
import { getApiUser } from "@/lib/auth";
import { translateArticle } from "@/lib/ai/translate";
import { cleanHtml } from "@/lib/sanitize";
import { detectLanguage, LANGUAGE_NAMES } from "@/lib/i18n/detect-language";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Translate an article into the reader's language, preserving its markup.
 *
 * Returns 409 when the article already reads as the target language, so the
 * client can mark it "no translation needed" instead of paying for a no-op.
 * The result is sanitized again on the way out: it's model-generated HTML
 * built from third-party source markup, so it gets the same treatment as any
 * other untrusted body before the reader injects it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, error } = await getApiUser();
  if (!user) return NextResponse.json({ error: error?.message }, { status: error?.status });

  const body = await req.json().catch(() => ({}));
  const target = typeof body.target === "string" ? body.target : "";
  if (!(target in LANGUAGE_NAMES)) {
    return NextResponse.json({ error: "Unsupported target language" }, { status: 400 });
  }

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

  const result = await translateArticle(article.title, source, target);
  if (!result) return NextResponse.json({ error: "Couldn't translate this article" }, { status: 502 });

  return NextResponse.json({
    title: result.title,
    content: cleanHtml(result.content),
    sourceLang: detected?.code ?? null,
    target,
  });
}
