-- Rundentimer, neue Ergebnis-Texte (ohne Tischnummer), Weekly-Sieger an alle.
-- Idempotent.

-- ---------------------------------------------------------------
-- Rundentimer
-- ---------------------------------------------------------------
alter table public.tournaments add column if not exists round_minutes integer
  check (round_minutes is null or round_minutes between 5 and 180);
alter table public.rounds add column if not exists timer_ends_at timestamptz;
alter table public.rounds add column if not exists timer_notified boolean not null default false;

alter table public.notification_prefs
  add column if not exists timer boolean not null default true,
  add column if not exists weekly_winner boolean not null default true;

-- Neue Runde -> Timer startet automatisch (Serverzeit), wenn das Weekly einen hat
create or replace function public.rounds_start_timer()
returns trigger language plpgsql security definer set search_path = public as $$
declare mins integer;
begin
  select round_minutes into mins from public.tournaments where id = new.tournament_id;
  if mins is not null and new.timer_ends_at is null then
    new.timer_ends_at := now() + make_interval(mins => mins);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_rounds_start_timer on public.rounds;
create trigger trg_rounds_start_timer before insert on public.rounds
for each row execute procedure public.rounds_start_timer();

-- Timer verstellt -> wieder benachrichtigen
create or replace function public.rounds_timer_reset()
returns trigger language plpgsql as $$
begin
  if new.timer_ends_at is distinct from old.timer_ends_at then new.timer_notified := false; end if;
  return new;
end;
$$;
drop trigger if exists trg_rounds_timer_reset on public.rounds;
create trigger trg_rounds_timer_reset before update of timer_ends_at on public.rounds
for each row execute procedure public.rounds_timer_reset();

-- Jede Minute: abgelaufene Timer -> "Zeit is aus" an alle Spieler des Weeklys
create or replace function public.round_timers_check()
returns void language plpgsql security definer set search_path = public as $$
declare r record; targets uuid[];
begin
  for r in
    select rd.id, rd.round_no, rd.tournament_id, t.name
    from public.rounds rd join public.tournaments t on t.id = rd.tournament_id
    where rd.timer_ends_at <= now() and not rd.timer_notified and t.status = 'active'
      and rd.round_no = t.current_round
  loop
    update public.rounds set timer_notified = true where id = r.id;
    select array_agg(distinct pr.id) into targets
    from public.players p join public.profiles pr on pr.slug = p.slug where p.tournament_id = r.tournament_id;
    perform public.push_only(targets, 'timer', '⏰ Zeit is aus! · ' || r.name,
      public.pick(array['Runde ' || r.round_no || ' is vorbei. Letzte Züge, dann Ergebnis eintragen!',
                        'Runde ' || r.round_no || ': Zeit! Wer jetzt no denkt, verliert 😤',
                        'Runde ' || r.round_no || ': Aus die Maus. Ergebnisse her!']),
      '/tournament-app/round.html?tournament=' || r.tournament_id, 'timer-' || r.id);
  end loop;
end;
$$;

do $$
begin
  perform cron.unschedule('sg-round-timers') where exists (select 1 from cron.job where jobname = 'sg-round-timers');
  perform cron.schedule('sg-round-timers', '* * * * *', 'select public.round_timers_check()');
end $$;

-- ---------------------------------------------------------------
-- Paarung: ohne Tischnummer
-- ---------------------------------------------------------------
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
  head := case when new.round_no = 1 then '🃏 ' || tname || ' geht los!' else tname || ' · Runde ' || new.round_no end;

  if new.is_bye then
    perform public.notify(ua, 'rounds', 'round', head, public.pick(array[
      'Runde ' || new.round_no || ': Bye! Leiwand – hol da a Bier 🍺',
      'Runde ' || new.round_no || ': Freilos. Gratispunkte und Zeit fürs Häusl 🚽',
      'Runde ' || new.round_no || ': Bye. Schau de an, wie die anderen leiden 😎']), link);
    return new;
  end if;

  perform public.notify(ua, 'rounds', 'round', head, 'Runde ' || new.round_no || ': ' ||
    replace(public.pick(lines), '{O}', coalesce(public.short_player_name(new.player_b_id), '?')), link);
  perform public.notify(ub, 'rounds', 'round', head, 'Runde ' || new.round_no || ': ' ||
    replace(public.pick(lines), '{O}', coalesce(public.short_player_name(new.player_a_id), '?')), link);
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Ergebnisse: lustige Zeile "Mugi paniert Berni 2:0 in R2"
--   Spieler des Matches -> persoenlich (Sieg/Niederlage/Remis)
--   alle anderen Spieler des Weeklys -> Push (results_all)
-- ---------------------------------------------------------------
create or replace function public.result_line(w text, l text, s text, rnd integer, final boolean)
returns text language sql volatile as $$
  select replace(replace(replace(replace(
    case
      when s = '2:0' then public.pick(array[
        '{W} paniert {L} {S} in {R}', '{W} verschiert {L} {S} in {R} 💀', '{W} faltet {L} {S} zam in {R}',
        '{W} schickt {L} {S} ham in {R}', '{L} kriegt von {W} a {S}-Watschn in {R} 👋', '{W} putzt {L} {S} weg in {R} 🧹'])
      else public.pick(array[
        '{W} zittert si mit {S} über {L} in {R} 😅', '{W} gegen {L} {S} in {R} – knapp, aber Sieg is Sieg',
        '{L} war nah dran, aber {W} holt si des {S} in {R}', '{W} schwitzt si {S} gegen {L} durch in {R} 💦'])
    end, '{W}', w), '{L}', l), '{S}', s), '{R}', case when final then 'im Finale' else 'R' || rnd end);
