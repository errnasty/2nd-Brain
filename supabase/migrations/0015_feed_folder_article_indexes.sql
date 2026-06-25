-- Feeds tab load speed: switching into a single feed or folder filters articles
-- by feed_id/folder_id + read_status and sorts by publish_date desc. The only
-- supporting index was (user_id, read_status, publish_date), so a busy feed or
-- folder forced a scan-and-refilter. These composites match the query shape
-- exactly so the switch is an index range scan + limit.
--
-- Plain CREATE INDEX (not CONCURRENTLY): the Supabase SQL editor wraps the
-- script in a transaction, and CONCURRENTLY can't run inside one. A normal
-- build takes a brief lock on `articles` — negligible at personal scale.
-- IF NOT EXISTS keeps it safe to re-run.

create index if not exists articles_feed_status_pub_idx
  on articles (feed_id, read_status, publish_date desc);

create index if not exists articles_folder_status_pub_idx
  on articles (folder_id, read_status, publish_date desc);
