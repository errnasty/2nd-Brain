-- Desktop ⇄ cloud sync support (Phase 4).
-- 1) updated_at on every synced table (LWW conflict resolution)
-- 2) sync_tombstones + AFTER DELETE triggers (delete propagation)
-- 3) BEFORE UPDATE touch triggers (bump updated_at on app writes)
-- Triggers are skipped inside a sync-apply transaction (custom GUC
-- app.sync_apply) so applying remote changes never echoes back.
-- Idempotent: safe to re-run.

alter table folders            add column if not exists updated_at timestamptz not null default now();
alter table feeds              add column if not exists updated_at timestamptz not null default now();
alter table articles           add column if not exists updated_at timestamptz not null default now();
alter table documents          add column if not exists updated_at timestamptz not null default now();
alter table document_chunks    add column if not exists updated_at timestamptz not null default now();
alter table directory_folders  add column if not exists updated_at timestamptz not null default now();
alter table tags               add column if not exists updated_at timestamptz not null default now();
alter table item_tags          add column if not exists updated_at timestamptz not null default now();

create index if not exists articles_user_updated_idx on articles (user_id, updated_at);

create table if not exists sync_tombstones (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  user_id uuid not null,
  deleted_at timestamptz not null default now()
);
create index if not exists sync_tombstones_user_deleted_idx on sync_tombstones (user_id, deleted_at);

-- Bump updated_at on UPDATE unless (a) the statement set it explicitly or
-- (b) we're applying remote rows (app.sync_apply = '1').
create or replace function sync_touch_updated_at() returns trigger as $$
begin
  if coalesce(current_setting('app.sync_apply', true), '') = '1' then
    return new;
  end if;
  -- Bump updated_at only when a MEANINGFUL column changed. Ignore embedding
  -- (excluded from sync, regenerated locally) and updated_at itself — otherwise
  -- a local embedding write marks the row dirty and it ping-pongs through sync.
  if (to_jsonb(new) - 'embedding' - 'updated_at') is distinct from (to_jsonb(old) - 'embedding' - 'updated_at') then
    new.updated_at = now();
  end if;
  return new;
end $$ language plpgsql;

-- Record a tombstone on DELETE (skipped while applying remote deletes).
-- user_id read generically: every synced table has user_id except profiles
-- (where id IS the user id).
create or replace function sync_record_tombstone() returns trigger as $$
declare uid uuid;
begin
  if coalesce(current_setting('app.sync_apply', true), '') = '1' then
    return old;
  end if;
  uid := coalesce((to_jsonb(old)->>'user_id')::uuid, (to_jsonb(old)->>'id')::uuid);
  insert into sync_tombstones (table_name, row_id, user_id)
  values (TG_TABLE_NAME, old.id, uid);
  return old;
end $$ language plpgsql;

do $$
declare
  touch_tables text[] := array[
    'profiles','folders','feeds','tags','articles','documents','document_chunks',
    'directory_folders','directory_items','item_tags','directory_flashcards'
  ];
  tomb_tables text[] := array[
    'folders','feeds','tags','articles','documents','document_chunks',
    'directory_folders','directory_items','directory_flashcards'
  ];
  t text;
begin
  foreach t in array touch_tables loop
    execute format('drop trigger if exists sync_touch on %I', t);
    execute format(
      'create trigger sync_touch before update on %I for each row execute function sync_touch_updated_at()', t);
  end loop;
  foreach t in array tomb_tables loop
    execute format('drop trigger if exists sync_tomb on %I', t);
    execute format(
      'create trigger sync_tomb after delete on %I for each row execute function sync_record_tombstone()', t);
  end loop;
end $$;
