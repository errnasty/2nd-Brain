-- Trigram indexes for global search (⌘K palette, src/app/(app)/search-actions.ts).
--
-- The palette searches with `ILIKE '%query%'`, which Postgres cannot serve
-- from a btree index — without these it sequential-scans articles and
-- directory_items (including full note bodies) on every keystroke's debounce.
-- pg_trgm GIN indexes accelerate ILIKE/LIKE with leading wildcards directly:
-- no query changes are needed, the planner picks them up automatically.
--
-- Apply once per database (Supabase SQL Editor or psql). Safe to re-run.
-- Uses plain CREATE INDEX (not CONCURRENTLY) so it can run inside the SQL
-- Editor's transaction; on a large live table, run each CREATE INDEX line
-- separately with CONCURRENTLY instead.

create extension if not exists pg_trgm;

create index if not exists articles_title_trgm_idx
  on public.articles using gin (title gin_trgm_ops);

create index if not exists articles_excerpt_trgm_idx
  on public.articles using gin (excerpt gin_trgm_ops);

create index if not exists directory_items_title_trgm_idx
  on public.directory_items using gin (title gin_trgm_ops);

create index if not exists directory_items_content_trgm_idx
  on public.directory_items using gin (content gin_trgm_ops);
