import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clampForEmbedding, getEmbeddingsProvider, toVectorLiteral } from "@/lib/embeddings";

export type RagSource = {
  directoryItemId: string;
  title: string;
  kind: "saved_article" | "uploaded_document" | "user_note";
  snippet: string;
  similarity: number;
  sourceKind: "article" | "chunk" | "note";
};

/**
 * Find the most relevant pieces of the user's Directory for a question.
 *
 * Searches:
 *   - document chunks of UPLOADED DOCUMENTS that have a directory_items row
 *   - article_embeddings of SAVED ARTICLES that have a directory_items row
 *
 * Notes (kind = 'user_note') are embedded directly on directory_items.embedding
 * (no underlying document row to chunk).
 *
 * Results are deduplicated by directoryItemId (an item with many chunks only
 * yields one entry, using its best-matching chunk).
 */
export async function retrieveFromDirectory(
  userId: string,
  query: string,
  limit = 8,
): Promise<RagSource[]> {
  const provider = getEmbeddingsProvider();
  const text = clampForEmbedding(query);
  const [vector] = await provider.embed([text], "query");
  const lit = toVectorLiteral(vector);

  type Hit = {
    directory_item_id: string;
    title: string;
    snippet: string;
    similarity: number;
  };

  // Each source is wrapped so a missing column/index on ONE table (e.g. a
  // migration not yet run) doesn't kill the whole retrieval. A failed source
  // just contributes nothing.
  async function safe(run: () => Promise<unknown>): Promise<Hit[]> {
    try {
      return (await run()) as unknown as Hit[];
    } catch (err) {
      console.warn("RAG source query failed (skipping):", err instanceof Error ? err.message : err);
      return [];
    }
  }

  const [chunkHits, articleHits, noteHits] = await Promise.all([
    // ── Uploaded documents (chunks) ──
    safe(() =>
      db.execute(sql`
        select
          di.id as directory_item_id,
          di.title,
          substring(c.content, 1, 400) as snippet,
          1 - (c.embedding <=> ${lit}::vector) as similarity
        from directory_items di
        inner join document_chunks c on c.document_id = di.document_id
        where di.user_id = ${userId}
          and di.kind = 'uploaded_document'
          and c.embedding is not null
        order by c.embedding <=> ${lit}::vector
        limit ${limit * 2}
      `),
    ),
    // ── Saved articles ──
    safe(() =>
      db.execute(sql`
        select
          di.id as directory_item_id,
          di.title,
          substring(coalesce(a.full_text, a.excerpt, ''), 1, 400) as snippet,
          1 - (e.embedding <=> ${lit}::vector) as similarity
        from directory_items di
        inner join articles a on a.id = di.article_id
        inner join article_embeddings e on e.article_id = a.id
        where di.user_id = ${userId}
          and di.kind = 'saved_article'
        order by e.embedding <=> ${lit}::vector
        limit ${limit * 2}
      `),
    ),
    // ── User notes (embedded directly on directory_items) ──
    safe(() =>
      db.execute(sql`
        select
          id as directory_item_id,
          title,
          coalesce(substring(content, 1, 400), '') as snippet,
          1 - (embedding <=> ${lit}::vector) as similarity
        from directory_items
        where user_id = ${userId}
          and kind = 'user_note'
          and embedding is not null
        order by embedding <=> ${lit}::vector
        limit ${limit * 2}
      `),
    ),
  ]);

  // Combine, dedupe by directoryItemId (keep best score), take top N
  const byItem = new Map<string, RagSource>();

  for (const h of chunkHits) {
    const existing = byItem.get(h.directory_item_id);
    const sim = Number(h.similarity);
    if (!existing || sim > existing.similarity) {
      byItem.set(h.directory_item_id, {
        directoryItemId: h.directory_item_id,
        title: h.title,
        kind: "uploaded_document",
        snippet: (h.snippet ?? "").trim(),
        similarity: sim,
        sourceKind: "chunk",
      });
    }
  }
  for (const h of articleHits) {
    const existing = byItem.get(h.directory_item_id);
    const sim = Number(h.similarity);
    if (!existing || sim > existing.similarity) {
      byItem.set(h.directory_item_id, {
        directoryItemId: h.directory_item_id,
        title: h.title,
        kind: "saved_article",
        snippet: (h.snippet ?? "").trim(),
        similarity: sim,
        sourceKind: "article",
      });
    }
  }

  for (const h of noteHits) {
    const existing = byItem.get(h.directory_item_id);
    const sim = Number(h.similarity);
    if (!existing || sim > existing.similarity) {
      byItem.set(h.directory_item_id, {
        directoryItemId: h.directory_item_id,
        title: h.title,
        kind: "user_note",
        snippet: (h.snippet ?? "").trim(),
        similarity: sim,
        sourceKind: "note",
      });
    }
  }

  return Array.from(byItem.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
