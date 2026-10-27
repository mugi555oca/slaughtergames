-- Terminfinder: Ersteller (und Admin) duerfen fuer andere eintragen -
-- z. B. wenn jemand per WhatsApp zu- oder absagt.
drop policy if exists "votes_by_creator" on public.meetup_votes;
create policy "votes_by_creator" on public.meetup_votes for all
  using (exists (select 1 from public.meetups mt where mt.id = meetup_id and (mt.created_by = auth.uid() or public.is_app_admin())))
  with check (exists (select 1 from public.meetups mt where mt.id = meetup_id and (mt.created_by = auth.uid() or public.is_app_admin())));

-- Push: wer eingetragen wurde, erfaehrt es auch selbst
create or replace function public.meetup_votes_notify()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v record;
  mt record;
  loc text;
  n integer;
  voter text;
  line text;
  targets uuid[];
  actor uuid := auth.uid();
  by_other boolean;
begin
  if tg_op = 'DELETE' then v := old; else v := new; end if;
  if tg_op = 'UPDATE' and new.vote = old.vote then return new; end if;
  select * into mt from public.meetups where id = v.meetup_id;
  if mt is null or mt.status <> 'open' or mt.date < current_date then return v; end if;
  loc := public.meetup_loc(mt.location_id, mt.location_text);
  select count(*) into n from public.meetup_votes where meetup_id = mt.id and vote = 'in';
  voter := public.user_short(v.user_id);
  by_other := actor is not null and actor <> v.user_id;
  line := case
    when tg_op = 'DELETE' or v.vote = 'out' then public.pick(array[voter || ' hat si abgmeldet 😢', voter || ' is raus. Schad.', voter || ' kneift 🐔'])
    when v.vote = 'maybe' then public.pick(array[voter || ' is a Vielleicht 🤷', voter || ' schaut no, ob er derf.'])
    else public.pick(array[voter || ' is dabei! 🙌', voter || ' sagt zua 💪', voter || ' kummt – Karten mischen!'])
  end;
  if by_other then line := line || ' (eingetragen von ' || public.user_short(actor) || ')'; end if;
  select array_agg(user_id) into targets from public.meetup_votes
  where meetup_id = mt.id and vote in ('in', 'maybe') and user_id <> v.user_id;
  targets := array_append(targets, mt.created_by);
  targets := array_remove(targets, v.user_id);
  if actor is not null then targets := array_remove(targets, actor); end if;
  perform public.push_only(targets, 'meetup_updates',
    public.day_label(mt.date) || ' bei ' || loc || ' · ' || n || ' dabei',
    line || ' ' || public.table_status(n), '/termine.html?id=' || mt.id, 'meetup-' || mt.id);
  if by_other then
    perform public.notify(v.user_id, 'meetup_updates', 'meetup',
      '📝 ' || public.user_short(actor) || ' hat di eingetragen',
      case when tg_op = 'DELETE' then 'Dein Eintrag für ' || public.day_label(mt.date) || ' wurde entfernt.'
           when v.vote = 'in' then 'Als dabei für ' || public.day_label(mt.date) || ', ' || mt.time || ' bei ' || loc || '. Passt ned? Einfach ändern.'
           when v.vote = 'maybe' then 'Als maybe für ' || public.day_label(mt.date) || ' bei ' || loc || '.'
           else 'Als raus für ' || public.day_label(mt.date) || ' – doch Zeit? Einfach ändern.' end,
      '/termine.html?id=' || mt.id);
  end if;
  return v;
end;
$function$;
