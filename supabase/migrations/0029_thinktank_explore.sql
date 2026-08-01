-- ThinkTank: incremental deck builds + the Explore concept graph.
--
-- Idempotent; safe to re-run.

-- ── Incremental deck generation ────────────────────────────────────────
-- A deck was generated in ONE call of 30-60s (web search + a large AI
-- response). This deploys to Netlify, which kills a function at ~10s no matter
-- what the route's `maxDuration` says — so that call could never finish. The
-- deck sat on "generating" forever, the stall detector re-kicked it, and the
-- retry died exactly the same way. That is the "stuck on Building…" bug.
--
-- Generation is now plan-then-fill: one short call writes the outline, then
-- card bodies are generated in small batches across as many short requests as
-- it takes. `outline` is the plan; cards appear as their bodies land, so
-- `count(cards) < jsonb_array_length(outline)` means "still filling".
alter table thinktank_decks add column if not exists outline jsonb;
alter table thinktank_decks add column if not exists web_brief text;

-- The stepped builder inserts cards by outline position and relies on
-- ON CONFLICT DO NOTHING, so the pair has to be genuinely unique — two kicks
-- racing on the same batch must collide rather than duplicate the card.
-- De-duplicate first (older builds could not create duplicates, but a
-- half-migrated database might), then promote the index to unique.
delete from thinktank_cards c
using thinktank_cards d
where c.deck_id = d.deck_id
  and c.position = d.position
  and c.ctid > d.ctid;

drop index if exists thinktank_cards_deck_idx;
create unique index if not exists thinktank_cards_deck_position_unique
  on thinktank_cards (deck_id, position);

-- ── Explore: the concept graph ─────────────────────────────────────────
-- A deck is a bounded, ordered course. Explore is an endless graph walked by
-- curiosity: every card names a few related concepts, and tapping one
-- generates it. Cached forever per user, so re-reading a mature graph is free.
create table if not exists thinktank_concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  -- Normalized name. The UNIQUE index below is the cache key: it is what stops
  -- the same idea being generated (and paid for) twice.
  slug text not null,
  name text not null,
  topic text,
  status text not null default 'pending',
  -- The fixed four-part card. Separate columns, not one markdown blob: the
  -- format never varying is the product, and a freeform body would let it
  -- drift from card to card.
  what_is_it text,
  why_it_matters text,
  real_world_example text,
  related jsonb not null default '[]'::jsonb,
  -- Generated in the SAME call as the card, so "Test me" costs no extra tokens.
  questions jsonb not null default '[]'::jsonb,
  familiarity text,
  viewed_at timestamptz,
  view_count integer not null default 0,
  model text,
  token_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists thinktank_concepts_user_slug_unique
  on thinktank_concepts (user_id, slug);
create index if not exists thinktank_concepts_user_topic_idx
  on thinktank_concepts (user_id, topic);
create index if not exists thinktank_concepts_user_viewed_idx
  on thinktank_concepts (user_id, viewed_at desc);

alter table thinktank_concepts enable row level security;
drop policy if exists thinktank_concepts_owner_all on thinktank_concepts;
create policy thinktank_concepts_owner_all on thinktank_concepts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Saved concepts + refresher schedule ────────────────────────────────
-- Deliberately not FSRS: that scheduler needs a recall grade per review, and a
-- refresher has none. A fixed ladder (src/lib/thinktank/refresh.ts) is the
-- whole mechanism — "no complicated spaced repetition settings".
create table if not exists thinktank_saved (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  concept_id uuid not null references thinktank_concepts(id) on delete cascade,
  saved_at timestamptz not null default now(),
  last_refreshed_at timestamptz,
  next_refresher_at timestamptz not null,
  refresher_stage integer not null default 0
);

create unique index if not exists thinktank_saved_user_concept_unique
  on thinktank_saved (user_id, concept_id);
create index if not exists thinktank_saved_due_idx
  on thinktank_saved (user_id, next_refresher_at);

alter table thinktank_saved enable row level security;
drop policy if exists thinktank_saved_owner_all on thinktank_saved;
create policy thinktank_saved_owner_all on thinktank_saved
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
