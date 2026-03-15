-- Slaughter Games quick repair script
-- Use this when frontend works but API says:
-- "Could not find the table 'public.tournaments' in the schema cache"

create extension if not exists pgcrypto;

-- Core tables
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  rounds_total integer not null check (rounds_total between 1 and 15),
  avoid_rematches boolean not null default true,
  allow_bye boolean not null default true,
  status text not null default 'active' check (status in ('active', 'finished')),
  current_round integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  name text not null,
  seat integer,
  dropped boolean not null default false,
  had_bye boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tournament_id, name)
);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_no integer not null check (round_no >= 1),
  generated_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique(tournament_id, round_no)
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  round_no integer not null check (round_no >= 1),
  table_no integer,
  player_a_id uuid references public.players(id) on delete set null,
  player_b_id uuid references public.players(id) on delete set null,
  is_bye boolean not null default false,
  result text not null default 'pending' check (
    result in ('pending', '2:0', '2:1', '1:2', '0:2', '1:1', '1:0', '0:1', '0:0', 'ID', 'BYE')
  ),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(round_id, table_no)
);

create table if not exists public.player_round_stats (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  round_no integer not null check (round_no >= 0),
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  game_wins integer not null default 0,
  game_losses integer not null default 0,
  game_draws integer not null default 0,
  match_points integer not null default 0,
  game_points integer not null default 0,
  omw numeric(6,5) not null default 0,
  gw numeric(6,5) not null default 0,
  ogw numeric(6,5) not null default 0,
  created_at timestamptz not null default now(),
  unique(tournament_id, player_id, round_no)
);

create table if not exists public.player_opponents (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  opponent_id uuid not null references public.players(id) on delete cascade,
  round_no integer not null check (round_no >= 1),
  created_at timestamptz not null default now(),
  unique(tournament_id, player_id, opponent_id, round_no),
  check (player_id <> opponent_id)
);

-- profile table + user creation hook
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute procedure public.handle_new_user_profile();

-- updated_at helper
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
for each row execute procedure public.touch_updated_at();

drop trigger if exists trg_tournaments_touch on public.tournaments;
create trigger trg_tournaments_touch before update on public.tournaments
for each row execute procedure public.touch_updated_at();

drop trigger if exists trg_players_touch on public.players;
create trigger trg_players_touch before update on public.players
for each row execute procedure public.touch_updated_at();

-- RLS
alter table public.profiles enable row level security;
alter table public.tournaments enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.matches enable row level security;
alter table public.player_round_stats enable row level security;
alter table public.player_opponents enable row level security;

-- reset policies safely
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "tournaments_owner_all" on public.tournaments;
drop policy if exists "players_owner_all" on public.players;
drop policy if exists "rounds_owner_all" on public.rounds;
drop policy if exists "matches_owner_all" on public.matches;
drop policy if exists "stats_owner_all" on public.player_round_stats;
drop policy if exists "opponents_owner_all" on public.player_opponents;

create policy "profiles_select_own"
on public.profiles for select
using (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles for update
using (auth.uid() = id);

create policy "tournaments_owner_all"
on public.tournaments for all
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "players_owner_all"
on public.players for all
using (
  exists (select 1 from public.tournaments t where t.id = players.tournament_id and t.owner_id = auth.uid())
)
with check (
  exists (select 1 from public.tournaments t where t.id = players.tournament_id and t.owner_id = auth.uid())
);

create policy "rounds_owner_all"
on public.rounds for all
using (
  exists (select 1 from public.tournaments t where t.id = rounds.tournament_id and t.owner_id = auth.uid())
)
with check (
  exists (select 1 from public.tournaments t where t.id = rounds.tournament_id and t.owner_id = auth.uid())
);

create policy "matches_owner_all"
on public.matches for all
using (
  exists (select 1 from public.tournaments t where t.id = matches.tournament_id and t.owner_id = auth.uid())
)
with check (
  exists (select 1 from public.tournaments t where t.id = matches.tournament_id and t.owner_id = auth.uid())
);

create policy "stats_owner_all"
on public.player_round_stats for all
using (
  exists (select 1 from public.tournaments t where t.id = player_round_stats.tournament_id and t.owner_id = auth.uid())
)
with check (
  exists (select 1 from public.tournaments t where t.id = player_round_stats.tournament_id and t.owner_id = auth.uid())
);

create policy "opponents_owner_all"
on public.player_opponents for all
using (
  exists (select 1 from public.tournaments t where t.id = player_opponents.tournament_id and t.owner_id = auth.uid())
)
with check (
  exists (select 1 from public.tournaments t where t.id = player_opponents.tournament_id and t.owner_id = auth.uid())
);

-- refresh PostgREST cache
notify pgrst, 'reload schema';
