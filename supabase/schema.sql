-- Soundtrack to the World: accounts and sync
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.

-- Each signed-in listener's favourites, added stations and tracks heard
create table if not exists public.user_data (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  favourites  jsonb not null default '[]'::jsonb,
  my_stations jsonb not null default '[]'::jsonb,
  heard       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- Everyone can see and change only their own row
drop policy if exists "read own data" on public.user_data;
create policy "read own data" on public.user_data
  for select using (auth.uid() = user_id);

drop policy if exists "add own data" on public.user_data;
create policy "add own data" on public.user_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "change own data" on public.user_data;
create policy "change own data" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "remove own data" on public.user_data;
create policy "remove own data" on public.user_data
  for delete using (auth.uid() = user_id);

-- Pro: who has upgraded. Listeners can only READ their own entry; nobody
-- can grant themselves Pro from the app. Entries are added by the payment
-- system later (it uses the secret service key, which bypasses these rules).
create table if not exists public.pro_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  since   timestamptz not null default now(),
  source  text  -- e.g. 'lemonsqueezy', 'play', 'gift'
);

alter table public.pro_users enable row level security;

drop policy if exists "read own pro" on public.pro_users;
create policy "read own pro" on public.pro_users
  for select using (auth.uid() = user_id);

-- To give someone Pro by hand (e.g. yourself, for testing):
--   insert into public.pro_users (user_id, source)
--   select id, 'gift' from auth.users where email = 'you@example.com';
