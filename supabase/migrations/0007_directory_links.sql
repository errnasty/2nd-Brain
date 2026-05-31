-- Wikilinks: explicit [[Title]] note/doc → item references, with backlinks.
-- One row per directed link. Re-derived from content on every save.

create table if not exists directory_links (
  source_item_id uuid not null references directory_items(id) on delete cascade,
  target_item_id uuid not null references directory_items(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (source_item_id, target_item_id)
);

create index if not exists directory_links_target_idx on directory_links(target_item_id);
create index if not exists directory_links_user_idx on directory_links(user_id);

alter table directory_links enable row level security;

drop policy if exists directory_links_owner_all on directory_links;
create policy directory_links_owner_all on directory_links
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
