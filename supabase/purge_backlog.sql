-- ─────────────────────────────────────────────────────────────────────
-- Clear the retention backlog.
--
-- purgeOldReadArticles (src/lib/rss/sync.ts) deletes at most 2000 articles per
-- sync run, so after the window changed — and after the fix that made it run at
-- all — catching up takes as many runs as you have batches. This does the same
-- work on demand, so the space comes back today instead of over a week.
--
-- HOW TO RUN IT
--   Run STEP 1 to see what is going. Then run STEP 2 over and over until it
--   reports 0. Each run is one self-contained statement and its own
--   transaction, so it works in the Supabase SQL editor as well as in psql, and
--   stopping half way just leaves the rest for next time.
--
--   (An earlier version of this file looped inside a DO block and COMMITted
--   between batches. That is only legal when nothing has already opened a
--   transaction, which is true in psql and NOT true in the Supabase SQL editor,
--   where it fails with "invalid transaction termination". Hence one statement
--   per batch and no COMMIT anywhere.)
--
-- WHAT IT DELETES — a copy of the predicate in purgeOldReadArticles, and it
-- MUST stay a copy. An article goes only when ALL of these hold:
--   • read or archived — unread is never touched, at any age
--   • not starred, not read-later
--   • not saved to the Directory (directory_items.article_id is ON DELETE SET
--     NULL, so deleting one would hollow the saved item out rather than
--     remove it)
--   • created more than 30 days ago (RETENTION_DAYS, lib/feeds/retention.ts)
--
-- Deleting an article cascades to its article_embeddings row. Nothing else
-- depends on it: XP, levels, streaks, the stat block, achievements and the
-- Study figures are counted as you earn them and stored on player_profile /
-- directory_*, never recounted from articles. Feed-quality scores read a window
-- clamped to the retention window, so they only ever measure what is kept.
-- ─────────────────────────────────────────────────────────────────────


-- ═══ STEP 1 ═══ What is about to go. Read-only; run it as often as you like.

select
  count(*)                         as purgeable_articles,
  min(a.created_at)::date          as oldest,
  max(a.created_at)::date          as newest,
  ceil(count(*) / 5000.0)::int     as step_2_runs_needed
from articles a
where a.read_status in ('read', 'archived')
  and a.starred = false
  and a.read_later = false
  and a.created_at < now() - interval '30 days'
  and not exists (select 1 from directory_items di where di.article_id = a.id);


-- ═══ STEP 2 ═══ One batch. RE-RUN THIS UNTIL IT REPORTS 0.
--
-- Returns the number of articles it removed. Lower 5000 if a run takes long
-- enough to trip a timeout; raise it if you are on psql and want fewer trips.

with purgeable as (
  select a.id
  from articles a
  where a.read_status in ('read', 'archived')
    and a.starred = false
    and a.read_later = false
    and a.created_at < now() - interval '30 days'
    and not exists (select 1 from directory_items di where di.article_id = a.id)
  limit 5000
),
deleted as (
  delete from articles where id in (select id from purgeable) returning 1
)
select count(*)::int as removed_this_run from deleted;


-- ═══ STEP 3 ═══ After the last batch.

analyze articles;
analyze article_embeddings;


-- ─────────────────────────────────────────────────────────────────────
-- Draining it in one command (psql only)
--
-- Step 2 returns a bare number, so a shell loop can drive it to completion:
--
--   while :; do
--     n=$(psql "$DATABASE_URL" -tAc "
--       with purgeable as (
--         select a.id from articles a
--         where a.read_status in ('read','archived')
--           and a.starred = false and a.read_later = false
--           and a.created_at < now() - interval '30 days'
--           and not exists (select 1 from directory_items di where di.article_id = a.id)
--         limit 5000
--       ), deleted as (
--         delete from articles where id in (select id from purgeable) returning 1
--       ) select count(*) from deleted;")
--     echo "removed $n"
--     [ "$n" -eq 0 ] && break
--   done
--
-- Getting the disk space back
--
-- A DELETE marks rows dead; it does not return their space to the filesystem.
-- Once Step 2 reports 0, run (outside any transaction, over psql — VACUUM FULL
-- cannot run in the SQL editor either):
--
--   vacuum full analyze articles;
--   vacuum full analyze article_embeddings;
--
-- Both take an ACCESS EXCLUSIVE lock and need room for a second copy of the
-- table. supabase/report_sizes.sql shows the before and after.
-- ─────────────────────────────────────────────────────────────────────
