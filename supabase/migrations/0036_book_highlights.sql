-- ─────────────────────────────────────────────────────────────────────
-- Migration 0036 — highlights, and where they end up
--
-- A book you cannot mark up is a book you read and lose, which in a tool whose
-- whole purpose is remembering is the wrong outcome. This adds the marking-up,
-- and a way for it to leave the book: highlights roll up into an ordinary note
-- in the Directory, which means they are searchable, linkable, embeddable and
-- answerable by Ask like everything else — rather than being trapped in a
-- reader-shaped silo.
--
-- Apply ONCE in the Supabase SQL editor. Idempotent.
-- ─────────────────────────────────────────────────────────────────────

-- 1) The highlights themselves.
--
--    Anchored the same way a reading position is: a chapter, and a character
--    range within that chapter's text. Not a DOM path and not a page — both
--    move when the font size does, and a highlight that drifts is worse than
--    no highlight.
--
--    `text` is denormalised on purpose. It is what the reader actually
--    selected, and it has to survive being exported to a note, searched, and
--    read back long after — none of which should require re-resolving an
--    offset against a chapter that may have been re-ingested since.
create table if not exists book_highlights (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  document_id  uuid not null references documents(id) on delete cascade,
  chapter_idx  integer not null,
  start_offset integer not null,
  end_offset   integer not null,
  text         text not null,
  note         text,
  color        text not null default 'yellow',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The reader loads one chapter's highlights at a time, in reading order.
create index if not exists book_highlights_chapter_idx
  on book_highlights(document_id, user_id, chapter_idx, start_offset);
create index if not exists book_highlights_user_idx
  on book_highlights(user_id, created_at desc);

alter table book_highlights enable row level security;

drop policy if exists book_highlights_owner_all on book_highlights;
create policy book_highlights_owner_all on book_highlights
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Where a book's highlights get written to.
--
--    Nullable, and set the first time they are exported. Kept so a second
--    export updates the same note instead of littering the Directory with one
--    note per press. `on delete set null` because deleting that note should
--    mean "start a fresh one", not lose the highlights.
alter table book_reading_state
  add column if not exists highlights_note_id uuid references directory_items(id) on delete set null;
