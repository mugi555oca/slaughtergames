-- Fix: allow tournament deletion for owner OR admin

drop policy if exists "tournaments_delete_admin_only" on public.tournaments;

create policy "tournaments_delete_owner_or_admin"
on public.tournaments for delete
using (auth.uid() = owner_id or public.is_app_admin());

notify pgrst, 'reload schema';
