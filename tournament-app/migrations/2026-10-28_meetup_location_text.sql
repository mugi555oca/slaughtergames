-- Terminfinder: Location kann auch frei eingetippt werden oder offen (TBD) bleiben.
alter table public.meetups add column if not exists location_text text;

-- Anzeigename fuer Pushes: Spiellocation, sonst Freitext, sonst TBD
create or replace function public.meetup_loc(lid uuid, ltext text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select name from public.play_locations where id = lid), nullif(trim(ltext), ''), 'TBD');
$$;

CREATE OR REPLACE FUNCTION public.meetups_notify_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  loc text := public.meetup_loc(new.location_id, new.location_text);
  who text := public.user_short(new.created_by);
  u uuid;
begin
  -- Ersteller ist automatisch dabei
  insert into public.meetup_votes(meetup_id, user_id, vote) values (new.id, new.created_by, 'in') on conflict do nothing;
  for u in select id from public.profiles where slug is not null and id <> new.created_by loop
    perform public.notify(u, 'meetups', 'meetup', '🃏 Weekly ' || public.day_label(new.date) || ' · ' || loc,
      replace(replace(replace(public.pick(array[
        '{C} ruft zum Weekly bei {L} – wer is dabei?',
        '{C} will zocken: {L}, {T}. Bist dabei oder bist a Wappla?',
        'Neuer Termin von {C}: {L} um {T}. Stimm ab, du Hackler!',
        '{C} hat Bock auf Karten. {L}, {T} – dabei, maybe oder raus?'
      ]), '{C}', who), '{L}', loc), '{T}', new.time),
      '/termine.html?id=' || new.id);
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.meetups_notify_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare targets uuid[]; loc text;
begin
  select array_agg(user_id) into targets from public.meetup_votes
  where meetup_id = new.id and vote in ('in', 'maybe') and user_id <> coalesce(auth.uid(), new.created_by);
  loc := public.meetup_loc(new.location_id, new.location_text);
  if old.status = 'open' and new.status = 'cancelled' then
    perform public.push_only(targets, 'meetup_updates', '❌ Abgsagt: Weekly ' || public.day_label(old.date),
      public.pick(array['Wird nix mit ' || loc || '. Nächste Woche dafür doppelt so hart 🪓',
                        'Termin bei ' || loc || ' is abgsagt. Schad, Oida.']), '/termine.html?id=' || new.id, 'meetup-' || new.id);
  elsif new.status = 'open' and (old.date, old.time, old.location_id, old.location_text) is distinct from (new.date, new.time, new.location_id, new.location_text) then
    perform public.push_only(targets, 'meetup_updates', '🔁 Weekly geändert',
      'Jetzt: ' || public.day_label(new.date) || ', ' || new.time || ' bei ' || loc || '. Passt da des no?', '/termine.html?id=' || new.id, 'meetup-' || new.id);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.meetup_votes_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v record;
  mt record;
  loc text;
  n integer;
  voter text;
  line text;
  targets uuid[];
begin
  if tg_op = 'DELETE' then v := old; else v := new; end if;
  if tg_op = 'UPDATE' and new.vote = old.vote then return new; end if;
  select * into mt from public.meetups where id = v.meetup_id;
  if mt is null or mt.status <> 'open' or mt.date < current_date then return v; end if;
  loc := public.meetup_loc(mt.location_id, mt.location_text);
  select count(*) into n from public.meetup_votes where meetup_id = mt.id and vote = 'in';
  voter := public.user_short(v.user_id);
  line := case
    when tg_op = 'DELETE' or v.vote = 'out' then public.pick(array[voter || ' hat si abgmeldet 😢', voter || ' is raus. Schad.', voter || ' kneift 🐔'])
    when v.vote = 'maybe' then public.pick(array[voter || ' is a Vielleicht 🤷', voter || ' schaut no, ob er derf.'])
    else public.pick(array[voter || ' is dabei! 🙌', voter || ' sagt zua 💪', voter || ' kummt – Karten mischen!'])
  end;
  select array_agg(user_id) into targets from public.meetup_votes
  where meetup_id = mt.id and vote in ('in', 'maybe') and user_id <> v.user_id;
  targets := array_append(targets, mt.created_by);
  targets := array_remove(targets, v.user_id);
  perform public.push_only(targets, 'meetup_updates',
    public.day_label(mt.date) || ' bei ' || loc || ' · ' || n || ' dabei',
    line || ' ' || public.table_status(n), '/termine.html?id=' || mt.id, 'meetup-' || mt.id);
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.meetup_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare mt record; loc text; n integer; targets uuid[];
begin
  for mt in select * from public.meetups where date = (now() at time zone 'Europe/Vienna')::date and status = 'open' loop
    loc := public.meetup_loc(mt.location_id, mt.location_text);
    select count(*) filter (where vote = 'in'), array_agg(user_id) filter (where vote in ('in', 'maybe'))
      into n, targets from public.meetup_votes where meetup_id = mt.id;
    perform public.push_only(targets, 'reminders', 'Heit is Weekly! 🃏',
      replace(replace(replace(public.pick(array[
        'Um {T} bei {L} – {N} dabei. Vergiss die Karten ned!',
        '{L}, {T}. {N} Leit san fix. Gschwind no a Bier kalt stölln 🍺',
        'Heit Abend {L} ({T}). {N} dabei – auf geht''s, verschieren!'
      ]), '{T}', mt.time), '{L}', loc), '{N}', n::text),
      '/termine.html?id=' || mt.id, 'meetup-' || mt.id);
  end loop;
end;
$function$;

-- naechster Termin in der App-Shell: auch Freitext/TBD
CREATE OR REPLACE FUNCTION public.app_counters()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  uid uuid := auth.uid();
  my_slug text;
  meet jsonb;
begin
  if uid is null then return '{}'::jsonb; end if;
  select p.slug into my_slug from public.profiles p where p.id = uid;
  select jsonb_build_object('id', m.id, 'date', m.date, 'time', m.time, 'location', coalesce(l.name, nullif(trim(m.location_text), ''), 'TBD'),
           'in', (select count(*) from public.meetup_votes v where v.meetup_id = m.id and v.vote = 'in'))
    into meet
  from public.meetups m left join public.play_locations l on l.id = m.location_id
  where m.status = 'open' and m.date >= (now() at time zone 'Europe/Vienna')::date
  order by m.date, m.time limit 1;
  return jsonb_build_object(
    'notifications', (select count(*) from public.notifications where user_id = uid and read_at is null),
    'chat_unread', (select coalesce(sum(o.unread), 0) from public.chat_overview() o),
    'pool_balance', (select public.pool_balance(a.id) from public.pool_accounts a where my_slug is not null and a.slug = my_slug limit 1),
    'next_meetup', meet);
end;
$function$;
