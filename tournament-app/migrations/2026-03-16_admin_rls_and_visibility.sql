-- Make all tournaments/events visible to authenticated users
-- Restrict destructive actions (delete) to admins only

create table if not exists public.app_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

drop policy if exists "app_admins_read_authenticated" on public.app_admins;
create policy "app_admins_read_authenticated"
on public.app_admins for select
using (auth.role() = 'authenticated');

-- helper to check admin by JWT email
create or replace function public.is_app_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.app_admins a
    where lower(a.email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
  );
$$;

-- seed known admin emails (adjust if needed)
insert into public.app_admins(email) values
  ('mugi@slaughtergames.local'),
  ('stephan@slaughtergames.local'),
  ('mugi555@slaughtergames.local')
on conflict (email) do nothing;

-- replace policies

drop policy if exists "tournaments_owner_all" on public.tournaments;
drop policy if exists "players_owner_all" on public.players;
drop policy if exists "rounds_owner_all" on public.rounds;
drop policy if exists "matches_owner_all" on public.matches;
drop policy if exists "stats_owner_all" on public.player_round_stats;
drop policy if exists "opponents_owner_all" on public.player_opponents;

-- tournaments
create policy "tournaments_read_all_authenticated"
on public.tournaments for select
using (auth.role() = 'authenticated');

create policy "tournaments_insert_owner_or_admin"
on public.tournaments for insert
with check (auth.uid() = owner_id or public.is_app_admin());

create policy "tournaments_update_owner_or_admin"
on public.tournaments for update
using (auth.uid() = owner_id or public.is_app_admin())
with check (auth.uid() = owner_id or public.is_app_admin());

create policy "tournaments_delete_owner_or_admin"
on public.tournaments for delete
using (auth.uid() = owner_id or public.is_app_admin());

-- players
create policy "players_read_all_authenticated"
on public.players for select
using (auth.role() = 'authenticated');

create policy "players_write_owner_or_admin"
on public.players for all
using (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = players.tournament_id and t.owner_id = auth.uid())
)
with check (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = players.tournament_id and t.owner_id = auth.uid())
);

-- rounds
create policy "rounds_read_all_authenticated"
on public.rounds for select
using (auth.role() = 'authenticated');

create policy "rounds_write_owner_or_admin"
on public.rounds for all
using (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = rounds.tournament_id and t.owner_id = auth.uid())
)
with check (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = rounds.tournament_id and t.owner_id = auth.uid())
);

-- matches
create policy "matches_read_all_authenticated"
on public.matches for select
using (auth.role() = 'authenticated');

create policy "matches_write_owner_or_admin"
on public.matches for all
using (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = matches.tournament_id and t.owner_id = auth.uid())
)
with check (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = matches.tournament_id and t.owner_id = auth.uid())
);

-- stats
create policy "stats_read_all_authenticated"
on public.player_round_stats for select
using (auth.role() = 'authenticated');

create policy "stats_write_owner_or_admin"
on public.player_round_stats for all
using (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = player_round_stats.tournament_id and t.owner_id = auth.uid())
)
with check (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = player_round_stats.tournament_id and t.owner_id = auth.uid())
);

-- opponents
create policy "opponents_read_all_authenticated"
on public.player_opponents for select
using (auth.role() = 'authenticated');

create policy "opponents_write_owner_or_admin"
on public.player_opponents for all
using (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = player_opponents.tournament_id and t.owner_id = auth.uid())
)
with check (
  public.is_app_admin() or
  exists (select 1 from public.tournaments t where t.id = player_opponents.tournament_id and t.owner_id = auth.uid())
);

notify pgrst, 'reload schema';
