-- Background AI jobs: transient bookkeeping for long AI work (curriculum
-- notes, gap research) run outside the request the user waits on. The client
-- creates a job, kicks a run route (response allowed to sever), and polls the
-- status — so a serverless timeout never surfaces as a false error. NOT
-- synced to desktop (like xp_events): the durable output is the Directory
-- note the job produces. Idempotent; safe to re-run.

create table if not exists ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  result_item_id uuid,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_jobs_user_created_idx on ai_jobs (user_id, created_at desc);

alter table ai_jobs enable row level security;

drop policy if exists ai_jobs_owner_all on ai_jobs;
create policy ai_jobs_owner_all on ai_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
