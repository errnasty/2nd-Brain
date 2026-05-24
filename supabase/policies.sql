-- Row-Level Security policies for the Second Brain schema.
-- Apply AFTER `drizzle-kit push` has created the tables.
--
-- These policies assume Supabase Auth: `auth.uid()` resolves to the
-- authenticated user's id, and every owned row stores it in `user_id`
-- (or, for `profiles`, in `id`).

-- Helper: enable RLS on every owned table.
alter table public.profiles            enable row level security;
alter table public.folders             enable row level security;
alter table public.feeds               enable row level security;
alter table public.articles            enable row level security;
alter table public.documents           enable row level security;
alter table public.document_chunks     enable row level security;
alter table public.article_embeddings  enable row level security;
alter table public.tags                enable row level security;
alter table public.item_tags           enable row level security;

-- profiles: a user can only see/modify their own profile row.
create policy "profiles_self_select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_self_upsert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

-- Generic owner policies for the rest.
create policy "folders_owner_all" on public.folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "feeds_owner_all" on public.feeds
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "articles_owner_all" on public.articles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents_owner_all" on public.documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "document_chunks_owner_all" on public.document_chunks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "article_embeddings_owner_all" on public.article_embeddings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tags_owner_all" on public.tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "item_tags_owner_all" on public.item_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

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
