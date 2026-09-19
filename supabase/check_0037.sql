-- ─────────────────────────────────────────────────────────────────────
-- Where did migration 0037 get to?
--
-- Read-only and instant, so this one IS safe to paste into the Supabase
-- dashboard SQL Editor — unlike the migration itself.
--
-- Run it when 0037 died with "Failed to fetch (api.supabase.com)". That error
-- is the browser's request timing out, not the migration failing; the statement
-- usually carries on running server-side. Query 1 tells you whether it is still
-- going. WAIT FOR IT TO FINISH before re-running the migration, or you will
-- queue a second table rewrite behind the first.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Is the migration still running right now?
--    An ALTER TABLE / CREATE INDEX here means it survived your browser. Leave
--    it alone. `wait_event` shows what it is doing; state 'active' plus a
--    growing `elapsed` is progress, not a hang.
select
  pid,
  state,
  now() - query_start as elapsed,
  wait_event_type,
  wait_event,
  left(regexp_replace(query, '\s+', ' ', 'g'), 120) as query
from pg_stat_activity
where datname = current_database()
  and pid <> pg_backend_pid()
  and state <> 'idle'
order by query_start;

-- 2. Which steps are done?
--    Step 2/3 land as halfvec(1024); step 4 puts each *_embedding_idx back.
select
  c.relname as table_name,
  format_type(a.atttypid, a.atttypmod) as embedding_type,
  case when format_type(a.atttypid, a.atttypmod) like 'halfvec%'
       then 'done' else 'still fp32 — steps 2/3 pending' end as step_2_3,
  coalesce(
    (select pg_size_pretty(pg_relation_size(i.indexrelid))
     from pg_stat_user_indexes i
     where i.relname = c.relname and i.indexrelname = c.relname || '_embedding_idx'),
    -- article_embeddings has no ANN index BY DESIGN since migration 0038 (the
    -- index cost as much as the table and could not use the per-user
    -- predicate), so its absence is the finished state, not a pending step.
    case when c.relname = 'article_embeddings'
         then 'none — dropped in 0038, by design'
         else 'MISSING — step 4 pending' end) as ann_index
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
-- relkind 'r' only: an HNSW index relation carries an `embedding` attribute of
-- its own, and without this it shows up here as a phantom table.
where n.nspname = 'public' and c.relkind = 'r'
  and a.attname = 'embedding' and not a.attisdropped
order by c.relname;

-- 3. Step 2's other half, and step 5.
select
  case when exists (
    select 1 from information_schema.columns
    where table_name = 'article_embeddings' and column_name = 'content'
  ) then 'still present — step 2 pending' else 'dropped' end as article_embeddings_content,
  case when to_regclass('public.articles_folder_idx') is null
       and to_regclass('public.articles_publish_idx') is null
       then 'dropped' else 'still present — step 5 pending' end as redundant_article_indexes,
  coalesce((select extversion from pg_extension where extname = 'vector'), 'NOT INSTALLED')
    as pgvector_version;

-- 4. Size now, and against the free plan's 500 MB.
select
  pg_size_pretty(pg_database_size(current_database())) as database_size,
  round(100.0 * pg_database_size(current_database()) / (500 * 1024 * 1024), 1) as pct_of_500mb,
  pg_size_pretty(pg_total_relation_size('article_embeddings')) as article_embeddings;

-- 5. If something IS stuck and you need it gone, take its pid from query 1:
--      select pg_cancel_backend(<pid>);           -- polite; try this first
--      select pg_terminate_backend(<pid>);        -- forceful
--    Either way the statement rolls back whole and the migration stays safe to
--    re-run from the top.
