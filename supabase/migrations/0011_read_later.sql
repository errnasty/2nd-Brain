-- "Read later" queue on articles — distinct from `starred`.
alter table articles
  add column if not exists read_later boolean not null default false;

-- Partial index: the Read Later view only ever filters read_later = true, so
-- index just those rows, newest first.
create index if not exists articles_user_readlater_idx
  on articles (user_id, publish_date desc)
  where read_later;
