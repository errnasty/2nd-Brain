import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentChunks } from "@/lib/db/schema";
import {
  EMBEDDING_SQL_TYPE,
  clampForEmbedding,
  embeddingParam,
  getEmbeddingsProvider,
} from "@/lib/embeddings";
import { EMBEDDING_TABLES } from "@/lib/embeddings/tables";

// Embedding batch size (one provider call per batch) and how many batches run
// concurrently. Bigger batches = fewer provider round-trips; concurrency
// overlaps the network waits. Each batch persists with ONE bulk SQL write
// instead of a round-trip per row — the previous per-item writes were the main
// reason "Refresh memory" felt slow.
const BATCH = 32;
const EMBED_CONCURRENCY = 3;
const CHUNK_BATCH = 16; // inline doc/embed helpers below keep their smaller size

/** Run async tasks with a bounded number in flight; preserves result order. */
async function runPool<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

type Embedded<T> = { item: T; text: string; vec: number[] };

/**
 * Embed `items` in concurrent batches and persist each batch with a single bulk
 * write (`write`). Returns totals. `failed` counts inputs the provider couldn't
 * embed.
 */
async function embedAndWrite<T>(
  items: T[],
  makeText: (t: T) => string,
  write: (rows: Embedded<T>[]) => Promise<void>,
  provider: ReturnType<typeof getEmbeddingsProvider>,
  label: string,
  progress: (msg: string) => void,
  signal?: AbortSignal,
): Promise<{ embedded: number; failed: number }> {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));

  let done = 0;
  const tasks = batches.map((batch) => async () => {
    // Client disconnected — skip remaining batches instead of burning more
    // provider calls on a response nobody is reading.
    if (signal?.aborted) return { embedded: 0, failed: 0 };
    const texts = batch.map(makeText);
    const vectors = await safeEmbedBatch(provider, texts);
    const rows: Embedded<T>[] = [];
    let failed = 0;
    for (let j = 0; j < batch.length; j += 1) {
      if (vectors[j]) rows.push({ item: batch[j], text: texts[j], vec: vectors[j]! });
      else failed += 1;
    }
    if (rows.length > 0) await write(rows);
    done += batch.length;
    progress(`${label}: ${Math.min(done, items.length)}/${items.length}`);
    return { embedded: rows.length, failed };
  });

  const parts = await runPool(tasks, EMBED_CONCURRENCY);
  return parts.reduce(
    (acc, p) => ({ embedded: acc.embedded + p.embedded, failed: acc.failed + p.failed }),
    { embedded: 0, failed: 0 },
  );
}

/**
 * Embed a batch resiliently. Returns vectors aligned 1:1 with `texts`; any
 * slot that couldn't be embedded is null (caller skips it).
 *
 * Why: provider.embed() rejects the WHOLE batch if a single input is bad
 * (empty, oversized, malformed). Articles have clean title+excerpt inputs so
 * they never trip this — but document chunks and notes can, which silently
 * dropped every item in their batches. On a batch failure we retry each input
 * individually so one poison input only loses itself.
 */
async function safeEmbedBatch(
  provider: ReturnType<typeof getEmbeddingsProvider>,
  texts: string[],
): Promise<(number[] | null)[]> {
  // Empty/whitespace inputs can't be embedded — mark null up front.
  const idx = texts.map((t, i) => (t.trim().length > 0 ? i : -1)).filter((i) => i >= 0);
  const nonEmpty = idx.map((i) => texts[i]);
  const out: (number[] | null)[] = texts.map(() => null);
  if (nonEmpty.length === 0) return out;

  try {
    const vectors = await provider.embed(nonEmpty);
    idx.forEach((origIdx, k) => (out[origIdx] = vectors[k] ?? null));
    return out;
  } catch {
    // Batch failed — retry each input alone so one bad item can't drop the rest.
    for (const origIdx of idx) {
      try {
        const [v] = await provider.embed([texts[origIdx]]);
        out[origIdx] = v ?? null;
      } catch {
        out[origIdx] = null;
      }
    }
    return out;
  }
}

