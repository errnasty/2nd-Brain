-- Fixed-window rate limiting for paid AI endpoints (ask, brief, backfill).
-- One row per (user, bucket); the app increments atomically and resets when
-- the window expires. Keeps a leaked session from running up unbounded spend.

create table if not exists rate_limits (
  user_id      uuid not null references profiles(id) on delete cascade,
  bucket       text not null,
  count        int  not null default 0,
  window_start timestamptz not null default now(),
  primary key (user_id, bucket)
);

alter table rate_limits enable row level security;

drop policy if exists rate_limits_owner_all on rate_limits;
create policy rate_limits_owner_all on rate_limits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
