-- Search + indexing performance.
-- Idempotent; safe to re-run.

-- ── #7 Full-text search index for the hybrid keyword pass ──
-- A generated tsvector over title + content, with a GIN index. Turns the
-- keyword half of retrieval from an O(n) ILIKE scan into an indexed lookup.
alter table directory_items
  add column if not exists content_tsv tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored;

create index if not exists directory_items_tsv_idx
  on directory_items using gin (content_tsv);

-- ── #2 Partial indexes so backfill's "needs embedding" scans are cheap ──
-- The backfill filters rows WHERE embedding IS NULL. Partial indexes let
-- Postgres jump straight to the unembedded rows instead of scanning the table.
create index if not exists document_chunks_unembedded_idx
  on document_chunks (document_id) where embedding is null;

create index if not exists directory_items_unembedded_note_idx
  on directory_items (user_id) where kind = 'user_note' and embedding is null;