export type BackfillResult = {
  articlesEmbedded: number;
  chunksEmbedded: number;
  notesEmbedded: number;
  failed: number;
  errors: string[];
};

// Run-once-per-instance guard so we don't re-issue DDL on every warm call.
let schemaEnsured = false;

/**
 * Idempotently guarantee the pgvector columns + HNSW indexes exist (the
 * contents of migrations 0005 and 0037). This removes the recurring
 * `column "embedding" does not exist` failures when a migration wasn't run by
 * hand. Each statement is isolated — `create extension` may be a no-op or
 * permission-gated on managed Postgres, and that's fine.
 *
 * It also upgrades a legacy `vector(1024)` column in place to `halfvec(1024)`.
 * That path exists for the DESKTOP app, which has no migration runner: an
 * existing PGlite database was created with fp32 columns, and every query now
 * casts its query vector to halfvec (pgvector has no `halfvec <=> vector`
 * operator), so without this an updated desktop build would lose semantic
 * search entirely. On the cloud, prefer running migration 0037 during a
 * maintenance window — the ALTER rewrites the table under an exclusive lock,
 * and the migration also reclaims the space this path leaves behind.
 */
export async function ensureVectorSchema(): Promise<void> {
  if (schemaEnsured) return;
  await runIsolated([sql`create extension if not exists vector`]);

  for (const table of EMBEDDING_TABLES) {
    // Table names come from the EMBEDDING_TABLES allowlist (not user input), so
    // sql.raw interpolation is safe here.
    const stored = await storedVectorType(table);

    if (stored === "vector") {
      // Legacy fp32 column. The HNSW index has to go first: `vector_cosine_ops`
      // does not accept halfvec, so an in-place ALTER would fail trying to
      // rebuild it.
      await runIsolated([
        sql.raw(`drop index if exists ${table}_embedding_idx`),
        sql.raw(`alter table ${table} alter column embedding type ${EMBEDDING_SQL_TYPE}`),
      ]);
    }

    await runIsolated([
      sql.raw(`alter table ${table} add column if not exists embedding ${EMBEDDING_SQL_TYPE}`),
      sql.raw(
        `create index if not exists ${table}_embedding_idx on ${table} using hnsw (embedding halfvec_cosine_ops)`,
      ),
    ]);
  }
  schemaEnsured = true;
}

/** The base type of `<table>.embedding`, or null when the column is absent. */
async function storedVectorType(table: string): Promise<string | null> {
  try {
    const rows = (await db.execute(sql`
      select t.typname
      from pg_attribute a
      join pg_type t on t.oid = a.atttypid
      where a.attrelid = ${table}::regclass and a.attname = 'embedding' and not a.attisdropped
    `)) as unknown as { typname: string }[];
    const list = Array.isArray(rows) ? rows : ((rows as { rows?: { typname: string }[] }).rows ?? []);
    return list[0]?.typname ?? null;
  } catch {
    // Table missing, or no permission to read the catalog — treat as "nothing
    // to upgrade" and let the add-column/create-index pass below do its best.
    return null;
  }
}

