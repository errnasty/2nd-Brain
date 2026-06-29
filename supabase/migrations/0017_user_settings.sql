-- User settings: a single per-user JSONB blob for UI preferences that need to
-- persist + sync (WIP limits, board filters, …). One row per user; the app
-- merges keys into `settings`. SYNCED to desktop, like player_profile.
--
-- Plain CREATE (no CONCURRENTLY) so the whole script runs in the Supabase SQL
-- editor's transaction. IF NOT EXISTS everywhere → safe to re-run.

create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists user_settings_user_unique on user_settings (user_id);

-- Sync triggers (functions defined in 0013). Mirrors the touch/tomb wiring.
do $$
declare
  t text;
  synced_tables text[] := array['user_settings'];
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
