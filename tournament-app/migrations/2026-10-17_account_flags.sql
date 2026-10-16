-- Passwort-Status pro Account (KEIN Passwort im Klartext - Supabase speichert
-- nur Hashes; der Admin sieht, ob noch das Standard-Passwort gilt).
create table if not exists public.account_flags (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  pw_state       text not null default 'default' check (pw_state in ('default', 'own', 'admin')),
  pw_changed_at  timestamptz
);
alter table public.account_flags enable row level security;
drop policy if exists "account_flags_read" on public.account_flags;
create policy "account_flags_read" on public.account_flags for select
using (user_id = auth.uid() or public.is_app_admin());
drop policy if exists "account_flags_write_own" on public.account_flags;
create policy "account_flags_write_own" on public.account_flags for insert
with check (user_id = auth.uid() and pw_state = 'own');
drop policy if exists "account_flags_update_own" on public.account_flags;
create policy "account_flags_update_own" on public.account_flags for update
using (user_id = auth.uid()) with check (user_id = auth.uid() and pw_state = 'own');
notify pgrst, 'reload schema';
