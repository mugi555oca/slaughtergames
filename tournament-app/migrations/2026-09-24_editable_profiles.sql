-- Editierbare Spielerprofile.
--
-- Bisher: profiles hatte nur display_name, und das Speichern schlug fehl, weil
-- das Frontend ein upsert macht, es aber KEINE insert-Policy gab.
-- Ausserdem lagen Beschreibung/Bild nur statisch in player_profiles.json.
--
-- Danach: jeder eingeloggte Nutzer pflegt Beschreibung, Profilbild und
-- Lieblingskarte selbst; die oeffentliche Profilseite liest das mit.
-- Turnierfakten (Teilnahmen, Aexte, Abzeichen) bleiben in player_profiles.json.

alter table public.profiles add column if not exists slug text;
alter table public.profiles add column if not exists description text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists favourite_card text;

create unique index if not exists profiles_slug_key on public.profiles(slug) where slug is not null;

-- ---------------------------------------------------------------
-- Slug = Schluessel zur oeffentlichen Profilseite (player-profile.html?slug=)
-- Explizit gemappt: aus der E-Mail abgeleitet waeren wenzel/wenzl und
-- maugi555-gmail.com/maugi555-gmail falsch.
-- ---------------------------------------------------------------
update public.profiles p
set slug = m.slug
from (values
  ('burni@slaughtergames.local',   'burni'),
  ('david@slaughtergames.local',   'david'),
  ('fabi@slaughtergames.local',    'fabi'),
  ('felix@slaughtergames.local',   'felix'),
  ('frido@slaughtergames.local',   'frido'),
  ('hansi@slaughtergames.local',   'hansi'),
  ('heber@slaughtergames.local',   'heber'),
  ('ivo@slaughtergames.local',     'ivo'),
  ('leo@slaughtergames.local',     'leo'),
  ('luki@slaughtergames.local',    'luki'),
  ('marc@slaughtergames.local',    'marc'),
  ('maugi555@gmail.com',           'maugi555-gmail'),
  ('niki@slaughtergames.local',    'niki'),
  ('osti@slaughtergames.local',    'osti'),
  ('paul@slaughtergames.local',    'paul'),
  ('raul@slaughtergames.local',    'raul'),
  ('sasha@slaughtergames.local',   'sasha'),
  ('silvio@slaughtergames.local',  'silvio'),
  ('simon@slaughtergames.local',   'simon'),
  ('vinc@slaughtergames.local',    'vinc'),
  ('wenzel@slaughtergames.local',  'wenzl')
) as m(email, slug)
join auth.users u on lower(u.email) = m.email
where p.id = u.id;

-- ---------------------------------------------------------------
-- RLS: eigenes Profil anlegen/aendern, oeffentlich lesen
-- ---------------------------------------------------------------
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_read_public" on public.profiles;
create policy "profiles_read_public"
on public.profiles for select
using (true);

-- profiles_update_own bleibt: using (auth.uid() = id)
-- Der Slug darf nicht von Nutzern umgebogen werden (sonst koennte man ein
-- fremdes Profil kapern), deshalb per Trigger festnageln.
create or replace function public.profiles_protect_slug()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.slug is distinct from old.slug then
    new.slug := old.slug;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_slug on public.profiles;
create trigger trg_profiles_protect_slug
before update on public.profiles
for each row execute procedure public.profiles_protect_slug();

-- ---------------------------------------------------------------
-- Storage fuer Profilbilder
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_read_public" on storage.objects;
create policy "avatars_read_public"
on storage.objects for select
using (bucket_id = 'avatars');

-- Jeder Nutzer darf nur in seinen eigenen Ordner <uid>/... schreiben.
drop policy if exists "avatars_write_own" on storage.objects;
create policy "avatars_write_own"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';
