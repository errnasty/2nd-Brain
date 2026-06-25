import { getPgliteClient } from "./index";
import { LOCAL_SCHEMA_SQL } from "./local-schema";

let bootstrapped = false;

// Always-run, idempotent sync support for the LOCAL database. Mirrors the
// cloud migration 0013: updated_at columns (upgrades local DBs created before
// sync existed), the tombstones table, conditional touch/tombstone triggers,
// plus the local-only sync_meta cursor store.
const SYNC_SUPPORT_SQL = `
alter table folders            add column if not exists updated_at timestamptz not null default now();
alter table feeds              add column if not exists updated_at timestamptz not null default now();
alter table articles           add column if not exists updated_at timestamptz not null default now();
alter table documents          add column if not exists updated_at timestamptz not null default now();
alter table document_chunks    add column if not exists updated_at timestamptz not null default now();
alter table directory_folders  add column if not exists updated_at timestamptz not null default now();
alter table tags               add column if not exists updated_at timestamptz not null default now();
alter table item_tags          add column if not exists updated_at timestamptz not null default now();

create table if not exists sync_tombstones (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid not null,
  user_id uuid not null,
  deleted_at timestamptz not null default now()
);
create index if not exists sync_tombstones_user_deleted_idx on sync_tombstones (user_id, deleted_at);

create table if not exists sync_meta (
  key text primary key,
  value text not null
);

-- Multi-device edit conflicts: a remote (cloud) edit overwrote a row that was
-- ALSO edited locally since the last sync (last-write-wins kept the newer one).
-- Local-only, never synced. The lost local version is captured so the user can
-- recover it. One active row per note (PK row_id).
create table if not exists sync_conflicts (
  row_id uuid primary key,
  table_name text not null,
  title text,
  local_content text,
  local_updated_at timestamptz,
  remote_updated_at timestamptz,
  detected_at timestamptz not null default now(),
  resolved boolean not null default false
);
create index if not exists sync_conflicts_unresolved_idx on sync_conflicts (resolved, detected_at);

create or replace function sync_touch_updated_at() returns trigger as $$
begin
  if coalesce(current_setting('app.sync_apply', true), '') = '1' then
    return new;
  end if;
  -- Bump updated_at only when a meaningful (non-embedding) column changed, so a
  -- local embedding write doesn't mark the row dirty and ping-pong through sync.
  if (to_jsonb(new) - 'embedding' - 'updated_at') is distinct from (to_jsonb(old) - 'embedding' - 'updated_at') then
    new.updated_at = now();
  end if;
  return new;
end $$ language plpgsql;

create or replace function sync_record_tombstone() returns trigger as $$
declare uid uuid;
begin
  if coalesce(current_setting('app.sync_apply', true), '') = '1' then
    return old;
  end if;
  uid := coalesce((to_jsonb(old)->>'user_id')::uuid, (to_jsonb(old)->>'id')::uuid);
  insert into sync_tombstones (table_name, row_id, user_id)
  values (TG_TABLE_NAME, old.id, uid);
  return old;
end $$ language plpgsql;

do $$
declare
  touch_tables text[] := array[
    'profiles','folders','feeds','tags','articles','documents','document_chunks',
    'directory_folders','directory_items','item_tags','directory_flashcards',
    'skills','player_profile'
  ];
  tomb_tables text[] := array[
    'folders','feeds','tags','articles','documents','document_chunks',
    'directory_folders','directory_items','directory_flashcards',
    'skills','player_profile'
  ];
  t text;
begin
  foreach t in array touch_tables loop
    execute format('drop trigger if exists sync_touch on %I', t);
    execute format(
      'create trigger sync_touch before update on %I for each row execute function sync_touch_updated_at()', t);
  end loop;
  foreach t in array tomb_tables loop
    execute format('drop trigger if exists sync_tomb on %I', t);
    execute format(
      'create trigger sync_tomb after delete on %I for each row execute function sync_record_tombstone()', t);
  end loop;
end $$;
`;

