import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentChunks } from "@/lib/db/schema";
import { clampForEmbedding, getEmbeddingsProvider, toVectorLiteral } from "@/lib/embeddings";

const ARTICLE_BATCH = 16;
const CHUNK_BATCH = 16;

export type BackfillResult = {
  articlesEmbedded: number;
  chunksEmbedded: number;
  notesEmbedded: number;
  failed: number;
};

/**
 * Embed any articles for `userId` that don't yet have a row in `article_embeddings`,
 * and any document_chunks where `embedding IS NULL`. Idempotent; safe to re-run.
 *
 * For each article we embed `title + "\n\n" + (excerpt|first 800 chars of fullText)`.
 * This keeps the per-item cost low and matches what the Daily Brief / related-knowledge
 * sidebar will compare against at query time.
 */
const NOTE_BATCH = 16;

export async function backfillEmbeddings(userId: string, limit = 500): Promise<BackfillResult> {
  const provider = getEmbeddingsProvider();
  let articlesEmbedded = 0;
  let chunksEmbedded = 0;
  let notesEmbedded = 0;
  let failed = 0;

  // ── Articles ─────────────────────────────────────────────────────
  type ArticleRow = { id: string; title: string; excerpt: string | null; full_text: string | null };
  const missingArticles = (await db.execute(sql`
    select a.id, a.title, a.excerpt, a.full_text
    from articles a
    left join article_embeddings e on e.article_id = a.id
    where a.user_id = ${userId} and e.id is null
    order by a.publish_date desc nulls last
    limit ${limit}
  `)) as unknown as ArticleRow[];
  const articleRows = missingArticles;

  for (let i = 0; i < articleRows.length; i += ARTICLE_BATCH) {
    const batch = articleRows.slice(i, i + ARTICLE_BATCH);
    const texts = batch.map((r) =>
      clampForEmbedding(
        `${r.title}\n\n${r.excerpt ?? r.full_text?.slice(0, 800) ?? ""}`.trim(),
      ),
    );
    try {
      const vectors = await provider.embed(texts);
      for (let j = 0; j < batch.length; j += 1) {
        const row = batch[j];
        const vector = toVectorLiteral(vectors[j]);
        await db.execute(sql`
          insert into article_embeddings (article_id, user_id, chunk_index, content, embedding)
          values (${row.id}, ${userId}, 0, ${texts[j]}, ${vector}::vector)
          on conflict (article_id, chunk_index) do nothing
        `);
        articlesEmbedded += 1;
      }
    } catch (err) {
      failed += batch.length;
      console.error("Article embedding batch failed:", err);
    }
  }

  // ── Document chunks ──────────────────────────────────────────────
  const missingChunks = await db
    .select({ id: documentChunks.id, content: documentChunks.content })
    .from(documentChunks)
    .where(and(eq(documentChunks.userId, userId), isNull(documentChunks.embedding)))
    .limit(limit);

  for (let i = 0; i < missingChunks.length; i += CHUNK_BATCH) {
    const batch = missingChunks.slice(i, i + CHUNK_BATCH);
    const texts = batch.map((c) => clampForEmbedding(c.content));
    try {
      const vectors = await provider.embed(texts);
      for (let j = 0; j < batch.length; j += 1) {
        const id = batch[j].id;
        const vector = toVectorLiteral(vectors[j]);
        await db.execute(sql`
          update document_chunks
          set embedding = ${vector}::vector
          where id = ${id}
        `);
        chunksEmbedded += 1;
      }
    } catch (err) {
      failed += batch.length;
      console.error("Chunk embedding batch failed:", err);
    }
  }

  // ── User notes (in directory_items) ─────────────────────────────
  // Notes have no underlying document/article row, so their embedding lives
  // directly on directory_items.embedding.
  type NoteRow = { id: string; title: string; content: string | null };
  const missingNotes = (await db.execute(sql`
    select id, title, content
    from directory_items
    where user_id = ${userId}
      and kind = 'user_note'
      and embedding is null
    order by updated_at desc
    limit ${limit}
  `)) as unknown as NoteRow[];

  for (let i = 0; i < missingNotes.length; i += NOTE_BATCH) {
    const batch = missingNotes.slice(i, i + NOTE_BATCH);
    const texts = batch.map((n) =>
      clampForEmbedding(`${n.title}\n\n${n.content ?? ""}`.trim()),
    );
    try {
      const vectors = await provider.embed(texts);
      for (let j = 0; j < batch.length; j += 1) {
        const row = batch[j];
        const vector = toVectorLiteral(vectors[j]);
        await db.execute(sql`
          update directory_items
          set embedding = ${vector}::vector
          where id = ${row.id} and user_id = ${userId}
        `);
        notesEmbedded += 1;
      }
    } catch (err) {
      failed += batch.length;
      console.error("Note embedding batch failed:", err);
    }
  }

  return { articlesEmbedded, chunksEmbedded, notesEmbedded, failed };
}

