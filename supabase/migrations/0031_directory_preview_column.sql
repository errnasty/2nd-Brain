-- Opening a Directory folder for the first time was slow; opening it again was
-- fine. That gap is the shape of cold storage reads, not a missing index.
--
-- The list query built its per-row snippet with `substring(content, 1, 240)`.
-- `content` holds whole notes and document bodies, so for any sizeable item it
-- lives out-of-line in TOAST — and a SLICE of a TOASTed value still costs an
-- out-of-line fetch. Fifty rows per page meant up to fifty of those, each a
-- random read, all of them cold on the first visit and cached on the next.
-- The indexes were never the problem: the row lookup was already an index
-- range scan, and the time went into materialising the previews.
--
-- A stored generated column moves that work to write time. The value is
-- computed once per insert/update, sits inline in the main tuple, and the list
-- query reads it with no TOAST access at all. Being generated, it also cannot
-- drift from `content` the way a denormalised column maintained in app code
-- would.
--
-- The sync engine already ignores generated columns (`is_generated = 'ALWAYS'`
-- is filtered out in `sharedColumns`, src/lib/sync/engine.ts), so this needs no
-- sync change and will not be pushed between cloud and desktop.
--
-- NOTE: adding a STORED generated column rewrites the table and takes a brief
-- ACCESS EXCLUSIVE lock. At personal-library scale that is seconds. Safe to
-- re-run — `if not exists` makes it a no-op the second time.

alter table directory_items
  add column if not exists preview text
  generated always as (substring(content, 1, 240)) stored;