// Gamification tables — mirrors cloud migration 0016. Always-run + idempotent so
// existing local DBs gain them without a reinstall. player_profile + skills are
// synced (triggers installed by SYNC_SUPPORT_SQL via the table arrays above);
// xp_events is a local-only append-only ledger.
const GAMIFY_SQL = `
create table if not exists player_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  total_xp integer not null default 0,
  level integer not null default 1,
  streak_days integer not null default 0,
  last_active_date_key text,
  daily_xp integer not null default 0,
  daily_date_key text,
  counters jsonb not null default '{}'::jsonb,
  unlocked jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists player_profile_user_unique on player_profile (user_id);
create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  slug text not null,
  domain text not null default 'knowledge',
  emoji text,
  color text,
  xp integer not null default 0,
  level integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists skills_user_domain_slug_unique on skills (user_id, domain, slug);
create index if not exists skills_user_idx on skills (user_id);
create table if not exists xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  skill_id uuid references skills(id) on delete set null,
  source text not null,
  amount integer not null,
  ref_kind text,
  ref_id text,
  created_at timestamptz not null default now()
);
create unique index if not exists xp_events_ref_unique on xp_events (user_id, source, ref_kind, ref_id) where ref_id is not null;
create index if not exists xp_events_feed_idx on xp_events (user_id, created_at desc);
`;

// Feeds-tab perf indexes — mirrors cloud migration 0015. No CONCURRENTLY: PGlite
// is single-connection and runs these inline. create-if-not-exists = idempotent.
const PERF_INDEX_SQL = `
create index if not exists articles_feed_status_pub_idx
  on articles (feed_id, read_status, publish_date desc);
create index if not exists articles_folder_status_pub_idx
  on articles (folder_id, read_status, publish_date desc);
`;

/**
 * Create the schema in the embedded PGlite database on first desktop launch.
 * Idempotent: if the `profiles` table already exists we skip. Index/vector
 * statements that PGlite's pgvector build can't run (e.g. HNSW) are tolerated —
 * a single-user local DB works fine with a sequential vector scan.
 */
export async function ensureLocalSchema(): Promise<void> {
  if (bootstrapped) return;
  const client = getPgliteClient();
  if (!client) return; // not desktop / no local DB
  if (client.waitReady) await client.waitReady;

  // pgvector must exist before any vector(1024) column is created.
  await client.exec("create extension if not exists vector;");

  const existing = (await client.query(
    "select to_regclass('public.profiles') as t",
  )) as { rows: { t: string | null }[] };

  if (!existing.rows[0]?.t) {
    const statements = LOCAL_SCHEMA_SQL.split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const stmt of statements) {
      try {
        await client.exec(stmt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Non-fatal: an index (incl. HNSW vector index) PGlite can't build, or an
        // object that already exists. Everything else is a real schema error.
        if (/already exists/i.test(msg) || /\bcreate\s+index\b/i.test(stmt) || /hnsw/i.test(stmt)) {
          console.warn("[local-bootstrap] skipped statement:", msg);
          continue;
        }
        throw err;
      }
    }
  }

  // Always run BEFORE sync support: the gamification tables must exist before
  // SYNC_SUPPORT_SQL installs sync_touch/sync_tomb triggers on skills +
  // player_profile. Idempotent create-if-not-exists.
  try {
    await client.exec(GAMIFY_SQL);
  } catch (err) {
    console.warn("[local-bootstrap] gamify tables failed:", err instanceof Error ? err.message : err);
  }

  // Always run: upgrades pre-sync local DBs (adds updated_at etc.) and
  // (re)installs the sync triggers + cursor store. Fully idempotent.
  try {
    await client.exec(SYNC_SUPPORT_SQL);
  } catch (err) {
    console.warn("[local-bootstrap] sync support failed:", err instanceof Error ? err.message : err);
  }

  // Always run: feeds-tab perf indexes (mirror cloud migration 0015). Idempotent
  // create-if-not-exists so existing local DBs pick them up without a reinstall.
  try {
    await client.exec(PERF_INDEX_SQL);
  } catch (err) {
    console.warn("[local-bootstrap] perf indexes failed:", err instanceof Error ? err.message : err);
  }

  bootstrapped = true;
}
