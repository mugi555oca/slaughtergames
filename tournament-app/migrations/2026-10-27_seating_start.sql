-- Weekly-Ablauf: Start = Sitzordnung (Runde 0), Runde 1 erst nach dem Draft.
-- Seat-Push an alle Spieler, Sieger-Meldung mit langem Magic-Namen.

alter table public.tournaments add column if not exists first_round_mode text not null default 'random'
  check (first_round_mode in ('random', 'cross'));

-- Seat-Push: "Dein Seat: Platz 3 – zwischen X und Y". Aufrufbar von Mitgliedern,
-- solange das Weekly noch in der Sitzordnungs-Phase ist.
create or replace function public.notify_seating(tid uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  t record; p record; n integer; uid uuid; lft text; rgt text; cnt integer := 0;
begin
  if not public.can_edit_tournament(tid) then raise exception 'Keine Berechtigung.'; end if;
  select * into t from public.tournaments where id = tid;
  if t.current_round <> 0 then return 0; end if;
  select count(*) into n from public.players where tournament_id = tid;
  for p in select * from public.players where tournament_id = tid order by seat loop
    select pr.id into uid from public.profiles pr where pr.slug = p.slug and p.slug is not null;
    continue when uid is null;
    select public.short_player_name(id) into lft from public.players where tournament_id = tid and seat = case when p.seat = 1 then n else p.seat - 1 end;
    select public.short_player_name(id) into rgt from public.players where tournament_id = tid and seat = case when p.seat = n then 1 else p.seat + 1 end;
    perform public.notify(uid, 'rounds', 'seat', '🃏 ' || t.name || ' startet!',
      'Dein Seat: Platz ' || p.seat || ' – zwischen ' || coalesce(lft, '?') || ' und ' || coalesce(rgt, '?') || '. ' ||
      public.pick(array['Draften, Deck baun, dann geht''s los!', 'Gute Picks! 🪓', 'Nimm die Bomben, lass die Fillers.']),
      '/tournament-app/round.html?tournament=' || tid);
    cnt := cnt + 1;
  end loop;
  return cnt;
end;
$$;
grant execute on function public.notify_seating(uuid) to authenticated;

-- Runde-1-Push: kein "geht los" mehr (das war der Seat-Push)
create or replace function public.matches_notify_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tname text;
  ua uuid := public.user_of_player(new.player_a_id);
  ub uuid := public.user_of_player(new.player_b_id);
  link text := '/tournament-app/round.html?tournament=' || new.tournament_id;
  head text;
  lines text[] := array['du gegen {O} – zag eam, wo da Bartl in Most holt!', 'du gegen {O}. Gnadenlos bleiben! 🪓',
                        '{O} is dein Gegner. Mischen, ziehen, verschieren 🃏', 'gegen {O}. Ka Mitleid!', '{O} wartet scho. Hau eam weg!'];
begin
  select name into tname from public.tournaments where id = new.tournament_id;
  head := '⚔️ ' || tname || ' · Runde ' || new.round_no;
  if new.is_bye then
    perform public.notify(ua, 'rounds', 'round', head, public.pick(array[
      'Bye! Leiwand – hol da a Bier 🍺', 'Freilos. Gratispunkte und Zeit fürs Häusl 🚽', 'Bye. Schau de an, wie die anderen leiden 😎']), link);
    return new;
  end if;
  perform public.notify(ua, 'rounds', 'round', head, replace(public.pick(lines), '{O}', coalesce(public.short_player_name(new.player_b_id), '?')), link);
  perform public.notify(ub, 'rounds', 'round', head, replace(public.pick(lines), '{O}', coalesce(public.short_player_name(new.player_a_id), '?')), link);
  return new;
end;
$$;

-- Sieger-Meldung an alle: langer Magic-Name (players.name)
do $$
declare src text;
begin
  select pg_get_functiondef('public.tournaments_notify_finished()'::regprocedure) into src;
  src := replace(src, 'if r.place = 1 then winner_pid := r.pid; winner := public.short_player_name(r.pid); winner_uid := r.uid; end if;',
                      'if r.place = 1 then winner_pid := r.pid; winner := (select name from public.players where id = r.pid); winner_uid := r.uid; end if;');
  execute src;
end $$;

notify pgrst, 'reload schema';
