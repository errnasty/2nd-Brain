-- ─────────────────────────────────────────────────────────────────────
-- Migration 0035 — the book's own contents, and finishing a book
--
-- 0034 stored the spine and nothing else, and the reader showed the spine as
-- if it were a table of contents. It is not. The spine is reading order —
-- every file in the book, cover and copyright page included, in the order the
-- pages turn. The nav is what the author decided the contents are: its own
-- order, its own nesting, and entries that routinely point at an anchor inside
-- a file rather than at the file itself. Rendering one as the other produced a
-- list with "Chapter 1" twice, sections detached from their chapters, and
-- front matter numbered as if it were content.
--
-- So the nav is stored as itself. book_chapters stays exactly as it was: it is
-- the addressable unit the reader pages through, and nav entries point into it.
--
-- Also adds finished_at, so a book can be marked read.
--
-- Apply ONCE in the Supabase SQL editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────

-- 1) The contents tree.
--
--    `idx` is position in the nav, which is the order it must be displayed in —
--    NOT spine order, which is what made the old list look shuffled.
--    `chapter_idx` is the spine entry the line opens, and `fragment` the anchor
--    within it, so several lines can share one file and still land in different
--    places.
create table if not exists book_nav (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  idx         integer not null,
  title       text not null,
  level       integer not null default 1,
  chapter_idx integer not null,
  fragment    text,
  created_at  timestamptz not null default now()
);

create unique index if not exists book_nav_doc_idx_unique on book_nav(document_id, idx);
create index if not exists book_nav_user_idx on book_nav(user_id);

alter table book_nav enable row level security;

drop policy if exists book_nav_owner_all on book_nav;
create policy book_nav_owner_all on book_nav
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Finishing a book.
--
--    A timestamp rather than a boolean: "when did I read this" is worth more
--    than "did I", and it answers both. Null means unread or in progress —
--    progress_pct already says which.
alter table book_reading_state add column if not exists finished_at timestamptz;

create index if not exists book_reading_state_finished_idx
  on book_reading_state(user_id, finished_at desc)
  where finished_at is not null;
