-- Rabbithole: recursive "select text → ask → child document" trees hanging off
-- a Directory item. Each node is one AI answer branch; parent_id is null when
-- the selection was made in the root document, otherwise it points at the node
-- whose answer the selection was made in. parent_id carries NO foreign key
-- (matching folders.parent_id) — subtree deletes happen in app code, and the
-- item_id cascade removes the whole hole when its Directory item is deleted.
-- SYNCED to desktop. Idempotent; safe to re-run.

create table if not exists rabbithole_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null references directory_items(id) on delete cascade,
  parent_id uuid,
  anchor_text text not null,
  question text not null,
  lens text,
  title text not null,
  content text not null,
  model text,
  depth integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists rabbithole_nodes_item_idx on rabbithole_nodes (item_id, created_at);
create index if not exists rabbithole_nodes_parent_idx on rabbithole_nodes (parent_id);
create index if not exists rabbithole_nodes_user_updated_idx on rabbithole_nodes (user_id, updated_at);

alter table rabbithole_nodes enable row level security;

drop policy if exists rabbithole_nodes_owner_all on rabbithole_nodes;
create policy rabbithole_nodes_owner_all on rabbithole_nodes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Sync triggers (functions defined in 0013). Mirrors the touch/tomb wiring.
do $$
declare
  t text;
  synced_tables text[] := array['rabbithole_nodes'];
begin
  foreach t in array synced_tables loop
    execute format('drop trigger if exists sync_touch on %I', t);
    execute format(
      'create trigger sync_touch before update on %I for each row execute function sync_touch_updated_at()', t);
    execute format('drop trigger if exists sync_tomb on %I', t);
    execute format(
      'create trigger sync_tomb after delete on %I for each row execute function sync_record_tombstone()', t);
  end loop;
end $$;
