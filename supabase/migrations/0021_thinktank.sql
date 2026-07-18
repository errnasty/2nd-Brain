-- ThinkTank: AI-generated topic-learning decks of bite-sized "idea cards"
-- (prerequisites → core → advanced), read in a swipeable reader. Cards can be
-- saved to the Directory or turned into flashcards. `pacing` is a v2 seam for
-- Imprint-style daily drip. SYNCED to desktop. Idempotent; safe to re-run.

create table if not exists thinktank_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  topic text not null,
  title text not null,
  description text,
  status text not null default 'ready',
  pacing text not null default 'free',
  last_position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists thinktank_decks_user_created_idx on thinktank_decks (user_id, created_at desc);
create index if not exists thinktank_decks_user_updated_idx on thinktank_decks (user_id, updated_at);

create table if not exists thinktank_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  deck_id uuid not null references thinktank_decks(id) on delete cascade,
  position integer not null,
  section text not null,
  title text not null,
  body text not null,
  source_refs jsonb not null default '[]'::jsonb,
  saved_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists thinktank_cards_deck_idx on thinktank_cards (deck_id, position);
create index if not exists thinktank_cards_user_updated_idx on thinktank_cards (user_id, updated_at);

alter table thinktank_decks enable row level security;
alter table thinktank_cards enable row level security;

drop policy if exists thinktank_decks_owner_all on thinktank_decks;
create policy thinktank_decks_owner_all on thinktank_decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists thinktank_cards_owner_all on thinktank_cards;
create policy thinktank_cards_owner_all on thinktank_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Sync triggers (functions defined in 0013). Mirrors the touch/tomb wiring.
do $$
declare
  t text;
  synced_tables text[] := array['thinktank_decks', 'thinktank_cards'];
begin
  foreach t in array synced_tables loop
    execute format('drop trigger if exists sync_touch on %I', t);
    execute format(
      'create trigger sync_touch before update on %I for each row execute function sync_touch_updated_at()', t);
    execute format('drop trigger if exists sync_tomb on %I', t);
    execute format(
      'create trigger sync_tomb after delete on %I for each row execute function sync_record_tombstone()', t);
  end loop;
end $$;
