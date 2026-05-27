-- ─────────────────────────────────────────────────────────────────────
-- Migration 0002 — Directory: unified permanent-storage layer
--
-- Adds:
--   • directory_folders  — separate folder tree for the Directory tab
--                          (existing `folders` continues to be for feed folders)
--   • directory_items    — unified content: saved articles, uploaded docs,
--                          and native user notes
--   • directory_item_kind enum
--   • item_kind enum extended with 'directory_item' so item_tags can
--     reference directory items
--   • Backfill of existing documents into directory_items
--   • Row-Level Security policies for the new tables
--
-- Apply ONCE in the Supabase SQL editor (or via `psql` against your DB).
-- It is idempotent on the new objects but the documents backfill should
-- only run a single time — guarded by an `on conflict do nothing` join.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Extend item_kind enum (used by item_tags). Postgres requires ALTER TYPE.
do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'directory_item'
      and enumtypid = (select oid from pg_type where typname = 'item_kind')
  ) then
    alter type item_kind add value 'directory_item';
  end if;
end $$;

-- 2) Directory item kind enum
do $$ begin
  if not exists (select 1 from pg_type where typname = 'directory_item_kind') then
    create type directory_item_kind as enum ('saved_article', 'uploaded_document', 'user_note');
  end if;
end $$;

-- 3) directory_folders
create table if not exists directory_folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  name        text not null,
  parent_id   uuid references directory_folders(id) on delete cascade,
  position    int not null default 0,
  is_inbox    boolean not null default false,
  created_at  timestamptz not null default now()
);
create unique index if not exists directory_folders_user_name_unique on directory_folders(user_id, name);
create index if not exists directory_folders_user_idx on directory_folders(user_id);

-- 4) directory_items
create table if not exists directory_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  folder_id    uuid references directory_folders(id) on delete set null,
  kind         directory_item_kind not null,
  title        text not null,
  content      text,
  source_url   text,
  article_id   uuid references articles(id) on delete set null,
  document_id  uuid references documents(id) on delete set null,
  metadata     jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists directory_items_user_idx     on directory_items(user_id, kind, updated_at desc);
create index if not exists directory_items_folder_idx   on directory_items(folder_id);
create index if not exists directory_items_article_idx  on directory_items(article_id);
create index if not exists directory_items_document_idx on directory_items(document_id);

-- 5) RLS on the new tables
alter table directory_folders enable row level security;
alter table directory_items   enable row level security;

drop policy if exists directory_folders_owner_all on directory_folders;
create policy directory_folders_owner_all on directory_folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists directory_items_owner_all on directory_items;
create policy directory_items_owner_all on directory_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 6) Backfill: existing documents become directory_items of kind 'uploaded_document'.
--    Skips any documents that already have a corresponding directory_items row
--    (i.e. you ran this migration more than once).
insert into directory_items (user_id, folder_id, kind, title, document_id, source_url, content, metadata, created_at, updated_at)
select
  d.user_id,
  null::uuid as folder_id,                       -- documents live in old `folders`; not migrated to directory_folders
  'uploaded_document'::directory_item_kind,
  d.title,
  d.id,
  d.source_url,
  d.full_text,
  d.metadata,
  d.created_at,
  d.created_at
from documents d
where not exists (
  select 1 from directory_items di where di.document_id = d.id
);
