-- ─────────────────────────────────────────────────────────────────────
-- Where the database size actually is.
--
-- Read-only; safe to run any time. Paste into the Supabase SQL Editor (or
-- `psql -f`) before and after migration 0037 to see what moved.
--
-- Supabase's own "Large Objects" panel reports tables as pg_total_relation_size
-- (heap + TOAST + every index) and indexes as pg_relation_size, so an index
-- appears BOTH on its own row and inside its table's row. That is why the
-- percentages there add up to well over 100%. The first query below splits the
-- two apart so the numbers are additive.
-- ─────────────────────────────────────────────────────────────────────

-- 1. Per table: heap, TOAST (where 4 KB vectors live) and indexes, separately.
select
  c.relname                                            as table_name,
  pg_size_pretty(pg_table_size(c.oid) - coalesce(pg_relation_size(c.reltoastrelid), 0)) as heap,
  pg_size_pretty(coalesce(pg_relation_size(c.reltoastrelid), 0))                        as toast,
  pg_size_pretty(pg_indexes_size(c.oid))               as indexes,
  pg_size_pretty(pg_total_relation_size(c.oid))        as total,
  round(100.0 * pg_total_relation_size(c.oid)
        / nullif(sum(pg_total_relation_size(c.oid)) over (), 0), 1) as pct,
  c.reltuples::bigint                                  as approx_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 20;

-- 2. Per index, biggest first. An index that never appears in idx_scan is a
--    candidate for dropping — but check it isn't backing a UNIQUE constraint,
--    and remember counters reset with the stats, so judge over a real interval.
select
  s.relname     as table_name,
  s.indexrelname as index_name,
  pg_size_pretty(pg_relation_size(s.indexrelid)) as size,
  s.idx_scan     as scans,
  i.indisunique  as is_unique
from pg_stat_user_indexes s
join pg_index i on i.indexrelid = s.indexrelid
where s.schemaname = 'public'
order by pg_relation_size(s.indexrelid) desc
limit 25;

-- 3. Embedding columns: current type and row counts. After migration 0037
--    every row here should read halfvec(1024).
select
  c.relname as table_name,
  format_type(a.atttypid, a.atttypmod) as embedding_type,
  c.reltuples::bigint as approx_rows
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and a.attname = 'embedding' and not a.attisdropped
order by c.relname;

-- 4. Whole database, and how much of the free plan's 500 MB it uses.
select
  pg_size_pretty(pg_database_size(current_database())) as database_size,
  round(100.0 * pg_database_size(current_database()) / (500 * 1024 * 1024), 1) as pct_of_500mb;

-- 5. Dead rows waiting on a vacuum. A table rewrite or a big DELETE leaves
--    these behind; high n_dead_tup means space a plain VACUUM can reuse but
--    only VACUUM FULL returns to the filesystem.
select
  relname as table_name,
  n_live_tup as live_rows,
  n_dead_tup as dead_rows,
  last_vacuum,
  last_autovacuum
from pg_stat_user_tables
where n_dead_tup > 1000
order by n_dead_tup desc
limit 10;
