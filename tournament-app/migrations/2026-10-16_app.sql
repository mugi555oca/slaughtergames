-- Slaughter Games als App: Mitgliederrechte, Chat, private Galerie,
-- Notifications (In-App + Web-Push).
--
-- Idempotent. Rechte-Modell danach:
--   * Mitglied   = eingeloggt UND Profil mit slug (vom Admin angelegt)
--   * Turniere   = Mitglieder duerfen alles, solange das Turnier 'active' ist;
--                  abgeschlossene Turniere aendert nur noch der Admin
--   * Chat       = Mitglieder lesen und schreiben ueberall, loeschen eigene
--   * Galerie    = nur Mitglieder sehen/laden hoch, loeschen nur Admin
--   * Profile    = jeder sein eigenes, Admin alle
--
-- Push: Trigger schreiben in notifications bzw. rufen dispatch_push(); das
-- schickt per pg_net an die Edge Function "push". URL und Secret liegen im
-- Vault ('push_hook_url', 'push_hook_secret') - fehlen sie, passiert nichts.

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------
-- Mitgliedschaft
-- ---------------------------------------------------------------
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.slug is not null)
    or public.is_app_admin()
  );
$$;

-- ---------------------------------------------------------------
-- Turnierspieler mit Profil verknuepfen (ueber den SG-Namen im Stamm)
-- ---------------------------------------------------------------
alter table public.players add column if not exists slug text;

create or replace function public.players_set_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.slug := (select r.slug from public.roster r where lower(r.name) = lower(new.name) limit 1);
  return new;
end;
$$;

drop trigger if exists trg_players_set_slug on public.players;
create trigger trg_players_set_slug
before insert or update of name on public.players
for each row execute procedure public.players_set_slug();

update public.players p
set slug = r.slug
from public.roster r
where lower(r.name) = lower(p.name) and p.slug is distinct from r.slug;

create index if not exists idx_players_slug on public.players(slug);

-- Wer hat das Ergebnis eingetragen?
alter table public.matches add column if not exists reported_by uuid references auth.users(id) on delete set null;

create or replace function public.matches_stamp_reporter()
returns trigger
language plpgsql
as $$
begin
  if new.result is distinct from old.result then
    new.reported_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_matches_stamp_reporter on public.matches;
create trigger trg_matches_stamp_reporter
before update of result on public.matches
for each row execute procedure public.matches_stamp_reporter();

