-- ─────────────────────────────────────────────────────────────────────
-- Migration 0037 — shrink the database: fp16 embeddings, drop dead weight
--
-- Embeddings dominate storage here, and not by a little. On a real 0.92 GB
-- library (~47k embedded articles) the split was:
--
--   article_embeddings (total)           639 MB   69 %
--     └ article_embeddings_embedding_idx 358 MB   39 %   ← largest single object
--   articles (total)                     219 MB   24 %
--   document_chunks (total)               26 MB    3 %
--
-- Three changes, none of which remove a feature:
--
-- 1. `vector(1024)` → `halfvec(1024)`. A 1024-dim fp32 vector is 4 KB and is
--    stored TWICE — once in the heap's TOAST, once inside the HNSW index, whose
--    element tuple embeds the whole vector. fp16 halves the TOAST copy and does
--    better than halve the index: at 4104 bytes only ONE element tuple fits an
--    8 KB index page (half the page wasted), while a 2056-byte halfvec fits
--    three. Measured on a 20k-row fixture, rebuilt under identical settings:
--
--        heap    toast    HNSW     total
--        13 MB   104 MB   153 MB   273 MB   vector(1024) + content
--       2.1 MB    52 MB    51 MB   107 MB   halfvec(1024), no content
--
--    The precision given up is precision nothing was using: these are unit-norm
--    vectors ranked by cosine distance, where fp16 resolves ~1e-4 against
--    ranking differences of ~1e-2. Measured against exact fp32 search over a
--    clustered 20k corpus, 500 probes: recall@10 99.9% (fp32 HNSW scores 100%),
--    and the top-1 result was identical on every single probe.
--
-- 2. Drop `article_embeddings.content`. It stored `title + "\n\n" + excerpt`,
--    already on `articles`. Every reader of this table joins `articles` for the
--    snippet it renders (src/lib/ai/rag.ts, src/lib/search.ts, findRelated), so
--    the copy was written on every insert and read by nothing.
--
-- 3. Drop `articles_folder_idx` and `articles_publish_idx`. The first is a
--    leading prefix of articles_folder_status_pub_idx, so it could never be the
--    better plan. The second is table-global, while every query that orders by
--    publish_date also filters on user/feed/folder — served by the composites.
--
-- Idempotent: re-running is a no-op, and the type conversion is skipped
-- entirely once the columns are already halfvec.
--
-- REQUIRES pgvector >= 0.7 (Supabase ships 0.8; the desktop PGlite bundle ships
-- 0.8). On an older pgvector this migration reports a notice and changes
-- nothing, which leaves the app broken — src/lib/embeddings casts every query
-- vector to halfvec — so upgrade the extension rather than skipping this.
--
-- BEFORE YOU RUN IT
--   • ALTER COLUMN TYPE rewrites the table under an ACCESS EXCLUSIVE lock. On
--     the numbers above this is minutes, not seconds; run it in a window.
--   • A rewrite needs room for the new copy alongside the old. The HNSW indexes
--     are dropped FIRST for exactly this reason — on the library above that
--     returns ~360 MB before anything is rebuilt.
-- ─────────────────────────────────────────────────────────────────────

create extension if not exists vector;

do $$
declare
  tbl          text;
  current_type text;
begin
  if to_regtype('halfvec') is null then
    raise notice 'pgvector is older than 0.7 (no halfvec type) — migration 0037 skipped. Upgrade pgvector, then re-run.';
    return;
  end if;

  foreach tbl in array array['article_embeddings', 'document_chunks', 'directory_items']
  loop
    select format_type(a.atttypid, a.atttypmod) into current_type
    from pg_attribute a
    where a.attrelid = to_regclass('public.' || tbl)
      and a.attname = 'embedding'
      and not a.attisdropped;

    if current_type is null then
      raise notice '%.embedding does not exist — skipping', tbl;
      continue;
    end if;

    if current_type like 'halfvec%' then
      raise notice '%.embedding is already %', tbl, current_type;
      continue;
    end if;

    -- The index has to go first: vector_cosine_ops does not accept halfvec, so
    -- an in-place ALTER fails trying to rebuild it. Dropping it also frees the
    -- space the rewrite below needs.
    execute format('drop index if exists %I', tbl || '_embedding_idx');

    if tbl = 'article_embeddings' then
      -- One ALTER TABLE = one table rewrite. Dropping `content` in the same
      -- statement means its TOASTed bytes are never copied to the new heap;
      -- a separate DROP COLUMN is metadata-only and would leave them behind.
      execute 'alter table article_embeddings
                 drop column if exists content,
                 alter column embedding type halfvec(1024)';
    else
      execute format('alter table %I alter column embedding type halfvec(1024)', tbl);
    end if;

    raise notice '%.embedding: % -> halfvec(1024)', tbl, current_type;
  end loop;
end
$$;

-- Covers the case where the loop above skipped the rewrite because the column
-- was already halfvec (e.g. ensureVectorSchema converted it at runtime) but
-- `content` is still there. This DROP is metadata-only, so see the VACUUM FULL
-- note at the bottom to actually reclaim those bytes.
alter table article_embeddings drop column if exists content;

-- Rebuild the ANN indexes against the new type.
do $$
begin
  if to_regtype('halfvec') is null then
    return;
  end if;
  create index if not exists article_embeddings_embedding_idx
    on article_embeddings using hnsw (embedding halfvec_cosine_ops);
  create index if not exists document_chunks_embedding_idx
    on document_chunks using hnsw (embedding halfvec_cosine_ops);
  create index if not exists directory_items_embedding_idx
    on directory_items using hnsw (embedding halfvec_cosine_ops);
end
$$;

-- Redundant btree indexes on articles (see the header).
drop index if exists articles_folder_idx;
drop index if exists articles_publish_idx;

analyze article_embeddings;
analyze document_chunks;
analyze directory_items;
analyze articles;

-- ─────────────────────────────────────────────────────────────────────
-- Reclaiming the rest
--
-- The rewrite above returns its own space on commit. Two other kinds of space
-- it does NOT return, both worth checking with supabase/report_sizes.sql:
--
-- 1. `content` bytes on a table the loop skipped. If the notice output said a
--    table was "already halfvec" (ensureVectorSchema had converted it at
--    runtime), the DROP COLUMN above was metadata-only and the old bytes are
--    still in its TOAST.
--
-- 2. Bloat on `articles`. purgeOldReadArticles (src/lib/rss/sync.ts) deletes up
--    to 2000 rows on every sync, and cascades into article_embeddings. Plain
--    autovacuum returns that space to the table for reuse, never to the
--    filesystem — so a long-running install can carry a lot of dead space in
--    the heap AND in the ~13 indexes on that table. Query 5 of report_sizes.sql
--    shows the dead-row counts.
--
-- Both are reclaimed the same way, outside any transaction:
--
--   vacuum full analyze article_embeddings;
--   vacuum full analyze articles;      -- also rebuilds its indexes
--
-- VACUUM FULL takes an ACCESS EXCLUSIVE lock and needs room for a second copy
-- of the table, so treat it the same way as the migration itself. If you cannot
-- take the lock, `reindex table concurrently articles` reclaims the index half
-- without blocking writes.
-- ─────────────────────────────────────────────────────────────────────
