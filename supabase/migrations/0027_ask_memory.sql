-- Ask memory: durable, user-scoped facts the assistant should remember across
-- conversations (e.g. "preparing for the CFA", "prefers concise answers").
-- Injected into the Ask/agent system prompt; the agent can add facts via its
-- `remember` tool. NOT synced (cloud-side, like ask_threads). Idempotent.

create table if not exists ask_memory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  fact text not null,
  created_at timestamptz not null default now()
);
create index if not exists ask_memory_user_idx on ask_memory (user_id, created_at desc);

alter table ask_memory enable row level security;

drop policy if exists ask_memory_owner_all on ask_memory;
create policy ask_memory_owner_all on ask_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
