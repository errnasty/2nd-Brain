-- ─────────────────────────────────────────────────────────────────────
-- Migration 0037 — shrink the database: fp16 embeddings, drop dead weight
--
-- ⚠ DO NOT RUN THIS IN THE SUPABASE DASHBOARD SQL EDITOR.
--
-- The dashboard sends every statement through api.supabase.com, which gives up
-- on a request long before this finishes, and you get:
--
--     Error: Failed to fetch (api.supabase.com)
--
-- That is the BROWSER's request dying, not the migration failing. Nothing is
-- damaged — each statement is transactional, so an aborted one rolls back whole
-- — but two caveats matter:
--
--   • Postgres does not notice the client left until it tries to return
--     results, so the statement KEEPS RUNNING on the server after the error.
--     Wait for it, or you will queue a second rewrite behind the first and hold
--     an ACCESS EXCLUSIVE lock twice. supabase/check_0037.sql shows what is
--     still running and how far the migration got.
--   • Re-running is safe: every step below is idempotent and skips work that is
--     already done.
--
-- RUN IT OVER A DIRECT CONNECTION INSTEAD — there is no HTTP gateway in the
-- way, so nothing times out:
--
--     supabase db push
--
--     # …or, against the SESSION pooler (port 5432, not the 6543 transaction
--     # pooler — this needs one connection held for the whole run):
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f supabase/migrations/0037_halfvec_embeddings.sql
--
-- If the dashboard is genuinely all you have, run the STEP blocks below one at
-- a time, smallest first. Step 1 alone frees the largest single object in the
-- database and finishes instantly. Between Step 1 and Step 4 semantic search
-- still returns correct results, just by exact scan instead of the ANN index —
-- ~130 ms instead of ~2 ms on a library this size. Step 4 is the one that
-- cannot be made short, and is the step most likely to need psql.
--
-- ─────────────────────────────────────────────────────────────────────
-- WHAT IT DOES
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
-- REQUIRES pgvector >= 0.7 (Supabase ships 0.8; the desktop PGlite bundle ships
-- 0.8). On an older pgvector this migration reports a notice and changes
-- nothing, which leaves the app broken — src/lib/embeddings casts every query
-- vector to halfvec — so upgrade the extension rather than skipping this.
--
-- DISK: a rewrite needs room for the new copy beside the old. Step 1 runs first
-- for exactly that reason — on the library above it returns ~360 MB before
-- anything else starts, so the peak stays below where the database started.
-- ─────────────────────────────────────────────────────────────────────

-- No timeout, and enough memory to build each HNSW index in one pass. A build
-- that outgrows maintenance_work_mem falls back to a two-phase disk build: on a
-- 20k-row fixture that was 11.4 s instead of 2.8 s, and the gap widens with the
-- table. 256 MB comfortably holds the halfvec index for a ~50k-row library;
-- lower it if the instance is memory-starved, and expect a slower Step 4.
-- Both settings are session-local and revert when the connection closes.
set statement_timeout = 0;
set maintenance_work_mem = '256MB';

create extension if not exists vector;


-- ═══ STEP 1 ═══ Drop the fp32 ANN indexes.  Instant. Frees the most space.
--
-- These have to go before any ALTER anyway: vector_cosine_ops does not accept
-- halfvec, so an in-place type change fails trying to rebuild them. Doing it as
-- its own step also means the rewrites below have that space to work in.
-- Between here and Step 4, semantic search falls back to an exact scan —
-- slower, but correct, and the app stays up.

do $$
declare tbl text;
begin
  if to_regtype('halfvec') is null then
    raise exception 'pgvector is older than 0.7 (no halfvec type). Upgrade the extension, then re-run migration 0037.';
  end if;
  foreach tbl in array array['article_embeddings', 'document_chunks', 'directory_items']
  loop
    -- Only drop it if the column is still fp32. Re-running after Step 4 must
    -- not throw away a halfvec index that is already correct.
    if exists (
      select 1 from pg_attribute a
      where a.attrelid = to_regclass('public.' || tbl)
        and a.attname = 'embedding'
        and not a.attisdropped
        and format_type(a.atttypid, a.atttypmod) not like 'halfvec%'
    ) then
      execute format('drop index if exists %I', tbl || '_embedding_idx');
      raise notice 'step 1: dropped %_embedding_idx', tbl;
    end if;
  end loop;
end
$$;