$$;

create or replace function public.matches_notify_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  reporter uuid := auth.uid();
  ua uuid; ub uuid; na text; nb text;
  w text; l text; uw uuid; ul uuid; s text;
  third text;
  link text := '/tournament-app/round.html?tournament=' || new.tournament_id;
  head text;
  corrected boolean := old.result <> 'pending';
  is_final boolean;
  open_left int;
  others uuid[];
begin
  if new.is_bye or new.result is not distinct from old.result or new.result in ('pending', 'BYE') then
    return new;
  end if;

  select id, name, owner_id, current_round, rounds_total into t from public.tournaments where id = new.tournament_id;
  is_final := new.round_no = t.rounds_total;
  ua := public.user_of_player(new.player_a_id);  ub := public.user_of_player(new.player_b_id);
  na := coalesce(public.short_player_name(new.player_a_id), '?');
  nb := coalesce(public.short_player_name(new.player_b_id), '?');
  head := (case when corrected then 'Korrigiert · ' else '' end) || t.name || ' · ' ||
          case when is_final then 'Finale' else 'Runde ' || new.round_no end;

  if new.result in ('2:0', '2:1', '1:0') then
    w := na; l := nb; uw := ua; ul := ub; s := new.result;
  elsif new.result in ('0:2', '1:2', '0:1') then
    w := nb; l := na; uw := ub; ul := ua; s := reverse(new.result);
  end if;

  if w is not null then
    third := public.result_line(w, l, s, new.round_no, is_final);
    if uw is distinct from reporter then
      perform public.notify(uw, 'results', 'result', head || ' · Sieg 💪', replace(replace(case when s = '2:0' then public.pick(array[
        'Du hast {L} {S} paniert 🍗', 'Ois paletti: {L} {S} weggräumt 💪', 'Gwonnen! {L} schaut blöd: {S}'])
        else public.pick(array['Knapp, aber gwonnen: {S} gegen {L} 😅', 'Zittersieg! {S} gegen {L} 💦', 'Leiwand! {S} gegen {L} 🍻']) end,
        '{L}', l), '{S}', s), link);
    end if;
    if ul is distinct from reporter then
      perform public.notify(ul, 'results', 'result', head || ' · Niederlage', replace(replace(public.pick(array[
        'Autsch – {W} hat di {S} paniert 💀', '{W} war heut z''stoak: {S}. Kopf hoch, Oida',
        'Bitter. {S} für {W}. Nächste Runde wird ois besser 🍺', '{W} hat di {S} hamgschickt. Trotzdem liab di 🫶']),
        '{W}', w), '{S}', s), link);
    end if;
  else
    third := replace(replace(case when new.result = 'ID' then public.pick(array[
        '{A} und {B} machen ID – Kuschelkurs 🤝', 'ID zwischen {A} und {B}. Ruhe und a Bier 🍺'])
      else public.pick(array[
        '{A} und {B} ' || new.result || ' – Remis, fad wia a Semmel ohne Wurscht',
        '{A} vs {B} ' || new.result || '. Kana wü verlieren, kana gwinnt'])
      end, '{A}', na), '{B}', nb) || case when is_final then ' (Finale)' else ' (R' || new.round_no || ')' end;
    if ua is distinct from reporter then perform public.notify(ua, 'results', 'result', head || ' · Remis', third, link); end if;
    if ub is distinct from reporter and ub is distinct from ua then perform public.notify(ub, 'results', 'result', head || ' · Remis', third, link); end if;
  end if;

  -- Alle anderen, die in DIESEM Weekly spielen: Push, pro Weekly zusammengefasst
  select array_agg(distinct pr.id) into others
  from public.players p join public.profiles pr on pr.slug = p.slug
  where p.tournament_id = new.tournament_id
    and pr.id not in (coalesce(ua, gen_random_uuid()), coalesce(ub, gen_random_uuid()), coalesce(reporter, gen_random_uuid()));
  perform public.push_only(others, 'results_all', t.name, third, link, 'res-' || new.tournament_id);

  if not corrected and new.round_no = t.current_round and t.owner_id is distinct from reporter then
    select count(*) into open_left from public.matches
    where tournament_id = new.tournament_id and round_no = new.round_no and result = 'pending';
    if open_left = 0 then
      perform public.notify(t.owner_id, 'results', 'round_complete', t.name || ' · Runde ' || new.round_no || ' komplett',
        public.pick(array['Alle Ergebnisse san da – auslosen, Oida!', 'Runde durch. Nächste Runde auslosen! 🎲',
                          'Ois eingetragen. Weiter geht''s!']), link);
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Weekly beendet: Platz an jeden Spieler + Sieger-Meldung an ALLE
-- ---------------------------------------------------------------
create or replace function public.tournaments_notify_finished()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer;
  winner_pid uuid;
  winner text;
  winner_uid uuid;
  fm record;
  opp text;
  s text;
  line text;
  link text := '/tournament-app/round.html?tournament=' || new.id;
  u uuid;
