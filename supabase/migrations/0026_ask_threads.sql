-- Ask conversation persistence: durable chat threads + messages so the Ask tab
-- has history that survives a reload and is reachable across a user's web
-- devices (instead of the previous client-only React state). NOT synced to
-- desktop (like ai_jobs / daily_briefs) — the cloud DB is the source of truth
-- for web; desktop keeps its own. Idempotent; safe to re-run.

create table if not exists ask_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ask_threads_user_updated_idx on ask_threads (user_id, updated_at desc);

create table if not exists ask_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references ask_threads(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null,
  content text not null default '',
  sources jsonb not null default '[]'::jsonb,
  web_sources jsonb not null default '[]'::jsonb,
  usage jsonb,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists ask_messages_thread_idx on ask_messages (thread_id, created_at);

alter table ask_threads  enable row level security;
alter table ask_messages enable row level security;

drop policy if exists ask_threads_owner_all on ask_threads;
create policy ask_threads_owner_all on ask_threads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists ask_messages_owner_all on ask_messages;
create policy ask_messages_owner_all on ask_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
