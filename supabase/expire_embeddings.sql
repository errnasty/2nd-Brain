-- ─────────────────────────────────────────────────────────────────────
-- Drain the embedding-expiry backlog.
--
-- The app expires stale vectors on every feed sync, a batch at a time
-- (expireStaleArticleEmbeddings, src/lib/embeddings/backfill.ts). This does the
-- same work on demand so the space comes back today.
--
-- HOW TO RUN IT
--   STEP 1 shows what is going. Then run STEP 2 over and over until it reports
--   0. Each run is one self-contained statement and its own transaction, so it
--   works in the Supabase SQL editor as well as in psql, and stopping half way
--   just leaves the rest for next time. No DO block, no COMMIT — see
--   supabase/purge_backlog.sql for why that matters.
--
-- WHAT IT DELETES — vectors only. The ARTICLES ARE NOT TOUCHED: they stay in
-- your feeds, keep their titles and text, and keyword search still finds them.
-- What they lose is their place in global semantic search and in the related
-- sidebar. Ask, trending, and every statistic are unaffected.
--
-- An article KEEPS its vector while any of these hold — a copy of
-- deservesEmbeddingSql in src/lib/embeddings/policy.ts, and it must stay a copy:
--   • starred, or saved for later
--   • read (read_status <> 'unread')
--   • saved to the Directory
--   • created in the last 30 days (RETENTION_DAYS, lib/feeds/retention.ts)
-- ─────────────────────────────────────────────────────────────────────


-- ═══ STEP 1 ═══ What is about to go. Read-only.

select
  count(*)                     as expirable_vectors,
  ceil(count(*) / 20000.0)::int as step_2_runs_needed,
  pg_size_pretty(
    (count(*) * (pg_total_relation_size('article_embeddings')
      / nullif((select count(*) from article_embeddings), 0)))::bigint) as approx_reclaim
from article_embeddings e
join articles a on a.id = e.article_id
where not (
  a.starred
  or a.read_later
  or a.read_status <> 'unread'
  or a.created_at > now() - interval '30 days'
  or exists (
    select 1 from directory_items di
    where di.article_id = a.id and di.user_id = a.user_id
  )
);


-- ═══ STEP 2 ═══ One batch. RE-RUN THIS UNTIL IT REPORTS 0.

with expirable as (
  select e.id
  from article_embeddings e
  join articles a on a.id = e.article_id
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
),
deleted as (
  delete from article_embeddings where id in (select id from expirable) returning 1
)
select count(*)::int as removed_this_run from deleted;


-- ═══ STEP 3 ═══ After the last batch.

analyze article_embeddings;


-- ─────────────────────────────────────────────────────────────────────
-- Draining it in one command (psql only)
--
--   while :; do
--     n=$(psql "$DATABASE_URL" -tAc "
--       with expirable as (
--         select e.id from article_embeddings e join articles a on a.id = e.article_id
--         where not (a.starred or a.read_later or a.read_status <> 'unread'
--           or a.created_at > now() - interval '30 days'
--           or exists (select 1 from directory_items di
--                      where di.article_id = a.id and di.user_id = a.user_id))
--         limit 20000
--       ), deleted as (
--         delete from article_embeddings where id in (select id from expirable) returning 1
--       ) select count(*) from deleted;")
--     echo "removed $n"
--     [ "$n" -eq 0 ] && break
--   done
--
-- Then, over psql, to hand the space back to the filesystem:
--
--   vacuum full analyze article_embeddings;
-- ─────────────────────────────────────────────────────────────────────
