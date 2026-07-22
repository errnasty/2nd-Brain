-- Daily Brief cache: the latest generated brief per user, so a reload or a
-- second device reuses it instead of re-paying the model. One row per user
-- (the brief is a single daily artifact) — a new generation upserts. The
-- fingerprint (unread-set hash) + prompt_hash decide whether a stored brief
-- still matches the current inputs. NOT synced to desktop (derived/transient,
-- like ai_jobs / xp_events). Idempotent; safe to re-run.

create table if not exists daily_briefs (
  user_id uuid primary key references profiles(id) on delete cascade,
  fingerprint text not null,
  prompt_hash text not null,
  content text not null,
  source_map jsonb not null default '[]'::jsonb,
  usage jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table daily_briefs enable row level security;

drop policy if exists daily_briefs_owner_all on daily_briefs;
create policy daily_briefs_owner_all on daily_briefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