-- ---------------------------------------------------------------
-- Turnier-RLS: Mitglieder schreiben, solange aktiv; danach nur Admin
-- ---------------------------------------------------------------
create or replace function public.can_edit_tournament(tid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_admin() or (
    public.is_member()
    and exists (select 1 from public.tournaments t where t.id = tid and t.status = 'active')
  );
$$;

drop policy if exists "tournaments_insert_owner_or_admin" on public.tournaments;
drop policy if exists "tournaments_update_owner_or_admin" on public.tournaments;
drop policy if exists "tournaments_delete_owner_or_admin" on public.tournaments;
drop policy if exists "tournaments_insert_member" on public.tournaments;
drop policy if exists "tournaments_update_member" on public.tournaments;
drop policy if exists "tournaments_delete_admin_or_owner_active" on public.tournaments;

create policy "tournaments_insert_member"
on public.tournaments for insert
with check (public.is_member() and owner_id = auth.uid());

-- USING prueft die ALTE Zeile: ein abgeschlossenes Turnier kann ein Mitglied
-- weder wieder oeffnen noch sonst anfassen. Abschliessen (active -> finished)
-- geht.
create policy "tournaments_update_member"
on public.tournaments for update
using (public.is_app_admin() or (public.is_member() and status = 'active'))
with check (public.is_app_admin() or public.is_member());

create policy "tournaments_delete_admin_or_owner_active"
on public.tournaments for delete
using (public.is_app_admin() or (owner_id = auth.uid() and status = 'active'));

do $$
declare
  t text;
  pol text;
begin
  foreach t in array array['players','rounds','matches','player_round_stats','player_opponents'] loop
    pol := case t
      when 'players' then 'players_write_owner_or_admin'
      when 'rounds' then 'rounds_write_owner_or_admin'
      when 'matches' then 'matches_write_owner_or_admin'
      when 'player_round_stats' then 'stats_write_owner_or_admin'
      when 'player_opponents' then 'opponents_write_owner_or_admin'
    end;
    execute format('drop policy if exists %I on public.%I', pol, t);
    execute format('drop policy if exists %I on public.%I', t || '_write_member', t);
    execute format(
      'create policy %I on public.%I for all using (public.can_edit_tournament(tournament_id)) with check (public.can_edit_tournament(tournament_id))',
      t || '_write_member', t);
  end loop;
end $$;

-- ---------------------------------------------------------------
-- Profile: Admin darf alle bearbeiten (auch den slug)
-- ---------------------------------------------------------------
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin"
on public.profiles for update
using (public.is_app_admin()) with check (public.is_app_admin());

alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.profiles_protect_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Endnutzer (auth.uid() gesetzt) duerfen den slug nicht umbiegen, ausser
  -- sie sind Admin. Service-Role und direktes SQL (uid = null) duerfen.
  if new.slug is distinct from old.slug
     and auth.uid() is not null
     and not public.is_app_admin() then
    new.slug := old.slug;
  end if;
  return new;
end;
$$;

drop policy if exists "avatars_admin_all" on storage.objects;
create policy "avatars_admin_all"
on storage.objects for all to authenticated
using (bucket_id = 'avatars' and public.is_app_admin())
with check (bucket_id = 'avatars' and public.is_app_admin());

-- ---------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------
create table if not exists public.notification_prefs (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  results     boolean not null default true,
  rounds      boolean not null default true,
  chat        boolean not null default true,
  muted_rooms text[]  not null default '{}',
  updated_at  timestamptz not null default now()
);

create table if not exists public.notifications (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null,                 -- result | round | finished | round_complete
  title      text not null,
  body       text,
  url        text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id);

alter table public.notification_prefs enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "prefs_own" on public.notification_prefs;
create policy "prefs_own" on public.notification_prefs for all
using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "notifications_read_own" on public.notifications;
create policy "notifications_read_own" on public.notifications for select
using (user_id = auth.uid());
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications for update
using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications for delete
using (user_id = auth.uid());

drop policy if exists "push_subscriptions_own" on public.push_subscriptions;
create policy "push_subscriptions_own" on public.push_subscriptions for all
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Push an die Edge Function weiterreichen. Fehlende Konfiguration = no-op,
-- damit Turniere nie an Push scheitern.
create or replace function public.dispatch_push(
  user_ids uuid[], title text, body text, url text, tag text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  hook_url text;
  hook_secret text;
begin
  if user_ids is null or cardinality(user_ids) = 0 then return; end if;
  select decrypted_secret into hook_url from vault.decrypted_secrets where name = 'push_hook_url';
  select decrypted_secret into hook_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if hook_url is null or hook_secret is null then return; end if;

  perform net.http_post(
    url := hook_url,
    body := jsonb_build_object('user_ids', user_ids, 'title', title, 'body', body, 'url', url, 'tag', tag),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', hook_secret)
  );
exception when others then
  raise warning 'dispatch_push: %', sqlerrm;
end;
$$;

revoke execute on function public.dispatch_push(uuid[], text, text, text, text) from public, anon, authenticated;

create or replace function public.notifications_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.dispatch_push(array[new.user_id], new.title, new.body, new.url, new.kind || '-' || new.id);
  return new;
end;
$$;

drop trigger if exists trg_notifications_push on public.notifications;
create trigger trg_notifications_push
after insert on public.notifications
for each row execute procedure public.notifications_push();

create or replace function public.pref_on(uid uuid, kind text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case kind
      when 'results' then p.results
      when 'rounds' then p.rounds
      when 'chat' then p.chat
    end
    from public.notification_prefs p where p.user_id = uid
  ), true);
$$;

create or replace function public.user_of_player(pid uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pr.id from public.players p join public.profiles pr on pr.slug = p.slug
  where p.id = pid and p.slug is not null limit 1;
$$;

create or replace function public.short_player_name(pid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(r.real_name, p.name)
  from public.players p left join public.roster r on r.slug = p.slug
  where p.id = pid;
$$;

-- Neue Paarung -> beide Spieler bekommen Tisch und Gegner
create or replace function public.matches_notify_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tname text;
  ua uuid := public.user_of_player(new.player_a_id);
  ub uuid := public.user_of_player(new.player_b_id);
  link text := '/tournament-app/round.html?tournament=' || new.tournament_id;
begin
  select name into tname from public.tournaments where id = new.tournament_id;

  if new.is_bye then
    if ua is not null and public.pref_on(ua, 'rounds') then
      insert into public.notifications(user_id, kind, title, body, url)
      values (ua, 'round', tname || ' – Runde ' || new.round_no, 'Du hast diese Runde ein Bye.', link);
    end if;
    return new;
  end if;

  if ua is not null and public.pref_on(ua, 'rounds') then
    insert into public.notifications(user_id, kind, title, body, url)
    values (ua, 'round', tname || ' – Runde ' || new.round_no,
            'Tisch ' || coalesce(new.table_no::text, '?') || ' gegen ' || coalesce(public.short_player_name(new.player_b_id), '?'), link);
  end if;
  if ub is not null and public.pref_on(ub, 'rounds') then
    insert into public.notifications(user_id, kind, title, body, url)
    values (ub, 'round', tname || ' – Runde ' || new.round_no,
            'Tisch ' || coalesce(new.table_no::text, '?') || ' gegen ' || coalesce(public.short_player_name(new.player_a_id), '?'), link);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_matches_notify_insert on public.matches;
create trigger trg_matches_notify_insert
after insert on public.matches
for each row execute procedure public.matches_notify_insert();

-- Ergebnis eingetragen / geaendert -> beide Spieler (ausser dem, der es
-- eingetragen hat). Runde komplett -> Turnierersteller.
create or replace function public.matches_notify_result()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  reporter uuid := auth.uid();
  ua uuid;
  ub uuid;
  line text;
  head text;
  link text := '/tournament-app/round.html?tournament=' || new.tournament_id;
  open_left int;
begin
  if new.is_bye or new.result is not distinct from old.result or new.result in ('pending', 'BYE') then
    return new;
  end if;

  select id, name, owner_id, current_round into t from public.tournaments where id = new.tournament_id;
  ua := public.user_of_player(new.player_a_id);
  ub := public.user_of_player(new.player_b_id);

  line := coalesce(public.short_player_name(new.player_a_id), '?') || ' ' || new.result || ' '
       || coalesce(public.short_player_name(new.player_b_id), '?');
  head := case when old.result = 'pending' then 'Ergebnis eingetragen' else 'Ergebnis geändert' end;

  if ua is not null and ua is distinct from reporter and public.pref_on(ua, 'results') then
    insert into public.notifications(user_id, kind, title, body, url)
    values (ua, 'result', head || ' · Runde ' || new.round_no, line, link);
  end if;
  if ub is not null and ub is distinct from reporter and ub is distinct from ua and public.pref_on(ub, 'results') then
    insert into public.notifications(user_id, kind, title, body, url)
    values (ub, 'result', head || ' · Runde ' || new.round_no, line, link);
  end if;

  if old.result = 'pending' and new.round_no = t.current_round then
    select count(*) into open_left from public.matches
    where tournament_id = new.tournament_id and round_no = new.round_no and result = 'pending';
    if open_left = 0 and t.owner_id is distinct from reporter and public.pref_on(t.owner_id, 'results') then
      insert into public.notifications(user_id, kind, title, body, url)
      values (t.owner_id, 'round_complete', t.name || ' – Runde ' || new.round_no || ' komplett',
              'Alle Ergebnisse sind da. Nächste Runde auslosen?', link);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_matches_notify_result on public.matches;
create trigger trg_matches_notify_result
after update of result on public.matches
for each row execute procedure public.matches_notify_result();

-- Turnier abgeschlossen -> alle verknuepften Teilnehmer
create or replace function public.tournaments_notify_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'active' and new.status = 'finished' then
    insert into public.notifications(user_id, kind, title, body, url)
    select distinct pr.id, 'finished', new.name || ' ist beendet', 'Endstand ansehen',
           '/tournament-app/spectator.html?tournament=' || new.id
    from public.players p join public.profiles pr on pr.slug = p.slug
    where p.tournament_id = new.id and public.pref_on(pr.id, 'results');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tournaments_notify_finished on public.tournaments;
create trigger trg_tournaments_notify_finished
after update of status on public.tournaments
for each row execute procedure public.tournaments_notify_finished();

-- ---------------------------------------------------------------
-- Chat
-- ---------------------------------------------------------------
create table if not exists public.chat_rooms (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  icon       text,                          -- Bildpfad relativ zur Seite
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.chat_rooms(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  reply_to   uuid references public.chat_messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_messages_room on public.chat_messages(room_id, created_at desc);

create table if not exists public.chat_reads (
  user_id      uuid not null references auth.users(id) on delete cascade,
  room_id      uuid not null references public.chat_rooms(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, room_id)
);

insert into public.chat_rooms (slug, name, icon, sort_order) values
  ('hot-grannies',         'Hot Grannies',                        'assets/chat/hot-grannies.webp', 10),
  ('hot-grannies-termine', 'Hot Grannies Termine',                'assets/chat/hot-grannies-termine.webp', 20),
  ('slaughter-games',      'Slaughter Games',                     'assets/chat/slaughter-games.webp', 30),
  ('sg-team-spielplan',    'SG Team Spielplan',                   'assets/chat/sg-team-spielplan.webp', 40),
  ('sg-team-essen',        'SG Team Essen',                       'assets/chat/sg-team-essen.webp', 50),
  ('sg-team-location',     'SG Team Location',                    'assets/chat/sg-team-location.webp', 60),
  ('sg-team-alk',          'SG Team Alk, Gummi & Sideevents',     'assets/chat/sg-team-alk.webp', 70)
on conflict (slug) do update set name = excluded.name, icon = excluded.icon, sort_order = excluded.sort_order;

alter table public.chat_rooms enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;

drop policy if exists "chat_rooms_read_member" on public.chat_rooms;
create policy "chat_rooms_read_member" on public.chat_rooms for select using (public.is_member());
drop policy if exists "chat_rooms_write_admin" on public.chat_rooms;
create policy "chat_rooms_write_admin" on public.chat_rooms for all
using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists "chat_messages_read_member" on public.chat_messages;
create policy "chat_messages_read_member" on public.chat_messages for select using (public.is_member());
drop policy if exists "chat_messages_insert_member" on public.chat_messages;
create policy "chat_messages_insert_member" on public.chat_messages for insert
with check (public.is_member() and user_id = auth.uid());
drop policy if exists "chat_messages_delete_own_or_admin" on public.chat_messages;
create policy "chat_messages_delete_own_or_admin" on public.chat_messages for delete
using (user_id = auth.uid() or public.is_app_admin());

drop policy if exists "chat_reads_own" on public.chat_reads;
create policy "chat_reads_own" on public.chat_reads for all
using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Raumliste mit letzter Nachricht und Ungelesen-Zaehler in einem Aufruf
create or replace function public.chat_overview()
returns table (
  id uuid, slug text, name text, icon text, sort_order integer,
  last_body text, last_user uuid, last_at timestamptz, unread bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select r.id, r.slug, r.name, r.icon, r.sort_order,
         lm.body, lm.user_id, lm.created_at,
         (select count(*) from public.chat_messages m
           where m.room_id = r.id and m.user_id <> auth.uid()
             and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz))
  from public.chat_rooms r
  left join public.chat_reads cr on cr.room_id = r.id and cr.user_id = auth.uid()
  left join lateral (
    select m.body, m.user_id, m.created_at from public.chat_messages m
    where m.room_id = r.id order by m.created_at desc limit 1
  ) lm on true
  order by r.sort_order;
$$;

-- Push fuer Chat: alle Mitglieder ausser Absender, mit Chat-Push an und
-- Raum nicht stumm. Keine Zeile in notifications (wuerde die Liste fluten).
create or replace function public.chat_messages_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  room record;
  sender text;
  targets uuid[];
begin
  select slug, name into room from public.chat_rooms where id = new.room_id;
  select coalesce(display_name, 'Jemand') into sender from public.profiles where id = new.user_id;

  select array_agg(p.id) into targets
  from public.profiles p
  left join public.notification_prefs np on np.user_id = p.id
  where p.slug is not null
    and p.id <> new.user_id
    and coalesce(np.chat, true)
    and not (room.slug = any(coalesce(np.muted_rooms, '{}')));

  perform public.dispatch_push(targets, room.name, sender || ': ' || left(new.body, 140),
                               '/chat.html?room=' || room.slug, 'chat-' || room.slug);
  return new;
end;
$$;

drop trigger if exists trg_chat_messages_push on public.chat_messages;
create trigger trg_chat_messages_push
after insert on public.chat_messages
for each row execute procedure public.chat_messages_push();

-- ---------------------------------------------------------------
-- Galerie (privat)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', false, 15728640, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.gallery_photos (
  id          uuid primary key default gen_random_uuid(),
  album       text not null,                -- 'sg1' .. 'sg7'
  path        text not null unique,         -- Objekt im Bucket gallery
  thumb_path  text,
  width       integer,
  height      integer,
  caption     text,
  sort_key    integer,                      -- Altbestand: Reihenfolge wie bisher
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_gallery_album on public.gallery_photos(album, sort_key, created_at);

alter table public.gallery_photos enable row level security;

drop policy if exists "gallery_read_member" on public.gallery_photos;
create policy "gallery_read_member" on public.gallery_photos for select using (public.is_member());
drop policy if exists "gallery_insert_member" on public.gallery_photos;
create policy "gallery_insert_member" on public.gallery_photos for insert
with check (public.is_member() and uploaded_by = auth.uid());
drop policy if exists "gallery_update_admin" on public.gallery_photos;
create policy "gallery_update_admin" on public.gallery_photos for update
using (public.is_app_admin()) with check (public.is_app_admin());
drop policy if exists "gallery_delete_admin" on public.gallery_photos;
create policy "gallery_delete_admin" on public.gallery_photos for delete
using (public.is_app_admin());

drop policy if exists "gallery_objects_read_member" on storage.objects;
create policy "gallery_objects_read_member" on storage.objects for select to authenticated
using (bucket_id = 'gallery' and public.is_member());
drop policy if exists "gallery_objects_insert_member" on storage.objects;
create policy "gallery_objects_insert_member" on storage.objects for insert to authenticated
with check (bucket_id = 'gallery' and public.is_member());
drop policy if exists "gallery_objects_delete_admin" on storage.objects;
create policy "gallery_objects_delete_admin" on storage.objects for delete to authenticated
using (bucket_id = 'gallery' and public.is_app_admin());

-- ---------------------------------------------------------------
-- Realtime: Chat live, Turniere live
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['chat_messages','matches','rounds','tournaments','notifications'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