begin
  if not (old.status = 'active' and new.status = 'finished') then return new; end if;
  select count(*) into n from public.players where tournament_id = new.id;
  for r in
    select pr.id as uid, p.id as pid,
           row_number() over (order by s.match_points desc, s.omw desc, s.gw desc, s.ogw desc) as place
    from public.player_round_stats s
    join public.players p on p.id = s.player_id
    left join public.profiles pr on pr.slug = p.slug
    where s.tournament_id = new.id and s.round_no = new.current_round
    order by place
  loop
    if r.place = 1 then winner_pid := r.pid; winner := public.short_player_name(r.pid); winner_uid := r.uid; end if;
    if r.uid is null then continue; end if;
    perform public.notify(r.uid, 'results', 'finished', '🏁 ' || new.name || ' is vorbei',
      case
        when r.place = 1 then public.pick(array['🏆 Du hast gwonnen! Gratuliere, du Hund 🪓', '🏆 Sieg! Heut zahlst du die erste Runde 🍻'])
        when r.place = n then 'Platz ' || n || ' von ' || n || ' – die schwarze Laterne leuchtet für di 🏮'
        when r.place <= 3 then 'Platz ' || r.place || ' von ' || n || ' – stoak! ' || coalesce(winner, '?') || ' hat gwonnen.'
        else 'Platz ' || r.place || ' von ' || n || '. ' || coalesce(winner, '?') || ' hat gwonnen.'
      end, link);
  end loop;

  -- Sieger-Zeile ueber sein Finalmatch, an alle Mitglieder (ausser den Sieger)
  if winner_pid is not null then
    select * into fm from public.matches
    where tournament_id = new.id and round_no = new.current_round and (player_a_id = winner_pid or player_b_id = winner_pid) limit 1;
    if fm.is_bye then
      line := winner || ' holt si mit Freilos im Finale den Weekly-Sieg 🏆 Glück muas ma hobn';
    else
      opp := coalesce(public.short_player_name(case when fm.player_a_id = winner_pid then fm.player_b_id else fm.player_a_id end), '?');
      s := case when fm.player_a_id = winner_pid then fm.result else reverse(fm.result) end;
      line := case
        when s = '2:0' then public.pick(array[winner || ' paniert ' || opp || ' 2:0 im Finale und holt si den Weekly-Sieg 🏆',
                                              winner || ' faltet ' || opp || ' im Finale 2:0 zam – Weekly-Sieg! 🏆'])
        when s in ('2:1', '1:0') then public.pick(array[winner || ' zittert si mit ' || s || ' im Finale gegen ' || opp || ' zum Weekly-Sieg 🏆',
                                                        winner || ' schwitzt si ' || s || ' gegen ' || opp || ' zum Weekly-Sieg 💦🏆'])
        when s in ('0:2', '1:2', '0:1') then winner || ' verliert zwar das Finale gegen ' || opp || ', holt aber trotzdem den Weekly-Sieg 🏆'
        else winner || ' holt mit ' || coalesce(s, '?') || ' gegen ' || opp || ' im Finale den Weekly-Sieg 🏆'
      end;
    end if;
    for u in select id from public.profiles where slug is not null and id is distinct from winner_uid loop
      perform public.notify(u, 'weekly_winner', 'winner', '🏆 ' || new.name, line, link);
    end loop;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
