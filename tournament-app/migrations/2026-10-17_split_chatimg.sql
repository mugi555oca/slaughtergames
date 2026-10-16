-- Chat-Bilder, Ausgaben-Splitter, Gaeste in den Weeklys zuordnen.
-- Idempotent.

-- ---------------------------------------------------------------
-- Gaeste der bisherigen Weeklys: Gast 1 = Jakob, Gast 2 = Milos
-- (Trigger trg_players_set_slug verknuepft dabei das Profil)
-- ---------------------------------------------------------------
update public.players set name = (select name from public.roster where slug = 'jakob')
where name = 'Gast 1' and exists (select 1 from public.roster where slug = 'jakob');
update public.players set name = (select name from public.roster where slug = 'milos')
where name = 'Gast 2' and exists (select 1 from public.roster where slug = 'milos');

-- ---------------------------------------------------------------
-- Chat: Bilder (privater Bucket "chat", Pfad <user-id>/<datei>)
-- ---------------------------------------------------------------
alter table public.chat_messages add column if not exists image_path text;
alter table public.chat_messages drop constraint if exists chat_messages_body_check;
alter table public.chat_messages drop constraint if exists chat_messages_content_check;
alter table public.chat_messages add constraint chat_messages_content_check check (
  char_length(body) <= 4000 and (char_length(btrim(body)) > 0 or image_path is not null)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "chat_objects_read_member" on storage.objects;
create policy "chat_objects_read_member" on storage.objects for select to authenticated
using (bucket_id = 'chat' and public.is_member());
drop policy if exists "chat_objects_insert_own" on storage.objects;
create policy "chat_objects_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'chat' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "chat_objects_delete_own_or_admin" on storage.objects;
create policy "chat_objects_delete_own_or_admin" on storage.objects for delete to authenticated
using (bucket_id = 'chat' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_app_admin()));

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
         case when lm.image_path is not null and btrim(lm.body) = '' then '📷 Foto'
              when lm.image_path is not null then '📷 ' || lm.body
              else lm.body end,
         lm.user_id, lm.created_at,
         (select count(*) from public.chat_messages m
           where m.room_id = r.id and m.user_id <> auth.uid()
             and m.created_at > coalesce(cr.last_read_at, '-infinity'::timestamptz))
  from public.chat_rooms r
  left join public.chat_reads cr on cr.room_id = r.id and cr.user_id = auth.uid()
  left join lateral (
    select m.body, m.image_path, m.user_id, m.created_at from public.chat_messages m
    where m.room_id = r.id order by m.created_at desc limit 1
  ) lm on true
  order by r.sort_order;
$$;

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
  txt text;
begin
  select slug, name into room from public.chat_rooms where id = new.room_id;
  select coalesce(display_name, 'Jemand') into sender from public.profiles where id = new.user_id;
  txt := case when new.image_path is not null and btrim(new.body) = '' then '📷 Foto'
              when new.image_path is not null then '📷 ' || left(new.body, 130)
              else left(new.body, 140) end;

  select array_agg(p.id) into targets
  from public.profiles p
  left join public.notification_prefs np on np.user_id = p.id
  where p.slug is not null
    and p.id <> new.user_id
    and coalesce(np.chat, true)
    and not (room.slug = any(coalesce(np.muted_rooms, '{}')));

  perform public.dispatch_push(targets, room.name, sender || ': ' || txt,
                               '/chat.html?room=' || room.slug, 'chat-' || room.slug);
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- Ausgaben-Splitter (wie Splitwise), pro Slaughter-Games-Event
-- ---------------------------------------------------------------
create table if not exists public.split_events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  sg         integer,
  closed     boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.split_members (
  event_id uuid not null references public.split_events(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  primary key (event_id, user_id)
);

create table if not exists public.split_expenses (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.split_events(id) on delete cascade,
  paid_by      uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0 and amount_cents <= 10000000),
  description  text not null check (char_length(btrim(description)) between 1 and 120),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now()
);
create index if not exists idx_split_expenses_event on public.split_expenses(event_id, created_at desc);

