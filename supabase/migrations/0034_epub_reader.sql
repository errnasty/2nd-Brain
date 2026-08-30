-- ─────────────────────────────────────────────────────────────────────
-- Migration 0034 — ePub reader
--
-- Uploading an .epub already worked, but only as text: the spine was walked,
-- every tag stripped, and one flat string stored in documents.full_text. The
-- file itself was thrown away. There was nothing to page through, no chapter
-- to resume at, and no image ever survived.
--
-- This adds the three things a reader needs and the app did not have:
--
--   • book_chapters       — the spine, in order, with the character counts
--                           that make progress independent of layout.
--   • book_reading_state  — one row per reader per book: where they are, and
--                           the preferences that belong to this book rather
--                           than to the account.
--   • document_chunks.chapter_index — so retrieval can be clamped to the part
--                           of a book someone has actually read.
--
-- Plus the private `books` storage bucket the chapters and assets live in.
-- documents.storage_path already existed and was never written; it finally is.
--
-- Apply ONCE in the Supabase SQL editor (or via psql). Idempotent throughout.
-- ─────────────────────────────────────────────────────────────────────

-- 1) Chunks learn which chapter they came from.
--
--    Nullable, and null for every non-book document — a PDF has no chapters,
--    and backfilling one would be a lie. The clamp treats null as "always
--    visible", so existing documents keep answering exactly as they do today.
alter table document_chunks add column if not exists chapter_index integer;

-- Partial: only book chunks ever carry the column, and only the clamp reads it.
create index if not exists document_chunks_chapter_idx
  on document_chunks(document_id, chapter_index)
  where chapter_index is not null;

-- 2) The spine.
--
--    `idx` is spine position, which is also reading order and the only
--    identifier the reader ever uses — hrefs are not unique across a book and
--    a manifest id means nothing to a URL.
--
--    `char_count` is stored rather than derived because progress must not
--    depend on layout: a book's total length cannot change when the reader
--    picks a bigger font.
create table if not exists book_chapters (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  idx          integer not null,
  href         text not null,
  title        text,
  char_count   integer not null default 0,
  nav_level    integer not null default 1,
  created_at   timestamptz not null default now()
);

create unique index if not exists book_chapters_doc_idx_unique
  on book_chapters(document_id, idx);
create index if not exists book_chapters_user_idx on book_chapters(user_id);

-- 3) Where the reader is, and how they like this particular book to look.
--
--    The anchor is (chapter_idx, char_offset), never a page number: the same
--    book paginates differently at a different font size, on a rotated phone,
--    or in a resized window, and a page number would send the reader to the
--    wrong place every time one of those changed. A character offset into the
--    chapter's text survives all of it.
--
--    furthest_chapter_idx is deliberately separate from chapter_idx. Flipping
--    back to re-read chapter 2 must not re-hide chapter 9 from the spoiler
--    clamp — the clamp asks how far you have BEEN, not where you are.
create table if not exists book_reading_state (
  user_id              uuid not null references profiles(id) on delete cascade,
  document_id          uuid not null references documents(id) on delete cascade,
  chapter_idx          integer not null default 0,
  char_offset          integer not null default 0,
  furthest_chapter_idx integer not null default 0,
  progress_pct         real not null default 0,
  spoiler_safe         boolean not null default false,
  font_scale           real not null default 1,
  theme                text,
  updated_at           timestamptz not null default now(),
  primary key (user_id, document_id)
);

create index if not exists book_reading_state_user_idx
  on book_reading_state(user_id, updated_at desc);

-- 4) RLS. Both tables are per-user and reached only through the reader.
alter table book_chapters      enable row level security;
alter table book_reading_state enable row level security;

drop policy if exists book_chapters_owner_all on book_chapters;
create policy book_chapters_owner_all on book_chapters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists book_reading_state_owner_all on book_reading_state;
create policy book_reading_state_owner_all on book_reading_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5) Storage.
--
--    Private. Every read goes through /api/book/*, which checks ownership
--    against documents.user_id and then fetches with the service-role key, so
--    no signed URL is ever handed to a browser and there is no expiry to
--    manage. The policies below are belt-and-braces for any future path that
--    reaches the bucket with a user's own token: they scope a user to the
--    folder named after their id, which is exactly how upload lays it out
--    (books/{userId}/{docId}…).
insert into storage.buckets (id, name, public)
values ('books', 'books', false)
on conflict (id) do nothing;

drop policy if exists books_owner_read on storage.objects;
create policy books_owner_read on storage.objects
  for select using (
    bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists books_owner_write on storage.objects;
create policy books_owner_write on storage.objects
  for insert with check (
    bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists books_owner_delete on storage.objects;
create policy books_owner_delete on storage.objects
  for delete using (
    bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text
  );
