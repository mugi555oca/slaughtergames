-- Abzeichen als Daten statt hartkodiert im JS.
--
-- Bisher steckten die Kuerzel in badgeMap in player-profile-page.js und die
-- Zuordnung in player_profiles.json - neue Abzeichen brauchten also ein
-- Deployment. Jetzt: Tabellen + Admin-Oberflaeche.

create table if not exists public.badges (
  code        text primary key,
  name        text not null,
  description text,
  icon_key    text,                       -- Symbol-ID in badges.svg; null = Kuerzel anzeigen
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now()
);

create table if not exists public.player_badges (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null,               -- wie in player_profiles.json / profiles.slug
  badge_code text not null references public.badges(code) on update cascade on delete cascade,
  sg         text,                        -- 'SG1'..'SG7', null = ohne Event
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_player_badges_slug on public.player_badges(slug);

-- ---------------------------------------------------------------
-- Bestandsabzeichen
-- ---------------------------------------------------------------
insert into public.badges (code, name, description, icon_key, sort_order) values
  ('FF', 'Founding Father', 'Hat die Slaughter Games ins Leben gerufen.',            'crown',      10),
  ('SM', 'Show Master',     'Führt durch das Turnier und haelt den Laden zusammen.', 'mic',        20),
  ('TD', 'Tragischer Dichter', 'Fuer die denkwuerdigsten Spruechen am Tisch.',       'quill',      30),
  ('KC', 'Küchenchef',      'Hat die Mannschaft verkoestigt.',                       'chefhat',    40),
  ('GM', 'Grill Master',    'Herr ueber Glut und Grillgut.',                         'flame',      50),
  ('BK', 'Bar Keeper',      'Haelt die Glaeser voll.',                               'cocktail',   60),
  ('PQ', 'Pub Quizmaster',  'Stellt die Fragen, die keiner beantworten kann.',       'quiz',       70),
  ('ME', 'Master of Excel', 'Baendigt Tabellen und Formeln.',                        'table',      80),
  ('ÜN', 'Übernachtiger',   'War laenger wach als alle anderen.',                    'moon',       90),
  ('ÜL', 'Übelster Loss',   'Die bitterste Niederlage des Turniers.',                'brokensword',100),
  ('SP', 'Slow Player',     'Braucht Zeit. Viel Zeit.',                              'hourglass',  110),
  ('SO', 'Die Socken',      'Legendaere Socken-Auszeichnung.',                       'sock',       120)
on conflict (code) do update
  set name = excluded.name,
      description = coalesce(public.badges.description, excluded.description),
      icon_key = coalesce(public.badges.icon_key, excluded.icon_key),
      sort_order = excluded.sort_order;

-- ---------------------------------------------------------------
-- RLS: alle duerfen lesen, nur Admins schreiben
-- ---------------------------------------------------------------
alter table public.badges enable row level security;
alter table public.player_badges enable row level security;

drop policy if exists "badges_read_public" on public.badges;
create policy "badges_read_public" on public.badges for select using (true);

drop policy if exists "badges_write_admin" on public.badges;
create policy "badges_write_admin" on public.badges for all
using (public.is_app_admin()) with check (public.is_app_admin());

drop policy if exists "player_badges_read_public" on public.player_badges;
create policy "player_badges_read_public" on public.player_badges for select using (true);

drop policy if exists "player_badges_write_admin" on public.player_badges;
create policy "player_badges_write_admin" on public.player_badges for all
using (public.is_app_admin()) with check (public.is_app_admin());

notify pgrst, 'reload schema';

-- Nachtrag: Icons fuer die spaeter angelegten Abzeichen
update public.badges set icon_key = v.k from (values
  ('DB','candle'), ('SL','lantern'), ('WN','sneeze'), ('PM','punt'), ('MSB','spikeball')
) as v(c,k) where public.badges.code = v.c;