/** Run DDL one statement at a time so one failure can't abort the rest. */
async function runIsolated(statements: SQL[]): Promise<void> {
  for (const stmt of statements) {
    try {
      await db.execute(stmt);
    } catch (err) {
      console.warn("ensureVectorSchema statement skipped:", err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Embed any articles for `userId` that don't yet have a row in `article_embeddings`,
 * and any document_chunks where `embedding IS NULL`. Idempotent; safe to re-run.
 *
 * For each article we embed `title + "\n\n" + (excerpt|first 800 chars of fullText)`.
 * This keeps the per-item cost low and matches what the Daily Brief / related-knowledge
 * sidebar will compare against at query time.
 */

/** Optional progress callback — invoked after each batch so a streaming route
 *  can keep the connection alive past the proxy inactivity timeout. */
export type BackfillProgress = (msg: string) => void;

export async function backfillEmbeddings(
  userId: string,
  limit = 500,
  onProgress?: BackfillProgress,
  signal?: AbortSignal,
): Promise<BackfillResult> {
  const progress = (msg: string) => {
    try {
      onProgress?.(msg);
    } catch {
      // never let a progress sink break the backfill
    }
  };
  // Make sure the columns/indexes exist before we touch them.
  await ensureVectorSchema();
  progress("Schema ready. Scanning library…");

  const provider = getEmbeddingsProvider();
  let articlesEmbedded = 0;
  let chunksEmbedded = 0;
  let notesEmbedded = 0;
  let failed = 0;
  const errors: string[] = [];

  // ── Articles ─────────────────────────────────────────────────────
  // Whole phase wrapped so a missing column on the SELECT can't kill the
  // other phases (articles can still index even if notes can't, etc.).
  try {
    type ArticleRow = { id: string; title: string; excerpt: string | null; full_text: string | null };
    const articleRows = (await db.execute(sql`
      select a.id, a.title, a.excerpt, a.full_text
      from articles a
      left join article_embeddings e on e.article_id = a.id
      where a.user_id = ${userId} and e.id is null
      order by a.publish_date desc nulls last
      limit ${limit}
    `)) as unknown as ArticleRow[];

    const r = await embedAndWrite(
      articleRows,
      (a) => clampForEmbedding(`${a.title}\n\n${a.excerpt ?? a.full_text?.slice(0, 800) ?? ""}`.trim()),
      async (rows) => {
        const values = sql.join(
          rows.map((x) => sql`(${x.item.id}::uuid, ${userId}::uuid, 0, ${embeddingParam(x.vec)})`),
          sql`, `,
        );
        await db.execute(sql`
          insert into article_embeddings (article_id, user_id, chunk_index, embedding)
          values ${values}
          on conflict (article_id, chunk_index) do nothing
        `);
      },
      provider,
      "Articles",
      progress,
      signal,
    );
    articlesEmbedded += r.embedded;
    failed += r.failed;
  } catch (err) {
    errors.push(`articles: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Document chunks ──────────────────────────────────────────────
  if (signal?.aborted) return { articlesEmbedded, chunksEmbedded, notesEmbedded, failed, errors };
  try {
    const missingChunks = await db
      .select({ id: documentChunks.id, content: documentChunks.content })
      .from(documentChunks)
      .where(and(eq(documentChunks.userId, userId), isNull(documentChunks.embedding)))
      .limit(limit);

    const r = await embedAndWrite(
      missingChunks,
      (c) => clampForEmbedding(c.content),
      async (rows) => {
        const values = sql.join(
          rows.map((x) => sql`(${x.item.id}::uuid, ${embeddingParam(x.vec)})`),
          sql`, `,
        );
        await db.execute(sql`
          update document_chunks as t set embedding = v.emb
          from (values ${values}) as v(id, emb)
          where t.id = v.id and t.user_id = ${userId}
        `);
      },
      provider,
      "Documents",
      progress,
      signal,
    );
    chunksEmbedded += r.embedded;
    failed += r.failed;
  } catch (err) {
    errors.push(`chunks: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── User notes (embedding stored directly on directory_items) ────
  if (signal?.aborted) return { articlesEmbedded, chunksEmbedded, notesEmbedded, failed, errors };
  try {
    type NoteRow = { id: string; title: string; content: string | null };
    const missingNotes = (await db.execute(sql`
      select id, title, content
      from directory_items
      where user_id = ${userId} and kind = 'user_note' and embedding is null
      order by updated_at desc
      limit ${limit}
    `)) as unknown as NoteRow[];

    const r = await embedAndWrite(
      missingNotes,
      (n) => clampForEmbedding(`${n.title}\n\n${n.content ?? ""}`.trim()),
      async (rows) => {
        const values = sql.join(
          rows.map((x) => sql`(${x.item.id}::uuid, ${embeddingParam(x.vec)})`),
          sql`, `,
        );
        await db.execute(sql`
          update directory_items as t set embedding = v.emb
          from (values ${values}) as v(id, emb)
          where t.id = v.id and t.user_id = ${userId}
        `);
      },
      provider,
      "Notes",
      progress,
      signal,
    );
    notesEmbedded += r.embedded;
    failed += r.failed;
  } catch (err) {
    errors.push(`notes: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { articlesEmbedded, chunksEmbedded, notesEmbedded, failed, errors };
}

/** Embed a single user note inline (fire-and-forget after note save). */
export async function embedNote(
  noteId: string,
  userId: string,
  title: string,
  content: string | null,
): Promise<void> {
  try {
    await ensureVectorSchema(); // column must exist before we write to it
    const provider = getEmbeddingsProvider();
    const text = clampForEmbedding(`${title}\n\n${content ?? ""}`.trim());
    if (!text) return;
    const [vector] = await provider.embed([text]);
    const literal = embeddingParam(vector);
    await db.execute(sql`
      update directory_items
      set embedding = ${literal}
      where id = ${noteId} and user_id = ${userId}
    `);
  } catch (err) {
    console.warn("embedNote skipped:", err instanceof Error ? err.message : err);
  }
}

/**
 * Embed all unembedded chunks of one document inline (fire-and-forget after
 * upload/edit) so an uploaded doc is answerable in Ask immediately, without
 * waiting for Refresh Memory or the 6h cron. Bounded; large docs finish in
 * the next backfill.
 */
export async function embedDocument(documentId: string, userId: string, maxChunks = 40): Promise<void> {
  try {
    await ensureVectorSchema();
    const provider = getEmbeddingsProvider();
    const chunks = (await db.execute(sql`
      select id, content from document_chunks
      where document_id = ${documentId} and user_id = ${userId} and embedding is null
      order by chunk_index asc
      limit ${maxChunks}
    `)) as unknown as { id: string; content: string }[];
    for (let i = 0; i < chunks.length; i += CHUNK_BATCH) {
      const batch = chunks.slice(i, i + CHUNK_BATCH);
      const vectors = await safeEmbedBatch(provider, batch.map((c) => clampForEmbedding(c.content)));
      for (let j = 0; j < batch.length; j += 1) {
        if (!vectors[j]) continue;
        const literal = embeddingParam(vectors[j]!);
        await db.execute(sql`update document_chunks set embedding = ${literal} where id = ${batch[j].id}`);
      }
    }
  } catch (err) {
    console.warn("embedDocument skipped:", err instanceof Error ? err.message : err);
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
    const literal = embeddingParam(vector);
    await db.execute(sql`
      insert into article_embeddings (article_id, user_id, chunk_index, embedding)
      values (${articleId}, ${userId}, 0, ${literal})
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
  const literal = embeddingParam(vector);

  // Cosine distance (<=>) on pgvector returns 0 = identical, 2 = opposite.
  // similarity = 1 - distance (in [-1, 1], but for normalized OpenAI vectors ~[0, 1]).
  type ArticleResultRow = { ref_id: string; title: string; excerpt: string | null; similarity: number };
  const articleRows = (await db.execute(sql`
    select
      e.article_id as ref_id,
      a.title,
      a.excerpt,
      1 - (e.embedding <=> ${literal}) as similarity
    from article_embeddings e
    inner join articles a on a.id = e.article_id
    where e.user_id = ${userId}
      ${excludeArticleId ? sql`and e.article_id <> ${excludeArticleId}` : sql``}
    order by e.embedding <=> ${literal}
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
      1 - (c.embedding <=> ${literal}) as similarity
    from document_chunks c
    inner join documents d on d.id = c.document_id
    where c.user_id = ${userId} and c.embedding is not null
    order by c.embedding <=> ${literal}
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
