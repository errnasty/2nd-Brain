import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { articles, directoryItems, documents } from "@/lib/db/schema";
import { spoilerClampSql } from "@/lib/books/spoiler-clamp";

/** Strip HTML to plain text (mirrors the helper in directory/actions). */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type ResolvedItemText = { title: string; text: string };

/**
 * Resolve the authoritative study/source text for a Directory item by kind:
 *  - user_note         → directory_items.content
 *  - uploaded_document → documents.full_text (NOT the truncated content preview)
 *  - saved_article     → articles.full_text (stripped) or excerpt
 *
 * Saved articles carry NO directory_items.content, and document content is only
 * a 10k preview, so any feature that read directory_items.content directly
 * (flashcards, study-plan seeding) silently failed or used drifting/partial
 * text. This is the single resolver those callers should share.
 *
 * Returns null if the item doesn't belong to the user / doesn't exist.
 */
export async function getDirectoryItemStudyText(
  userId: string,
  itemId: string,
): Promise<ResolvedItemText | null> {
  const [item] = await db
    .select({
      title: directoryItems.title,
      kind: directoryItems.kind,
      content: directoryItems.content,
      articleId: directoryItems.articleId,
      documentId: directoryItems.documentId,
    })
    .from(directoryItems)
    .where(and(eq(directoryItems.id, itemId), eq(directoryItems.userId, userId)))
    .limit(1);
  if (!item) return null;

  let text = item.content ?? "";

  if (item.kind === "saved_article" && item.articleId) {
    const [art] = await db
      .select({ excerpt: articles.excerpt, fullText: articles.fullText })
      .from(articles)
      .where(and(eq(articles.id, item.articleId), eq(articles.userId, userId)))
      .limit(1);
    if (art) text = art.fullText ? stripHtml(art.fullText) : art.excerpt ?? "";
  } else if (item.kind === "uploaded_document" && item.documentId) {
    const [doc] = await db
      .select({ fullText: documents.fullText, kind: documents.kind })
      .from(documents)
      .where(and(eq(documents.id, item.documentId), eq(documents.userId, userId)))
      .limit(1);

    if (doc?.kind === "epub") {
      // A book's full_text is the whole book, so distilling it or making cards
      // from it would spoil a reader who asked not to be. A clamped book is
      // reassembled from the chapters they have actually reached; with the
      // toggle off the clamp passes everything and this matches full_text.
      const rows = (await db.execute(sql`
        select string_agg(c.content, E'\n\n' order by c.chunk_index) as text
        from document_chunks c
        where c.document_id = ${item.documentId}
          and c.user_id = ${userId}
          and ${spoilerClampSql("c")}
      `)) as unknown as { text: string | null }[];
      text = rows[0]?.text ?? doc.fullText ?? "";
    } else if (doc?.fullText) {
      text = doc.fullText;
    }
  }

  return { title: item.title, text };
}
