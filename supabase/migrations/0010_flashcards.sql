-- Phase 3: spaced-repetition flashcards (SM-2). Idempotent; safe to re-run.

create table if not exists directory_flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- Source item the card was generated from (nullable; item delete keeps cards).
  item_id uuid references directory_items(id) on delete set null,
  question text not null,
  answer text not null,
  -- SM-2 scheduling state.
  ease real not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  due_date timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Review queue: due cards per user, soonest first.
create index if not exists directory_flashcards_due_idx
  on directory_flashcards (user_id, due_date);
create index if not exists directory_flashcards_item_idx
  on directory_flashcards (item_id);
