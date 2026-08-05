-- Nothing in the Daily Brief ever taught it anything. The reader could follow
-- and unfollow desks, but a desk they follow that keeps producing sections
-- they skim past stayed exactly as prominent tomorrow, and a section they
-- valued got no credit for it. A brief that leads badly led badly forever.
--
-- One row per verdict, appended rather than upserted, so the record is a
-- history and a changed mind is a new row that outweighs the old rather than
-- an edit that erases it. The application keeps it to one live verdict per
-- section per day (it deletes today's row for that section before inserting),
-- so a reader clicking twice doesn't get counted twice.
--
-- `topic_id` is the desk the verdict is about. It is nullable because the lead
-- has no single desk — a verdict there is about the brief's judgement in
-- general, which the planner reads separately from the per-desk weights.
--
-- Not synced: this is a per-account preference signal, like user_settings'
-- derived state, and it is only ever read by the server while planning.
-- Safe to re-run.

create table if not exists brief_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  section_key text not null,
  topic_id text,
  verdict text not null check (verdict in ('more', 'less')),
  created_at timestamptz not null default now()
);

-- The planner's read: this user's recent verdicts, newest first.
create index if not exists brief_feedback_user_created_idx
  on brief_feedback (user_id, created_at desc);

alter table brief_feedback enable row level security;
drop policy if exists brief_feedback_owner_all on brief_feedback;
create policy brief_feedback_owner_all on brief_feedback
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
