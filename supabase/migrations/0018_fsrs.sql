-- FSRS scheduling state on flashcards (replaces SM-2 as the active scheduler).
-- Legacy ease/interval_days/repetitions columns stay: existing rows keep them,
-- and cards with NULL stability are seeded from them on their next review.
-- Idempotent; safe to re-run.

alter table directory_flashcards
  add column if not exists stability real,
  add column if not exists difficulty real,
  add column if not exists lapses integer not null default 0,
  add column if not exists last_reviewed_at timestamptz;

-- Leech surfacing: worst offenders per user.
create index if not exists directory_flashcards_lapses_idx
  on directory_flashcards (user_id, lapses desc);
