-- Spectator-Ansicht ohne Login lesbar machen.
--
-- ACHTUNG: Danach kann JEDER mit der Turnier-ID (und ohne Account) die
-- Turnierdaten lesen - Turniere, Spielernamen, Paarungen, Ergebnisse,
-- Gegner-Graph. Schreiben bleibt unveraendert auf Owner/Admin beschraenkt,
-- und profiles / app_admins / user_login_map bleiben komplett geschuetzt.
--
-- Rueckgaengig: die Policies unten droppen und die alten
-- "*_read_all_authenticated" aus 2026-03-16_admin_rls_and_visibility.sql
-- wieder anlegen.

-- tournaments
drop policy if exists "tournaments_read_all_authenticated" on public.tournaments;
drop policy if exists "tournaments_read_public" on public.tournaments;
create policy "tournaments_read_public"
on public.tournaments for select
using (true);

-- players
drop policy if exists "players_read_all_authenticated" on public.players;
drop policy if exists "players_read_public" on public.players;
create policy "players_read_public"
on public.players for select
using (true);

-- rounds
drop policy if exists "rounds_read_all_authenticated" on public.rounds;
drop policy if exists "rounds_read_public" on public.rounds;
create policy "rounds_read_public"
on public.rounds for select
using (true);

-- matches
drop policy if exists "matches_read_all_authenticated" on public.matches;
drop policy if exists "matches_read_public" on public.matches;
create policy "matches_read_public"
on public.matches for select
using (true);

-- player_round_stats
drop policy if exists "stats_read_all_authenticated" on public.player_round_stats;
drop policy if exists "stats_read_public" on public.player_round_stats;
create policy "stats_read_public"
on public.player_round_stats for select
using (true);

-- player_opponents
drop policy if exists "opponents_read_all_authenticated" on public.player_opponents;
drop policy if exists "opponents_read_public" on public.player_opponents;
create policy "opponents_read_public"
on public.player_opponents for select
using (true);

notify pgrst, 'reload schema';
