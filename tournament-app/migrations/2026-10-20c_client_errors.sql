-- JavaScript-Fehler von den Geraeten der Nutzer (zum Debuggen).
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  user_id    uuid default auth.uid(),
  page       text,
  message    text,
  stack      text,
  version    text,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.client_errors enable row level security;
drop policy if exists "client_errors_insert" on public.client_errors;
create policy "client_errors_insert" on public.client_errors for insert to anon, authenticated
with check (char_length(coalesce(message, '')) < 2000 and char_length(coalesce(stack, '')) < 6000);
drop policy if exists "client_errors_read_admin" on public.client_errors;
create policy "client_errors_read_admin" on public.client_errors for select using (public.is_app_admin());
notify pgrst, 'reload schema';
