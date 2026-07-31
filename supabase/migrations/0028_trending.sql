-- Trending: cross-feed story clustering + public "what's hot" signals.
--
-- Everything here is DERIVED — recomputed from `articles` and public endpoints
-- by /api/cron/trending. Nothing is user-authored, nothing is synced to
-- desktop, and every table can be truncated to force a clean recompute.
--
-- Idempotent; safe to re-run.

-- ── articles: derived trending columns ──────────────────────────────────
-- trend_score defaults to 0, so a database the cron has never touched sorts
-- entirely on the publish_date tie-break — i.e. degrades to newest-first
-- rather than to arbitrary order. Every trending query must keep that
-- tie-break for the same reason.
alter table articles add column if not exists trend_score real not null default 0;
alter table articles add column if not exists cluster_id uuid;
alter table articles add column if not exists trend_scored_at timestamptz;

-- The Feeds default view (unread, trending-first) and the brief's queue read.
create index if not exists articles_user_trend_idx
  on articles (user_id, read_status, trend_score desc, publish_date desc);
create index if not exists articles_cluster_idx on articles (cluster_id);

-- ── story_clusters: one real-world story, as your feeds told it ─────────
create table if not exists story_clusters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  url text,
  -- DISTINCT feeds, not article count: one outlet posting five times must not
  -- read as five independent sources.
  source_count integer not null default 1,
  article_count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  velocity real not null default 0,
  external_volume real not null default 0,
  personal_score real not null default 0,
  score real not null default 0,
  topic_id text,
  computed_at timestamptz not null default now()
);

create index if not exists story_clusters_user_score_idx on story_clusters (user_id, score desc);
create index if not exists story_clusters_user_seen_idx on story_clusters (user_id, last_seen desc);

alter table story_clusters enable row level security;
drop policy if exists story_clusters_owner_all on story_clusters;
create policy story_clusters_owner_all on story_clusters
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── trending_terms: public signals, fetched once for everyone ───────────
-- Global (no user_id): "what is the world talking about" has the same answer
-- for every user, so one fetch per cron run serves all of them instead of N
-- requests against the same free endpoints.
create table if not exists trending_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null,
  source text not null,
  weight real not null default 0,
  topic_id text,
  fetched_at timestamptz not null default now()
);

create unique index if not exists trending_terms_term_source_unique
  on trending_terms (term, source);
create index if not exists trending_terms_fetched_idx on trending_terms (fetched_at desc);

-- ── external_stories: what your feeds missed ────────────────────────────
create table if not exists external_stories (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  title text not null,
  outlet text,
  source text not null,
  topic_id text,
  volume real not null default 0,
  source_count integer not null default 1,
  published_at timestamptz,
  fetched_at timestamptz not null default now()
);

create unique index if not exists external_stories_url_unique on external_stories (url);
create index if not exists external_stories_fetched_idx
  on external_stories (fetched_at desc, volume desc);
create index if not exists external_stories_topic_idx on external_stories (topic_id, volume desc);

-- trending_terms and external_stories hold nothing but public headlines, but
-- RLS still goes on: Supabase exposes every public table through PostgREST
-- with the anon key, and a table without RLS is WRITABLE by anyone holding it.
-- Read-only for signed-in users; the server writes over the direct Postgres
-- role, which bypasses RLS entirely.
alter table trending_terms enable row level security;
drop policy if exists trending_terms_read on trending_terms;
create policy trending_terms_read on trending_terms
  for select using (auth.role() = 'authenticated');

alter table external_stories enable row level security;
drop policy if exists external_stories_read on external_stories;
create policy external_stories_read on external_stories
  for select using (auth.role() = 'authenticated');

-- ── trending_runs: the cron's resume cursor ─────────────────────────────
-- The cron is time-boxed (Netlify kills functions at ~10s regardless of
-- maxDuration), so it walks users oldest-run-first and stops when the budget
-- is spent. This row is where the next run picks up.
create table if not exists trending_runs (
  user_id uuid primary key references profiles(id) on delete cascade,
  last_run_at timestamptz not null default now(),
  clusters integer not null default 0,
  scored integer not null default 0
);

alter table trending_runs enable row level security;
drop policy if exists trending_runs_owner_all on trending_runs;
create policy trending_runs_owner_all on trending_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Keep the trending cron out of the sync loop ─────────────────────────
-- sync_touch_updated_at bumps articles.updated_at whenever a "meaningful"
-- column changes, and updated_at is the desktop⇄cloud sync cursor. Without
-- this, every trending run would mark EVERY article dirty and drag the whole
-- table across the wire again, hourly, forever. Same reasoning that already
-- excludes `embedding` — derived data must not look like a user edit.
create or replace function sync_touch_updated_at() returns trigger as $$
begin
  if coalesce(current_setting('app.sync_apply', true), '') = '1' then
    return new;
  end if;
  if (to_jsonb(new) - 'embedding' - 'updated_at' - 'trend_score' - 'cluster_id' - 'trend_scored_at')
     is distinct from
     (to_jsonb(old) - 'embedding' - 'updated_at' - 'trend_score' - 'cluster_id' - 'trend_scored_at') then
    new.updated_at = now();
  end if;
  return new;
end $$ language plpgsql;
