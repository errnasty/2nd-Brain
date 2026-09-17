-- ─────────────────────────────────────────────────────────────────────
-- Clear the retention backlog in one go.
--
-- purgeOldReadArticles (src/lib/rss/sync.ts) deletes at most 2000 articles per
-- sync run, so after the window changed — and after the fix that made it run at
-- all — catching up takes as many runs as you have batches. This does the same
-- work in one pass, so the space comes back today instead of over a week.
--
-- The predicate below is a copy of the one in purgeOldReadArticles and MUST
-- stay a copy. It deletes an article only when ALL of these hold:
--   • read or archived — unread is never touched, at any age
--   • not starred, not read-later
--   • not saved to the Directory (directory_items.article_id is ON DELETE SET
--     NULL, so deleting one would hollow the saved item out rather than remove
--     it)
--   • created more than RETENTION_DAYS ago (30 — see lib/feeds/retention.ts)
--
-- Deleting an article cascades to its article_embeddings row. Nothing else
-- depends on it: XP, levels, streaks, the stat block, achievements and the
-- Study figures are all counted as you earn them and stored on player_profile /
-- directory_*, never recounted from articles. Feed-quality scores read a window
-- clamped to the retention window, so they measure only what is kept.
--
-- Run it over psql, NOT the dashboard SQL Editor — same reason as migration
-- 0037; a large delete will outlive the api.supabase.com request:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/purge_backlog.sql
--
-- Safe to re-run, and safe to interrupt: each batch is its own transaction, so
-- stopping it half way just leaves the rest for next time.
-- ─────────────────────────────────────────────────────────────────────

set statement_timeout = 0;

-- What it is about to remove. Run this alone first if you want to look before
-- you leap — it changes nothing.
select
  count(*) as purgeable_articles,
  min(created_at)::date as oldest,
  max(created_at)::date as newest
from articles a
where a.read_status in ('read', 'archived')
  and a.starred = false
  and a.read_later = false
  and a.created_at < now() - interval '30 days'
  and not exists (select 1 from directory_items di where di.article_id = a.id);

do $$
declare
  removed   integer;
  total     bigint := 0;
begin
  loop
    delete from articles
    where id in (
      select a.id from articles a
      where a.read_status in ('read', 'archived')
        and a.starred = false
        and a.read_later = false
        and a.created_at < now() - interval '30 days'
        and not exists (select 1 from directory_items di where di.article_id = a.id)
      limit 5000
    );
    get diagnostics removed = row_count;
    exit when removed = 0;
    total := total + removed;
    raise notice 'purged % (running total %)', removed, total;
    -- Let autovacuum breathe between batches on a small instance.
    commit;
  end loop;
  raise notice 'done: % articles removed', total;
end
$$;

analyze articles;
analyze article_embeddings;

-- ─────────────────────────────────────────────────────────────────────
-- Getting the disk space back
--
-- A DELETE marks rows dead; it does not return their space to the filesystem.
-- After a large purge, run (outside any transaction):
--
--   vacuum full analyze articles;
--   vacuum full analyze article_embeddings;
--
-- Both take an ACCESS EXCLUSIVE lock and need room for a second copy of the
-- table. supabase/report_sizes.sql shows the before and after.
-- ─────────────────────────────────────────────────────────────────────
