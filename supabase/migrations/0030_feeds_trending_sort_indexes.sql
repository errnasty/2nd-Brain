-- Switching into a busy folder or feed was slow, and got slower the bigger the
-- library grew.
--
-- The Feeds list defaults to view=unread with sort=trending (see
-- src/lib/feeds/sort.ts), so opening a folder runs:
--
--   where user_id = ? and folder_id = ? and read_status = 'unread'
--   order by trend_score desc, publish_date desc, id desc
--   limit 100
--
-- The closest existing index, articles_folder_status_pub_idx, is
-- (folder_id, read_status, publish_date desc). It serves the FILTER but not the
-- ORDER: trend_score isn't in it, so Postgres had to read every matching row
-- and sort the lot to find 100. On a folder holding 23k unread articles that is
-- a 23k-row sort on every navigation into it — paid again on each back-and-
-- forth, and it grows with the library. articles_user_trend_idx has the right
-- order but no folder/feed column, so it was no better: it walks the user's
-- whole unread set in trend order and discards everything from other folders.
--
-- These two indexes match the filter AND the sort, turning each navigation into
-- an index range scan that stops after 100 rows. id is included so the ordering
-- is a total one — the list pages with OFFSET (loadMoreArticlesAction), and a
-- non-unique sort key there can skip or repeat rows across page boundaries.
--
-- NULLS ordering is deliberate and must not be "tidied": `order by trend_score
-- desc` is NULLS FIRST in Postgres, and a plain `desc` index column is NULLS
-- FIRST too, so they match. Writing `nulls last` on either side alone would
-- make the index unusable for this sort. Unscored rows (fresh install, desktop
-- app with no trending cron) therefore sort by publish_date, exactly as before.
--
-- Plain CREATE INDEX (not CONCURRENTLY): the Supabase SQL editor wraps the
-- script in a transaction, and CONCURRENTLY cannot run inside one. A normal
-- build takes a brief lock — negligible at personal scale. IF NOT EXISTS keeps
-- it safe to re-run.

create index if not exists articles_folder_status_trend_idx
  on articles (folder_id, read_status, trend_score desc, publish_date desc, id desc);

create index if not exists articles_feed_status_trend_idx
  on articles (feed_id, read_status, trend_score desc, publish_date desc, id desc);