/** Embed a single user note inline (fire-and-forget after note save). */
export async function embedNote(
  noteId: string,
  userId: string,
  title: string,
  content: string | null,
): Promise<void> {
  try {
    const provider = getEmbeddingsProvider();
    const text = clampForEmbedding(`${title}\n\n${content ?? ""}`.trim());
    if (!text) return;
    const [vector] = await provider.embed([text]);
    const literal = toVectorLiteral(vector);
    await db.execute(sql`
      update directory_items
      set embedding = ${literal}::vector
      where id = ${noteId} and user_id = ${userId}
    `);
  } catch (err) {
    console.warn("embedNote skipped:", err instanceof Error ? err.message : err);
  }
}

/** Embed a single article (used inline when a feed sync inserts new items). */
export async function embedArticle(
  articleId: string,
  userId: string,
  title: string,
  excerpt: string | null,
): Promise<void> {
  try {
    const provider = getEmbeddingsProvider();
    const text = clampForEmbedding(`${title}\n\n${excerpt ?? ""}`.trim());
    const [vector] = await provider.embed([text]);
    const literal = toVectorLiteral(vector);
    await db.execute(sql`
      insert into article_embeddings (article_id, user_id, chunk_index, content, embedding)
      values (${articleId}, ${userId}, 0, ${text}, ${literal}::vector)
      on conflict (article_id, chunk_index) do nothing
    `);
  } catch (err) {
    // Don't fail the sync if embeddings are misconfigured. Backfill can pick these up later.
    console.warn("embedArticle skipped:", err instanceof Error ? err.message : err);
  }
}

/** Find articles + document chunks similar to a given query embedding. */
export type RelatedItem = {
  kind: "article" | "chunk";
  id: string;
  refId: string;
  title: string;
  snippet: string;
  similarity: number;
};

export async function findRelated(
  userId: string,
  query: string,
  limit = 8,
  excludeArticleId?: string,
): Promise<RelatedItem[]> {
  const provider = getEmbeddingsProvider();
  const text = clampForEmbedding(query);
  const [vector] = await provider.embed([text]);
  const literal = toVectorLiteral(vector);

  // Cosine distance (<=>) on pgvector returns 0 = identical, 2 = opposite.
  // similarity = 1 - distance (in [-1, 1], but for normalized OpenAI vectors ~[0, 1]).
  type ArticleResultRow = { ref_id: string; title: string; excerpt: string | null; similarity: number };
  const articleRows = (await db.execute(sql`
    select
      e.article_id as ref_id,
      a.title,
      a.excerpt,
      1 - (e.embedding <=> ${literal}::vector) as similarity
    from article_embeddings e
    inner join articles a on a.id = e.article_id
    where e.user_id = ${userId}
      ${excludeArticleId ? sql`and e.article_id <> ${excludeArticleId}` : sql``}
    order by e.embedding <=> ${literal}::vector
    limit ${limit}
  `)) as unknown as ArticleResultRow[];

  const articleResults = articleRows.map((r) => ({
    kind: "article" as const,
    id: r.ref_id,
    refId: r.ref_id,
    title: r.title,
    snippet: (r.excerpt ?? "").slice(0, 200),
    similarity: Number(r.similarity),
  }));

  type ChunkResultRow = { id: string; ref_id: string; title: string; snippet: string; similarity: number };
  const chunkRows = (await db.execute(sql`
    select
      c.id,
      c.document_id as ref_id,
      d.title,
      substring(c.content, 1, 240) as snippet,
      1 - (c.embedding <=> ${literal}::vector) as similarity
    from document_chunks c
    inner join documents d on d.id = c.document_id
    where c.user_id = ${userId} and c.embedding is not null
    order by c.embedding <=> ${literal}::vector
    limit ${limit}
  `)) as unknown as ChunkResultRow[];

  const chunkResults = chunkRows.map((r) => ({
    kind: "chunk" as const,
    id: r.id,
    refId: r.ref_id,
    title: r.title,
    snippet: r.snippet,
    similarity: Number(r.similarity),
  }));

  // Interleave by similarity score, take top `limit`.
  return [...articleResults, ...chunkResults]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
