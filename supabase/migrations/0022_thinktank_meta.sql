-- ThinkTank provenance + depth control. Adds model/token_count (cost
-- transparency — which model generated the deck, how many tokens it used) and
-- detail (brief/standard/deep — drives card count + per-card word ceiling).
-- Idempotent; safe to re-run.

alter table thinktank_decks add column if not exists model text;
alter table thinktank_decks add column if not exists token_count integer;
alter table thinktank_decks add column if not exists detail text not null default 'standard';
