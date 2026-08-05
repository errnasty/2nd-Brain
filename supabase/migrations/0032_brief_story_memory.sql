-- The Daily Brief had no memory. Every brief was generated from scratch
-- against the current unread queue, so a story running for three days was
-- introduced from zero three mornings in a row — which is the difference
-- between a summary of a pile of articles and an actual briefing.
--
-- `story_memory` is the record of what the brief has already said: an array of
-- { title, firstBriefedAt, lastBriefedAt }, matched fuzzily against today's
-- stories by title shingles (see src/lib/today/story-memory.ts) and pruned to
-- a few days. Stories are remembered by TITLE rather than by cluster id
-- because story_clusters rows are deleted and rebuilt on every trending pass —
-- a cluster id is stable for an hour, not a day.
--
-- It rides on daily_briefs rather than getting its own table because it has
-- exactly the same lifetime and cardinality as the stored brief (one row per
-- user, rewritten whenever a brief is saved), and a jsonb array of a hundred
-- short strings is far cheaper to carry there than to join.
--
-- Safe to re-run.

alter table daily_briefs
  add column if not exists story_memory jsonb not null default '[]'::jsonb;
