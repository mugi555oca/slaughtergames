-- Termin abgesagt / verschoben -> alle mit dabei/maybe
create or replace function public.meetups_notify_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare targets uuid[]; loc text;
begin
  select array_agg(user_id) into targets from public.meetup_votes
  where meetup_id = new.id and vote in ('in', 'maybe') and user_id <> coalesce(auth.uid(), new.created_by);
  loc := coalesce((select name from public.play_locations where id = new.location_id), 'irgendwo');
  if old.status = 'open' and new.status = 'cancelled' then
    perform public.push_only(targets, 'meetup_updates', '❌ Abgsagt: Weekly ' || public.day_label(old.date),
      public.pick(array['Wird nix mit ' || loc || '. Nächste Woche dafür doppelt so hart 🪓',
                        'Termin bei ' || loc || ' is abgsagt. Schad, Oida.']), '/termine.html?id=' || new.id, 'meetup-' || new.id);
  elsif new.status = 'open' and (old.date, old.time, old.location_id) is distinct from (new.date, new.time, new.location_id) then
    perform public.push_only(targets, 'meetup_updates', '🔁 Weekly geändert',
      'Jetzt: ' || public.day_label(new.date) || ', ' || new.time || ' bei ' || loc || '. Passt da des no?', '/termine.html?id=' || new.id, 'meetup-' || new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_meetups_notify_update on public.meetups;
create trigger trg_meetups_notify_update after update on public.meetups
for each row execute procedure public.meetups_notify_update();
