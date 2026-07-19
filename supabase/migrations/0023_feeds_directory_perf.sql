-- Feeds + Directory list speed on large libraries. These are the two most
-- data-heavy screens; their hot queries had no index matching the exact
-- filter+sort shape, so big collections paid a scan-and-sort per navigation:
--
--   Feeds "All"/"Hot":   where user_id order by publish_date desc, id desc
--   Feeds "Starred":     where user_id and starred order by publish_date desc
--   Directory default:   where user_id order by updated_at desc, id desc
--   Directory folder:    where folder_id = ? order by updated_at desc
--   Directory Unsorted:  where user_id and folder_id is null order by updated_at desc
--
-- Each index below turns one of those into an index range scan + limit. The
-- (user_id, updated_at desc, id desc) composite also serves the desktop sync
-- pull ("changed since cursor") on directory_items.
--
-- Plain CREATE INDEX (not CONCURRENTLY): the Supabase SQL editor wraps the
-- script in a transaction, and CONCURRENTLY can't run inside one. A normal
-- build takes a brief lock — negligible at personal scale. IF NOT EXISTS
-- keeps it safe to re-run.

create index if not exists articles_user_pub_idx
  on articles (user_id, publish_date desc, id desc);

create index if not exists articles_user_starred_idx
  on articles (user_id, publish_date desc)
  where starred;

create index if not exists directory_items_user_updated_idx
  on directory_items (user_id, updated_at desc, id desc);

create index if not exists directory_items_folder_updated_idx
  on directory_items (folder_id, updated_at desc);

create index if not exists directory_items_unsorted_updated_idx
  on directory_items (user_id, updated_at desc)
  where folder_id is null;
