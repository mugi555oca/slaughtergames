-- Weekly-Start in einem Rutsch: Turnier + Spieler (in Sitzordnung) + Termin
-- verknuepfen + Seat-Push. Vorher waren das bis zu ~12 Anfragen hintereinander,
-- am Handy mit schlechtem Netz hing das. Die id kommt vom Client, damit ein
-- zweiter Versuch nach Timeout kein doppeltes Weekly anlegt.
create or replace function public.create_weekly(
  tid uuid, tname text, rounds integer, allow_bye boolean, first_mode text,
  round_minutes integer, fmt text, edi text, seating text[], meetup uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare existing uuid;
begin
  if not public.is_member() then raise exception 'Nur Mitglieder können ein Weekly starten.'; end if;
  select id into existing from public.tournaments where id = tid;
  if existing is not null then
    if not public.can_edit_tournament(tid) then raise exception 'Keine Berechtigung.'; end if;
    return tid;                                   -- schon angelegt (zweiter Versuch)
  end if;
  if coalesce(array_length(seating, 1), 0) < 2 then raise exception 'Zu wenige Spieler.'; end if;

  insert into public.tournaments (id, owner_id, name, rounds_total, avoid_rematches, allow_bye, round_minutes,
                                  first_round_mode, current_round, status, format_key, edi_code)
  values (tid, auth.uid(), tname, rounds, true, allow_bye, round_minutes,
          case when first_mode = 'cross' then 'cross' else 'random' end, 0, 'active',
          coalesce(nullif(fmt, ''), 'other-cube'), nullif(edi, ''));

  insert into public.players (tournament_id, name, seat)
  select tid, s.name, s.seat from unnest(seating) with ordinality as s(name, seat);

  if meetup is not null then
    update public.meetups set tournament_id = tid where id = meetup and tournament_id is null;
  end if;

  perform public.notify_seating(tid);
  return tid;
end;
$$;
grant execute on function public.create_weekly(uuid, text, integer, boolean, text, integer, text, text, text[], uuid) to authenticated;
notify pgrst, 'reload schema';
