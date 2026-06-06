-- Phase 1: Directory reading pipeline (Kanban) + markdown task extraction.
-- Idempotent; safe to re-run.

-- ── Reading pipeline state on Directory items ──
-- Distinct from the feed-article read_status enum. Every item starts in 'inbox'.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'directory_reading_status') then
    create type directory_reading_status as enum ('inbox', 'reading', 'done', 'review');
  end if;
end $$;

alter table directory_items
  add column if not exists reading_status directory_reading_status not null default 'inbox';

create index if not exists directory_items_reading_status_idx
  on directory_items (user_id, reading_status, updated_at desc);

-- ── Materialized markdown tasks ──
-- Extracted from item content on save. line_index + raw_line let us toggle the
-- checkbox back into the source markdown safely.
create table if not exists directory_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null references directory_items(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  due_date timestamptz,
  line_index integer not null,
  raw_line text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists directory_tasks_user_idx
  on directory_tasks (user_id, done, due_date);
create index if not exists directory_tasks_item_idx
  on directory_tasks (item_id);
