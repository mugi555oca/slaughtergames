-- Test-Push an mich selbst (Knopf im Profil)
create or replace function public.send_test_push()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Nicht eingeloggt.'; end if;
  perform public.dispatch_push(array[auth.uid()], '🪓 Test-Push',
    public.pick(array['Servas! Push funktioniert. Jetzt kann di keiner mehr ignorieren.',
                      'Läuft! Ab jetzt erfährst sofort, wer di verschiert hat 💀',
                      'Funktioniert. Leiwand! 🍻']), '/profil.html#push', 'test');
end;
$$;
grant execute on function public.send_test_push() to authenticated;
notify pgrst, 'reload schema';

-- Kaltstart der Edge Function kann > 5 s dauern -> mehr Zeit geben
create or replace function public.dispatch_push(
  user_ids uuid[], title text, body text, url text, tag text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare hook_url text; hook_secret text;
begin
  if user_ids is null or cardinality(user_ids) = 0 then return; end if;
  select decrypted_secret into hook_url from vault.decrypted_secrets where name = 'push_hook_url';
  select decrypted_secret into hook_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if hook_url is null or hook_secret is null then return; end if;
  perform net.http_post(
    url := hook_url,
    body := jsonb_build_object('user_ids', user_ids, 'title', title, 'body', body, 'url', url, 'tag', tag),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-hook-secret', hook_secret),
    timeout_milliseconds := 25000
  );
exception when others then
  raise warning 'dispatch_push: %', sqlerrm;
end;
$$;
revoke execute on function public.dispatch_push(uuid[], text, text, text, text) from public, anon, authenticated;
