-- Gamification: XP / skills / levels. Generic + domain-agnostic so a future
-- 'fitness' domain reuses the same engine. player_profile + skills SYNC to
-- desktop; xp_events is an append-only ledger (feed + idempotency), not synced.
--
-- Plain CREATE (no CONCURRENTLY) so the whole script runs in the Supabase SQL
-- editor's transaction. IF NOT EXISTS everywhere → safe to re-run.

create table if not exists player_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  total_xp integer not null default 0,
  level integer not null default 1,
  streak_days integer not null default 0,
  last_active_date_key text,
  daily_xp integer not null default 0,
  daily_date_key text,
  counters jsonb not null default '{}'::jsonb,
  unlocked jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists player_profile_user_unique on player_profile (user_id);

create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  slug text not null,
  domain text not null default 'knowledge',
  emoji text,
  color text,
  xp integer not null default 0,
  level integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists skills_user_domain_slug_unique on skills (user_id, domain, slug);
create index if not exists skills_user_idx on skills (user_id);

create table if not exists xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid references skills(id) on delete set null,
  source text not null,
  amount integer not null,
  ref_kind text,
  ref_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists xp_events_ref_unique
  on xp_events (user_id, source, ref_kind, ref_id) where ref_id is not null;
create index if not exists xp_events_feed_idx on xp_events (user_id, created_at desc);

-- Sync triggers for the two SYNCED tables (functions defined in 0013). Mirrors
-- the touch_tables / tomb_tables wiring there. xp_events is intentionally NOT
-- given triggers — it never syncs.
do $$
declare
  t text;
  synced_tables text[] := array['skills','player_profile'];
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
