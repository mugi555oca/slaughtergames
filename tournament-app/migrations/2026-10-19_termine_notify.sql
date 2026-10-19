-- Spiellocations, Weekly-Terminfinder und die (lustigen) Benachrichtigungen.
-- Idempotent.

create extension if not exists pg_cron;

-- ---------------------------------------------------------------
-- Helfer
-- ---------------------------------------------------------------
create or replace function public.pick(opts text[])
returns text language sql volatile as $$
  select opts[1 + floor(random() * cardinality(opts))::int];
$$;

create or replace function public.user_short(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(r.real_name, p.display_name, 'Wer')
  from public.profiles p left join public.roster r on r.slug = p.slug where p.id = uid;
$$;

create or replace function public.day_label(d date)
returns text language sql immutable as $$
  select (array['So','Mo','Di','Mi','Do','Fr','Sa'])[extract(dow from d)::int + 1] || ' ' || to_char(d, 'DD.MM.');
$$;

create or replace function public.eur(cents integer)
returns text language sql immutable as $$
  select replace(to_char(cents / 100.0, 'FM999999990.00'), '.', ',') || ' €';
$$;

-- ---------------------------------------------------------------
-- Einstellungen: jede Art einzeln an/aus (Standard: alles an)
-- ---------------------------------------------------------------
alter table public.notification_prefs
  add column if not exists results_all    boolean not null default true,
  add column if not exists meetups        boolean not null default true,
  add column if not exists meetup_updates boolean not null default true,
  add column if not exists reminders      boolean not null default true,
  add column if not exists blog           boolean not null default true,
  add column if not exists gallery        boolean not null default true,
  add column if not exists expenses       boolean not null default true,
  add column if not exists badges         boolean not null default true;

create or replace function public.pref_on(uid uuid, kind text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (to_jsonb(p) ->> kind)::boolean from public.notification_prefs p where p.user_id = uid), true);
$$;