-- ═══ STEP 2 ═══ Rewrite article_embeddings: fp16, and lose the dead column.
--
-- The slow one after Step 4. One ALTER TABLE = one table rewrite; dropping
-- `content` in the SAME statement means its TOASTed bytes are never copied into
-- the new heap. A separate DROP COLUMN is metadata-only and would leave them
-- behind (see "Reclaiming the rest" at the bottom).

do $$
declare current_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into current_type
  from pg_attribute a
  where a.attrelid = to_regclass('public.article_embeddings')
    and a.attname = 'embedding' and not a.attisdropped;

  if current_type is null then
    raise notice 'step 2: article_embeddings.embedding does not exist — skipping';
  elsif current_type like 'halfvec%' then
    raise notice 'step 2: already % — skipping', current_type;
  else
    execute 'alter table article_embeddings
               drop column if exists content,
               alter column embedding type halfvec(1024)';
    raise notice 'step 2: article_embeddings.embedding % -> halfvec(1024)', current_type;
  end if;
end
$$;

-- Catches the case where Step 2 skipped the rewrite because the column was
-- already halfvec (ensureVectorSchema converts it at runtime) but `content` is
-- still there. Metadata-only — see the VACUUM FULL note at the bottom.
alter table article_embeddings drop column if exists content;


-- ═══ STEP 3 ═══ Rewrite the two smaller embedding tables. Usually quick.

do $$
declare
  tbl          text;
  current_type text;
begin
  foreach tbl in array array['document_chunks', 'directory_items']
  loop
    select format_type(a.atttypid, a.atttypmod) into current_type
    from pg_attribute a
    where a.attrelid = to_regclass('public.' || tbl)
      and a.attname = 'embedding' and not a.attisdropped;

    if current_type is null then
      raise notice 'step 3: %.embedding does not exist — skipping', tbl;
    elsif current_type like 'halfvec%' then
      raise notice 'step 3: %.embedding already % — skipping', tbl, current_type;
    else
      execute format('alter table %I alter column embedding type halfvec(1024)', tbl);
      raise notice 'step 3: %.embedding % -> halfvec(1024)', tbl, current_type;
    end if;
  end loop;
end
$$;


-- ═══ STEP 4 ═══ Rebuild the ANN indexes against the new type.
--
-- The longest step, and the one the dashboard will not survive. Each index is
-- its own statement, so a timeout costs you that index and no more — re-run and
-- `if not exists` skips the ones already built. Run them one at a time if you
-- have to; article_embeddings is much the largest.

create index if not exists article_embeddings_embedding_idx
  on article_embeddings using hnsw (embedding halfvec_cosine_ops);

create index if not exists document_chunks_embedding_idx
  on document_chunks using hnsw (embedding halfvec_cosine_ops);

create index if not exists directory_items_embedding_idx
  on directory_items using hnsw (embedding halfvec_cosine_ops);


-- ═══ STEP 5 ═══ Redundant btree indexes on articles (see the header). Instant.

drop index if exists articles_folder_idx;
drop index if exists articles_publish_idx;

analyze article_embeddings;
analyze document_chunks;
analyze directory_items;
analyze articles;


-- ─────────────────────────────────────────────────────────────────────
-- Reclaiming the rest
--
-- The rewrites above return their own space on commit. Two other kinds of space
-- they do NOT return, both visible in supabase/report_sizes.sql:
--
-- 1. `content` bytes on a table Step 2 skipped. If the notice output said
--    "already halfvec", the DROP COLUMN was metadata-only and the old bytes are
--    still in that table's TOAST.
--
-- 2. Bloat on `articles`. purgeOldReadArticles (src/lib/rss/sync.ts) deletes up
--    to 2000 rows on every sync, and cascades into article_embeddings. Plain
--    autovacuum returns that space to the table for reuse, never to the
--    filesystem — so a long-running install can carry a lot of dead space in
--    the heap AND in the ~13 indexes on that table. Query 5 of report_sizes.sql
--    shows the dead-row counts.
--
-- Both are reclaimed the same way, outside any transaction — and, like this
-- migration, over psql rather than the dashboard:
--
--   vacuum full analyze article_embeddings;
--   vacuum full analyze articles;      -- also rebuilds its indexes
--
-- VACUUM FULL takes an ACCESS EXCLUSIVE lock and needs room for a second copy
-- of the table. If you cannot take the lock, `reindex table concurrently
-- articles` reclaims the index half without blocking writes.
-- ─────────────────────────────────────────────────────────────────────
