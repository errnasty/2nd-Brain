-- ─────────────────────────────────────────────────────────────────────
-- Migration 0038 — stop article embeddings growing forever
--
-- Two changes, both aimed at the same object: after 0037, article_embeddings
-- was still the largest thing in the database, and it grows with every headline
-- the app has ever seen. Unread articles are never purged (lib/feeds/
-- retention.ts), so without an expiry their vectors are kept for good.
--
-- 1. DROP THE HNSW INDEX.
--
--    An HNSW element tuple carries the whole vector, and at 2056 bytes only
--    three fit an 8 KB index page — so the index cost about as much as the
--    vectors it indexed (measured on a 20k-row fixture: 51 MB index, 54 MB
--    table). It also could not use the `user_id = …` predicate that every query
--    against this table carries: HNSW searches the whole graph and filters
--    afterwards.
--
--    What replaces it is an exact scan over article_embeddings_user_idx, which
--    is MORE accurate than the approximate graph it replaces — a nearest
--    neighbour is now actually the nearest neighbour. The cost is latency, and
--    the expiry below is what keeps that honest by keeping the table small.
--
--    document_chunks and directory_items KEEP their HNSW indexes: one book can
--    add thousands of chunks and neither has an expiry policy.
--
-- 2. EXPIRE VECTORS THE APP NO LONGER READS.
--
--    Only four things read this table and they want different rows: Ask
--    inner-joins directory_items, so it sees ONLY saved articles; trending
--    reads the last 48 hours and LEFT joins, so a missing vector degrades to
--    headline overlap; global search reads only UNSAVED articles; the related
--    sidebar reads any.
--
--    So a vector on an article that is old, unsaved and never opened is bought
--    entirely for global semantic search and the related sidebar. Those two
--    stop reaching into the long tail. Keyword search is trigram/tsvector
--    indexed and completely unaffected, as are Ask, trending, and every
--    statistic (XP, levels, streaks, achievements and the Study figures are
--    counted as you earn them, never recounted from rows).
--
--    An article keeps its vector while ANY of these hold — the exact predicate
--    in src/lib/embeddings/policy.ts, which the backfill uses as its filter so
--    the two are complements and cannot loop against each other:
--      • starred, or saved for later
--      • read (read_status <> 'unread')
--      • saved to the Directory
--      • created in the last 30 days (RETENTION_DAYS)
--
-- This migration is idempotent. It does the schema half and ONE bounded pass of
-- the expiry; the backlog drains from the app on each feed sync, or all at once
-- with supabase/purge_backlog.sql's sibling, supabase/expire_embeddings.sql.
-- ─────────────────────────────────────────────────────────────────────

set statement_timeout = 0;

-- ═══ STEP 1 ═══ Drop the ANN index. Instant, and frees the most space.

drop index if exists article_embeddings_embedding_idx;

-- The per-user index is what the exact scan walks now, so make sure it exists.
create index if not exists article_embeddings_user_idx
  on article_embeddings (user_id);


-- ═══ STEP 2 ═══ One bounded expiry pass.
--
-- Bounded so this migration stays short. Re-run it, or run
-- supabase/expire_embeddings.sql, until nothing is left.

delete from article_embeddings e
where e.id in (
  select e2.id
  from article_embeddings e2
  join articles a on a.id = e2.article_id
  where not (
    a.starred
    or a.read_later
    or a.read_status <> 'unread'
    or a.created_at > now() - interval '30 days'
    or exists (
      select 1 from directory_items di
      where di.article_id = a.id and di.user_id = a.user_id
    )
  )
  limit 20000
);

analyze article_embeddings;

-- ─────────────────────────────────────────────────────────────────────
-- Afterwards
--
--   • supabase/expire_embeddings.sql drains whatever this pass left.
--   • A DELETE marks rows dead; it does not return their space. Once the
--     expiry reports 0, run over psql (VACUUM FULL cannot run in the SQL
--     editor — it cannot run inside a transaction):
--
--       vacuum full analyze article_embeddings;
--
--   • supabase/report_sizes.sql shows the before and after, and
--     supabase/embedding_audit.sql breaks down what is left by who needs it.
-- ─────────────────────────────────────────────────────────────────────
