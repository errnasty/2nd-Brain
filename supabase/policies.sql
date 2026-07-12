-- Row-Level Security policies for the Second Brain schema.
-- Apply AFTER `drizzle-kit push` has created the tables.
--
-- These policies assume Supabase Auth: `auth.uid()` resolves to the
-- authenticated user's id, and every owned row stores it in `user_id`
-- (or, for `profiles`, in `id`).
--
-- IMPORTANT: this file is idempotent — safe to re-run after every schema
-- change. Re-run it whenever a new user-owned table is added, because
-- Supabase exposes every table in `public` through PostgREST with the anon
-- key: a table WITHOUT RLS enabled is readable/writable by any client that
-- holds that key. (The app's own server-side Drizzle connection uses the
-- direct Postgres role and is not affected by these policies.)

-- ── Enable RLS on every owned table ─────────────────────────────────────
alter table public.profiles              enable row level security;
alter table public.folders               enable row level security;
alter table public.feeds                 enable row level security;
alter table public.articles              enable row level security;
alter table public.documents             enable row level security;
alter table public.document_chunks       enable row level security;
alter table public.article_embeddings    enable row level security;
alter table public.tags                  enable row level security;
alter table public.item_tags             enable row level security;
alter table public.directory_folders     enable row level security;
alter table public.directory_items       enable row level security;
alter table public.directory_links       enable row level security;
alter table public.directory_tasks       enable row level security;
alter table public.directory_flashcards  enable row level security;
alter table public.rabbithole_nodes      enable row level security;
alter table public.player_profile        enable row level security;
alter table public.skills                enable row level security;
alter table public.xp_events             enable row level security;
alter table public.user_settings         enable row level security;
alter table public.rate_limits           enable row level security;
alter table public.sync_tombstones       enable row level security;

-- profiles: a user can only see/modify their own profile row.
drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_self_upsert" on public.profiles;
create policy "profiles_self_upsert" on public.profiles
  for insert with check (auth.uid() = id);
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

-- Generic owner policies for every table that carries user_id.
do $$
declare
  t text;
begin
  foreach t in array array[
    'folders',
    'feeds',
    'articles',
    'documents',
    'document_chunks',
    'article_embeddings',
    'tags',
    'item_tags',
    'directory_folders',
    'directory_items',
    'directory_links',
    'directory_tasks',
    'directory_flashcards',
    'rabbithole_nodes',
    'player_profile',
    'skills',
    'xp_events',
    'user_settings',
    'rate_limits',
    'sync_tombstones'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format(
      'create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_owner_all', t
    );
  end loop;
end;
$$;

-- Auto-create a profile row on Supabase Auth signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
