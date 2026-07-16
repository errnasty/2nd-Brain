-- Quizzes: AI-generated mixed multiple-choice / open-ended question sets over
-- one or more Directory items, with scored attempt history for retakes.
-- item_ids is a jsonb array (not a join table) — there's no need to query
-- "quizzes containing item X", and the list is small/immutable after
-- generation. SYNCED to desktop. Idempotent; safe to re-run.

create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  item_ids jsonb not null default '[]'::jsonb,
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quizzes_user_updated_idx on quizzes (user_id, updated_at);

create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  quiz_id uuid not null references quizzes(id) on delete cascade,
  answers jsonb not null default '[]'::jsonb,
  score integer not null,
  total integer not null,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists quiz_attempts_quiz_idx on quiz_attempts (quiz_id, completed_at);
create index if not exists quiz_attempts_user_updated_idx on quiz_attempts (user_id, updated_at);

alter table quizzes        enable row level security;
alter table quiz_attempts  enable row level security;

drop policy if exists quizzes_owner_all on quizzes;
create policy quizzes_owner_all on quizzes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists quiz_attempts_owner_all on quiz_attempts;
create policy quiz_attempts_owner_all on quiz_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Sync triggers (functions defined in 0013). Mirrors the touch/tomb wiring.
do $$
declare
  t text;
  synced_tables text[] := array['quizzes', 'quiz_attempts'];
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