create table if not exists public.split_shares (
  expense_id  uuid not null references public.split_expenses(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  share_cents integer not null check (share_cents >= 0),
  primary key (expense_id, user_id)
);

create table if not exists public.split_payments (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.split_events(id) on delete cascade,
  from_user    uuid not null references auth.users(id) on delete cascade,
  to_user      uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  created_by   uuid references auth.users(id) on delete set null default auth.uid(),
  created_at   timestamptz not null default now(),
  check (from_user <> to_user)
);

create or replace function public.is_split_member(eid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_admin()
      or exists (select 1 from public.split_members where event_id = eid and user_id = auth.uid());
$$;

alter table public.split_events enable row level security;
alter table public.split_members enable row level security;
alter table public.split_expenses enable row level security;
alter table public.split_shares enable row level security;
alter table public.split_payments enable row level security;

drop policy if exists "split_events_read" on public.split_events;
create policy "split_events_read" on public.split_events for select using (public.is_split_member(id));
drop policy if exists "split_events_admin" on public.split_events;
create policy "split_events_admin" on public.split_events for all
using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists "split_members_read" on public.split_members;
create policy "split_members_read" on public.split_members for select using (public.is_split_member(event_id));
drop policy if exists "split_members_admin" on public.split_members;
create policy "split_members_admin" on public.split_members for all
using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists "split_expenses_read" on public.split_expenses;
create policy "split_expenses_read" on public.split_expenses for select using (public.is_split_member(event_id));
-- Schreiben nur ueber die Funktionen unten (pruefen Teilnehmer + Aufteilung)
drop policy if exists "split_expenses_delete" on public.split_expenses;
create policy "split_expenses_delete" on public.split_expenses for delete
using (public.is_app_admin() or created_by = auth.uid() or paid_by = auth.uid());

drop policy if exists "split_shares_read" on public.split_shares;
create policy "split_shares_read" on public.split_shares for select
using (exists (select 1 from public.split_expenses e where e.id = expense_id and public.is_split_member(e.event_id)));

drop policy if exists "split_payments_read" on public.split_payments;
create policy "split_payments_read" on public.split_payments for select using (public.is_split_member(event_id));
drop policy if exists "split_payments_insert" on public.split_payments;
create policy "split_payments_insert" on public.split_payments for insert
with check (
  public.is_split_member(event_id)
  and (public.is_app_admin() or auth.uid() in (from_user, to_user))
  and exists (select 1 from public.split_members m where m.event_id = split_payments.event_id and m.user_id = from_user)
  and exists (select 1 from public.split_members m where m.event_id = split_payments.event_id and m.user_id = to_user)
  and not (select closed from public.split_events where id = event_id)
);
drop policy if exists "split_payments_delete" on public.split_payments;
create policy "split_payments_delete" on public.split_payments for delete
using (public.is_app_admin() or created_by = auth.uid());

-- Ausgabe anlegen: Betrag gleichmaessig auf die gewaehlten Teilnehmer, Rest-
-- Cents an die ersten. Nur Teilnehmer des Events, nur solange es offen ist.
create or replace function public.split_add_expense(
  p_event uuid, p_paid_by uuid, p_amount_cents integer, p_description text, p_users uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  eid uuid;
  n integer;
  base integer;
  rest integer;
  i integer := 0;
  u uuid;
begin
  if not public.is_split_member(p_event) then raise exception 'Du bist bei diesem Event nicht dabei.'; end if;
  if (select closed from public.split_events where id = p_event) then raise exception 'Abrechnung ist abgeschlossen.'; end if;
  if not exists (select 1 from public.split_members where event_id = p_event and user_id = p_paid_by) then
    raise exception 'Zahler ist kein Teilnehmer.';
  end if;
  p_users := array(select distinct x from unnest(p_users) x);
  n := cardinality(p_users);
  if n = 0 then raise exception 'Mindestens eine Person auswählen.'; end if;
  if exists (select 1 from unnest(p_users) x where not exists
      (select 1 from public.split_members m where m.event_id = p_event and m.user_id = x)) then
    raise exception 'Aufteilung nur auf Teilnehmer.';
  end if;

  insert into public.split_expenses(event_id, paid_by, amount_cents, description, created_by)
  values (p_event, p_paid_by, p_amount_cents, btrim(p_description), auth.uid())
  returning id into eid;

  base := p_amount_cents / n;
  rest := p_amount_cents - base * n;
  foreach u in array p_users loop
    i := i + 1;
    insert into public.split_shares(expense_id, user_id, share_cents)
    values (eid, u, base + case when i <= rest then 1 else 0 end);
  end loop;
  return eid;
end;
$$;

grant execute on function public.split_add_expense(uuid, uuid, integer, text, uuid[]) to authenticated;

-- SG7 mit dem aktuellen Startfeld anlegen
insert into public.split_events (name, sg)
select 'Slaughter Games 7', 7
where not exists (select 1 from public.split_events where sg = 7);

insert into public.split_members (event_id, user_id)
select e.id, p.id
from public.split_events e
join public.profiles p on p.slug = any(array['david','simon','hansi','vinc','heber','fabi','osti','felix','marc','burni',
  'frido','silvio','ivo','maugi555-gmail','leo','niki','wenzl','raul','luki','paul'])
where e.sg = 7
on conflict do nothing;

notify pgrst, 'reload schema';
