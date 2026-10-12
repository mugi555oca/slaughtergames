-- SG-weiter Spielerstamm.
--
-- Bisher kam die Spielerauswahl beim Turnier-Anlegen aus der statischen
-- user_profiles.json - neue Spieler brauchten ein Deployment. Jetzt pflegt der
-- Admin den Stamm in der App; Dashboard, Spieleruebersicht und Profilseite
-- lesen von hier.
--
-- Turnierfakten (Teilnahmen, Aexte) der Altspieler bleiben in
-- player_profiles.json. Neue Spieler starten ohne.

create table if not exists public.roster (
  slug        text primary key,
  name        text not null,                 -- SG-Name, z. B. "Burni, the Voracious Weeder"
  real_name   text,                          -- Rufname, z. B. "Burni"
  active      boolean not null default true, -- false = nicht mehr in der Auswahl
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

create unique index if not exists roster_name_key on public.roster (lower(name));

-- Bestand aus player_profiles.json
insert into public.roster (slug, name, real_name) values
  ('burni',          'Burni, the Voracious Weeder',            'Burni'),
  ('vinc',           'Thiny Skinny Vince, the Escalating One', 'Vinc'),
  ('simon',          'Substitute Simon',                       'Simon'),
  ('silvio',         'Papa of Runes',                          'Silvio'),
  ('felix',          'Felix, the Great Conceder',              'Felix'),
  ('david',          'David, Ride-Power IX',                   'David'),
  ('ivo',            'Ivo, the Whining One',                   'Ivo'),
  ('niki',           'Niki-Jiki, Mirror Faker',                'Niki'),
  ('osti',           'Ostibot, from another Kingdom',          'Osti'),
  ('maugi555-gmail', 'Ulamugi, the Great Highländer Dumper',   'Mugi'),
  ('frido',          'Fridi, Master of (A)Ether Waves',        'Frido'),
  ('luki',           'Mutscho Gusto',                          'Luki'),
  ('leo',            'Leogoyf',                                'Leo'),
  ('paul',           'Saint Slow Paul III',                    'Paul'),
  ('wenzl',          'Bouncer',                                'Wenzl'),
  ('heber',          'Heber, the Pipe Smoking Beardo',         'Heber'),
  ('hansi',          'Johann, Aprentice Sorcerer',             'Hansi'),
  ('fabi',           'Evil Twin',                              'Fabi'),
  ('marc',           'Aetherwuzl Marvelking',                  'Marc'),
  ('raul',           'Raul Passion',                           'Raul'),
  ('sasha',          'Sash a Cubic Check',                     'Sasha')
on conflict (slug) do nothing;

alter table public.roster enable row level security;

drop policy if exists "roster_read_public" on public.roster;
create policy "roster_read_public" on public.roster for select using (true);

drop policy if exists "roster_write_admin" on public.roster;
create policy "roster_write_admin" on public.roster for all
using (public.is_app_admin()) with check (public.is_app_admin());

notify pgrst, 'reload schema';
