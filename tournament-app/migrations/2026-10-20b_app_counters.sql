-- Alle Zaehler der App-Shell in einer Abfrage (statt ~6 einzelnen):
-- ungelesene Benachrichtigungen, ungelesene Chats, eigenes Pool-Guthaben,
-- naechster Weekly-Termin.
create or replace function public.app_counters()
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  my_slug text;
  meet jsonb;
begin
  if uid is null then return '{}'::jsonb; end if;
  select p.slug into my_slug from public.profiles p where p.id = uid;
  select jsonb_build_object('id', m.id, 'date', m.date, 'time', m.time, 'location', l.name,
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
$$;
grant execute on function public.app_counters() to authenticated;
notify pgrst, 'reload schema';
