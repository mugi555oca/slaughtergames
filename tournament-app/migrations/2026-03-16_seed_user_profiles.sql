-- Seed user profiles + placeholder account list for admin creation
-- NOTE: This script creates profile rows only for existing auth.users.
-- Auth users must be created in Supabase Auth (or via Admin API).

create table if not exists public.user_login_map (
  login_name text primary key,
  full_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_login_map enable row level security;

drop policy if exists "user_login_map_read_all_authenticated" on public.user_login_map;
create policy "user_login_map_read_all_authenticated"
on public.user_login_map for select
using (auth.role() = 'authenticated');

drop policy if exists "user_login_map_write_admin" on public.user_login_map;
create policy "user_login_map_write_admin"
on public.user_login_map for all
using (public.is_app_admin())
with check (public.is_app_admin());

insert into public.user_login_map (login_name, full_name) values
('vince', 'Thiny Skinny Vince, the Escalating One'),
('burni', 'Burni, the Voracious Weeder'),
('david', 'David, Ride-Power IX'),
('papa-of-runes', 'Papa of Runes'),
('felix', 'Felix, the Great Conceder'),
('simon', 'Substitute Simon'),
('heber', 'Heber, the Pipe Smoking Beardo'),
('ostibot', 'Ostibot, from another Kingdom'),
('raul', 'Raul Passion'),
('fridi', 'Fridi, Master of (A)Ether Waves'),
('niki-jiki', 'Niki-Jiki, Mirror Faker'),
('bouncer', 'Bouncer'),
('evil-twin', 'Evil Twin'),
('ivo', 'Ivo, the Whining One'),
('ulamugi', 'Ulamugi, the Great Highländer Dumper'),
('mutscho', 'Mutscho Gusto'),
('aetherwuzl', 'Aetherwuzl Marvelking'),
('saint-slow-paul', 'Saint Slow Paul III'),
('johann', 'Johann, Aprentice Sorcerer'),
('sash', 'Sash a Cubic Check'),
('leogoyf', 'Leogoyf')
on conflict (login_name) do update set
  full_name = excluded.full_name,
  updated_at = now();

-- Attempt to sync existing auth users into profiles by email prefix
insert into public.profiles(id, display_name)
select u.id,
       coalesce(m.full_name, split_part(u.email, '@', 1)) as display_name
from auth.users u
left join public.user_login_map m
  on lower(split_part(u.email, '@', 1)) = lower(m.login_name)
on conflict (id) do update set
  display_name = excluded.display_name,
  updated_at = now();

notify pgrst, 'reload schema';
