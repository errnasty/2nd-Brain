-- Speeds up the retention purge (delete old read, non-starred, non-read-later
-- articles) so cleanup doesn't scan the whole table.
create index if not exists articles_retention_idx
  on articles (read_status, created_at)
  where not starred and not read_later;