-- Glocke + Push (Zeile in notifications -> Trigger schickt Push)
create or replace function public.notify(uid uuid, pref text, kind text, title text, body text, url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if uid is null or not public.pref_on(uid, pref) then return; end if;
  insert into public.notifications(user_id, kind, title, body, url) values (uid, kind, title, body, url);
end;
$$;

-- Nur Push (fuer haeufige Sachen, die die Glocke zumuellen wuerden)
create or replace function public.push_only(uids uuid[], pref text, title text, body text, url text, tag text)
returns void language plpgsql security definer set search_path = public as $$
declare targets uuid[];
begin
  select array_agg(distinct u) into targets from unnest(uids) u where u is not null and public.pref_on(u, pref);
  perform public.dispatch_push(targets, title, body, url, tag);
end;
$$;

create table if not exists public.notify_throttle (key text primary key, until timestamptz not null);
alter table public.notify_throttle enable row level security;

-- ---------------------------------------------------------------
-- Spiellocations (nur fuer Mitglieder sichtbar)
-- ---------------------------------------------------------------
create table if not exists public.play_locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  address    text not null,
  bell       text,                         -- wo anläuten / Stiege / Top
  maps_url   text,
  owner_slug text references public.roster(slug) on update cascade on delete set null,
  sort_order integer not null default 100,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists play_locations_name_key on public.play_locations(lower(name));

alter table public.play_locations enable row level security;
drop policy if exists "locations_read_member" on public.play_locations;
create policy "locations_read_member" on public.play_locations for select using (public.is_member());
drop policy if exists "locations_write_admin" on public.play_locations;
create policy "locations_write_admin" on public.play_locations for all
using (public.is_app_admin()) with check (public.is_app_admin());
drop policy if exists "locations_update_owner" on public.play_locations;
create policy "locations_update_owner" on public.play_locations for update
using (owner_slug = (select slug from public.profiles where id = auth.uid()))
with check (owner_slug = (select slug from public.profiles where id = auth.uid()));

insert into public.play_locations (name, address, bell, owner_slug, sort_order) values
  ('Slaughter Cave', 'Klosterneuburger Str. 67, 1200 Wien',  null,                          null,             10),
  ('Niki',           'Heigerleinstraße 1, 1160 Wien',        'Top 36',                      'niki',           20),
  ('Vincent',        'Heigerleinstraße 1, 1160 Wien',        'Top 33',                      'vinc',           30),
  ('Berni',          'Salierigasse 7, 1180 Wien',            'Top 4',                       'burni',          40),
  ('Frido',          'Zwinzstraße 3, 1160 Wien',             'Stiege 6, Tür 2 (3/6/2)',     'frido',          50),
  ('Bar „Salim“',    'Florianigasse 42, 1080 Wien',          null,                          null,             60),
  ('Osti',           'Gudrunstraße 92, 1100 Wien',           'Stiege 3, Tür 16, 5. Stock',  'osti',           70),
  ('Mugi',           'Cobenzlgasse 79, 1190 Wien',           'Stiege 2, Top 6',             'maugi555-gmail', 80)
on conflict (lower(name)) do nothing;

update public.play_locations
set maps_url = 'https://www.google.com/maps/search/?api=1&query=' || replace(replace(address, ' ', '+'), ',', '%2C')
where maps_url is null;

-- ---------------------------------------------------------------
-- Terminfinder
-- ---------------------------------------------------------------
create table if not exists public.meetups (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date          date not null,
  time          text not null default '19:00',
  location_id   uuid references public.play_locations(id) on delete set null,
  format_key    text,                      -- Turnierformate + 'highlander'; null = offen
  note          text check (note is null or char_length(note) <= 300),
  status        text not null default 'open' check (status in ('open', 'cancelled')),
  tournament_id uuid references public.tournaments(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_meetups_date on public.meetups(date);

create table if not exists public.meetup_votes (
  meetup_id  uuid not null references public.meetups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  vote       text not null check (vote in ('in', 'maybe', 'out')),
  updated_at timestamptz not null default now(),
  primary key (meetup_id, user_id)
);

alter table public.meetups enable row level security;
alter table public.meetup_votes enable row level security;

drop policy if exists "meetups_read" on public.meetups;
create policy "meetups_read" on public.meetups for select using (public.is_member());
drop policy if exists "meetups_insert" on public.meetups;
create policy "meetups_insert" on public.meetups for insert with check (public.is_member() and created_by = auth.uid());
drop policy if exists "meetups_update" on public.meetups;
create policy "meetups_update" on public.meetups for update
using (created_by = auth.uid() or public.is_app_admin()) with check (created_by = auth.uid() or public.is_app_admin());
drop policy if exists "meetups_delete" on public.meetups;
create policy "meetups_delete" on public.meetups for delete using (created_by = auth.uid() or public.is_app_admin());

drop policy if exists "votes_read" on public.meetup_votes;
create policy "votes_read" on public.meetup_votes for select using (public.is_member());
drop policy if exists "votes_own" on public.meetup_votes;
create policy "votes_own" on public.meetup_votes for all
using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());

do $$
declare t text;
begin
  foreach t in array array['meetups', 'meetup_votes'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Wie voll ist der Tisch? (Ziel 8, gut auch 10/12, Highlander bei 4-5)
create or replace function public.table_status(n integer)
returns text language sql immutable as $$
  select case
    when n <= 0 then 'Noch is keiner dabei.'
    when n < 4  then 'Noch ' || (4 - n) || ' bis Highländer, ' || (8 - n) || ' bis zum Draft.'
    when n <= 5 then 'Reicht für Highländer – noch ' || (8 - n) || ' für an Draft.'
    when n = 6  then 'Noch 2 für an perfekten 8er-Tisch!'
    when n = 7  then 'Nur mehr oaner fehlt für an 8er!'
    when n = 8  then 'Tisch is voll – 8 Leit, perfekt! 🎉'
    when n = 9  then 'Oida, 9 – oaner zu viel. Noch wer für 10?'
    when n = 10 then '10 Leit – passt wieder! 👌'
    when n = 11 then '11 – oaner fehlt für 12.'
    when n = 12 then '12 – volles Haus! 🔥'
    else n || ' Leit – des wird a Gmetzel.'
  end;
$$;

create or replace function public.meetups_notify_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  loc text := coalesce((select name from public.play_locations where id = new.location_id), 'irgendwo');
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
$$;
drop trigger if exists trg_meetups_notify_insert on public.meetups;
create trigger trg_meetups_notify_insert after insert on public.meetups
for each row execute procedure public.meetups_notify_insert();

create or replace function public.meetup_votes_notify()
returns trigger language plpgsql security definer set search_path = public as $$
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
  loc := coalesce((select name from public.play_locations where id = mt.location_id), 'irgendwo');
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
$$;
drop trigger if exists trg_meetup_votes_notify on public.meetup_votes;
create trigger trg_meetup_votes_notify after insert or update or delete on public.meetup_votes
for each row execute procedure public.meetup_votes_notify();

-- Erinnerung am Spieltag (pg_cron, 10:00 UTC = 11/12 Uhr Wien)
create or replace function public.meetup_reminders()
returns void language plpgsql security definer set search_path = public as $$
declare mt record; loc text; n integer; targets uuid[];
begin
  for mt in select * from public.meetups where date = (now() at time zone 'Europe/Vienna')::date and status = 'open' loop
    loc := coalesce((select name from public.play_locations where id = mt.location_id), 'irgendwo');
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
$$;

do $$
begin
  perform cron.unschedule('sg-meetup-reminders') where exists (select 1 from cron.job where jobname = 'sg-meetup-reminders');
  perform cron.schedule('sg-meetup-reminders', '0 10 * * *', 'select public.meetup_reminders()');
end $$;

-- ---------------------------------------------------------------
-- Weekly: Paarungen
-- ---------------------------------------------------------------
create or replace function public.matches_notify_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  tname text;
  ua uuid := public.user_of_player(new.player_a_id);
  ub uuid := public.user_of_player(new.player_b_id);
  link text := '/tournament-app/round.html?tournament=' || new.tournament_id;
  head text;
  msg text;
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

  msg := 'Runde ' || new.round_no || ', Tisch ' || coalesce(new.table_no::text, '?') || ': ';
  perform public.notify(ua, 'rounds', 'round', head, msg || replace(public.pick(array[
    'du gegen {O} – zag eam, wo da Bartl in Most holt!', '{O}. Gnadenlos bleiben! 🪓',
    '{O}. Mischen, ziehen, verschieren 🃏', 'gegen {O}. Ka Mitleid!']), '{O}', coalesce(public.short_player_name(new.player_b_id), '?')), link);
  perform public.notify(ub, 'rounds', 'round', head, msg || replace(public.pick(array[
    'du gegen {O} – zag eam, wo da Bartl in Most holt!', '{O}. Gnadenlos bleiben! 🪓',
    '{O}. Mischen, ziehen, verschieren 🃏', 'gegen {O}. Ka Mitleid!']), '{O}', coalesce(public.short_player_name(new.player_a_id), '?')), link);
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Weekly: Ergebnisse (Sieg / Niederlage / Remis, plus alle anderen)
-- ---------------------------------------------------------------
create or replace function public.matches_notify_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t record;
  reporter uuid := auth.uid();
  ua uuid; ub uuid;
  na text; nb text;
  w text; l text; uw uuid; ul uuid;
  s text;                 -- Ergebnis aus Sicht des Siegers
  third text;
  link text := '/tournament-app/round.html?tournament=' || new.tournament_id;
  head text;
  corrected boolean := old.result <> 'pending';
  open_left int;
  others uuid[];
begin
  if new.is_bye or new.result is not distinct from old.result or new.result in ('pending', 'BYE') then
    return new;
  end if;

  select id, name, owner_id, current_round into t from public.tournaments where id = new.tournament_id;
  ua := public.user_of_player(new.player_a_id);  ub := public.user_of_player(new.player_b_id);
  na := coalesce(public.short_player_name(new.player_a_id), '?');
  nb := coalesce(public.short_player_name(new.player_b_id), '?');
  head := (case when corrected then 'Korrigiert · ' else '' end) || t.name || ' · Runde ' || new.round_no;

  if new.result in ('2:0', '2:1', '1:0') then
    w := na; l := nb; uw := ua; ul := ub; s := new.result;
  elsif new.result in ('0:2', '1:2', '0:1') then
    w := nb; l := na; uw := ub; ul := ua; s := reverse(new.result);
  end if;

  if w is not null then
    third := replace(replace(replace(case when s = '2:0' then public.pick(array[
        '{W} verschiert {L} 2:0 💀', '{W} schickt {L} mit 2:0 ham', '{W} faltet {L} 2:0 zam',
        '2:0 – {W} hat {L} gscheit hergricht', '{L} kriegt von {W} a 2:0-Watschn 👋'])
      else public.pick(array[
        '{W} zittert si gegen {L} {S} drüber 😅', '{W} gegen {L} {S} – knapp, aber Sieg is Sieg',
        '{L} war nah dran, aber {W} holt si des {S}', '{W} gewinnt {S} gegen {L}. Schwitzig!'])
      end, '{W}', w), '{L}', l), '{S}', s);

    if uw is distinct from reporter then
      perform public.notify(uw, 'results', 'result', head || ' · Sieg 💪', replace(replace(public.pick(array[
        'Du hast {L} {S} verschiert 💀', 'Leiwand! {S} gegen {L} 🍻', 'Ois paletti: {L} {S} weggräumt 💪',
        'Gwonnen! {L} schaut blöd: {S}']), '{L}', l), '{S}', s), link);
    end if;
    if ul is distinct from reporter then
      perform public.notify(ul, 'results', 'result', head || ' · Niederlage', replace(replace(public.pick(array[
        'Autsch – {W} hat di {S} verschiert 💀', '{W} war heut z''stoak: {S}. Kopf hoch, Oida',
        'Bitter. {S} für {W}. Nächste Runde wird ois besser 🍺', '{W} hat di {S} hamgschickt. Trotzdem liab di 🫶']),
        '{W}', w), '{S}', s), link);
    end if;
  else
    third := replace(replace(case when new.result = 'ID' then public.pick(array[
        '{A} und {B} machen ID – Kuschelkurs 🤝', 'ID zwischen {A} und {B}. Ruhe und a Bier 🍺'])
      else public.pick(array[
        '{A} und {B} ' || new.result || ' – Remis, fad wia a Semmel ohne Wurscht',
        '{A} vs {B} ' || new.result || '. Kana wü verlieren, kana gwinnt'])
      end, '{A}', na), '{B}', nb);
    if ua is distinct from reporter then perform public.notify(ua, 'results', 'result', head || ' · Remis', third, link); end if;
    if ub is distinct from reporter and ub is distinct from ua then perform public.notify(ub, 'results', 'result', head || ' · Remis', third, link); end if;
  end if;

  -- Alle anderen im Weekly: nur Push, pro Turnier zusammengefasst
  select array_agg(distinct pr.id) into others
  from public.players p join public.profiles pr on pr.slug = p.slug
  where p.tournament_id = new.tournament_id and pr.id not in (coalesce(ua, gen_random_uuid()), coalesce(ub, gen_random_uuid()), coalesce(reporter, gen_random_uuid()));
  perform public.push_only(others, 'results_all', t.name || ' · Runde ' || new.round_no, third, link, 'res-' || new.tournament_id);

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
-- Weekly beendet: jeder kriegt seinen Platz
-- ---------------------------------------------------------------
create or replace function public.tournaments_notify_finished()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer;
  winner text;
  link text := '/tournament-app/round.html?tournament=' || new.id;
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
    if r.place = 1 then winner := public.short_player_name(r.pid); end if;
    if r.uid is null then continue; end if;
    perform public.notify(r.uid, 'results', 'finished', '🏁 ' || new.name || ' is vorbei',
      case
        when r.place = 1 then public.pick(array['🏆 Du hast gwonnen! Gratuliere, du Hund 🪓', '🏆 Sieg! Heut zahlst du die erste Runde 🍻'])
        when r.place = n then 'Platz ' || n || ' von ' || n || ' – die schwarze Laterne leuchtet für di 🏮'
        when r.place <= 3 then 'Platz ' || r.place || ' von ' || n || ' – stoak! ' || coalesce(winner, '?') || ' hat gwonnen.'
        else 'Platz ' || r.place || ' von ' || n || '. ' || coalesce(winner, '?') || ' hat gwonnen.'
      end, link);
  end loop;
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Blog, Galerie, Ausgaben, Abzeichen
-- ---------------------------------------------------------------
create or replace function public.blog_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare u uuid; a text := public.user_short(new.author_id);
begin
  if not new.published then return new; end if;
  for u in select id from public.profiles where slug is not null and id <> new.author_id loop
    perform public.notify(u, 'blog', 'blog', '📰 Neuer Blogartikel', a || ': „' || new.title || '“', '/post.html?id=' || new.id);
  end loop;
  return new;
end;
$$;
drop trigger if exists trg_blog_notify on public.blog_posts;
create trigger trg_blog_notify after insert on public.blog_posts for each row execute procedure public.blog_notify();

create or replace function public.gallery_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare k text := 'gal-' || new.album || '-' || coalesce(new.uploaded_by::text, 'x'); targets uuid[];
begin
  if new.uploaded_by is null then return new; end if;
  if exists (select 1 from public.notify_throttle where key = k and until > now()) then return new; end if;
  insert into public.notify_throttle(key, until) values (k, now() + interval '20 minutes')
  on conflict (key) do update set until = excluded.until;
  select array_agg(id) into targets from public.profiles where slug is not null and id <> new.uploaded_by;
  perform public.push_only(targets, 'gallery', '📸 Neue Fotos · ' || upper(new.album),
    public.user_short(new.uploaded_by) || ' hat Fotos hochgladen. Schau, wer am deppertsten dreinschaut 😂',
    '/galerie.html?album=' || new.album, k);
  return new;
end;
$$;
drop trigger if exists trg_gallery_notify on public.gallery_photos;
create trigger trg_gallery_notify after insert on public.gallery_photos for each row execute procedure public.gallery_notify();

create or replace function public.split_shares_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare e record;
begin
  select * into e from public.split_expenses where id = new.expense_id;
  if new.user_id = e.paid_by or new.share_cents = 0 then return new; end if;
  perform public.notify(new.user_id, 'expenses', 'expense', '💸 ' || public.user_short(e.paid_by) || ' hat bezahlt',
    '„' || e.description || '“ ' || public.eur(e.amount_cents) || ' – dein Anteil ' || public.eur(new.share_cents),
    '/ausgaben.html?event=' || e.event_id);
  return new;
end;
$$;
drop trigger if exists trg_split_shares_notify on public.split_shares;
create trigger trg_split_shares_notify after insert on public.split_shares for each row execute procedure public.split_shares_notify();

create or replace function public.split_payments_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.to_user, 'expenses', 'payment', '✅ Kohle is da',
    public.user_short(new.from_user) || ' hat dir ' || public.eur(new.amount_cents) || ' überwiesen.', '/ausgaben.html?event=' || new.event_id);
  if new.created_by = new.to_user then
    perform public.notify(new.from_user, 'expenses', 'payment', '✅ Abgehakt',
      public.user_short(new.to_user) || ' hat deine ' || public.eur(new.amount_cents) || ' als erhalten markiert.', '/ausgaben.html?event=' || new.event_id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_split_payments_notify on public.split_payments;
create trigger trg_split_payments_notify after insert on public.split_payments for each row execute procedure public.split_payments_notify();

create or replace function public.badges_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid := (select id from public.profiles where slug = new.slug); b record;
begin
  select * into b from public.badges where code = new.badge_code;
  perform public.notify(uid, 'badges', 'badge', '🏅 Neues Abzeichen: ' || coalesce(b.name, new.badge_code),
    coalesce(b.description, 'Verdient is verdient.') || coalesce(' (' || new.sg || ')', ''), '/player-profile.html?slug=' || new.slug);
  return new;
end;
$$;
drop trigger if exists trg_badges_notify on public.player_badges;
create trigger trg_badges_notify after insert on public.player_badges for each row execute procedure public.badges_notify();

notify pgrst, 'reload schema';
