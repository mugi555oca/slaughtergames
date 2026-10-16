-- Blog: jedes Mitglied schreibt Artikel, oeffentlich lesbar.
-- Bilder im oeffentlichen Bucket "blog" (Pfad <user-id>/<datei>).
create table if not exists public.blog_posts (
  id         uuid primary key default gen_random_uuid(),
  title      text not null check (char_length(btrim(title)) between 1 and 160),
  teaser     text check (teaser is null or char_length(teaser) <= 400),
  body       text not null default '' check (char_length(body) <= 60000),
  cover_url  text,
  author_id  uuid references auth.users(id) on delete set null default auth.uid(),
  published  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_blog_posts_created on public.blog_posts(created_at desc);

drop trigger if exists trg_blog_posts_touch on public.blog_posts;
create trigger trg_blog_posts_touch before update on public.blog_posts
for each row execute procedure public.touch_updated_at();

alter table public.blog_posts enable row level security;
drop policy if exists "blog_read" on public.blog_posts;
create policy "blog_read" on public.blog_posts for select
using (published or author_id = auth.uid() or public.is_app_admin());
drop policy if exists "blog_insert_member" on public.blog_posts;
create policy "blog_insert_member" on public.blog_posts for insert
with check (public.is_member() and author_id = auth.uid());
drop policy if exists "blog_update_own_or_admin" on public.blog_posts;
create policy "blog_update_own_or_admin" on public.blog_posts for update
using (author_id = auth.uid() or public.is_app_admin())
with check (author_id = auth.uid() or public.is_app_admin());
drop policy if exists "blog_delete_own_or_admin" on public.blog_posts;
create policy "blog_delete_own_or_admin" on public.blog_posts for delete
using (author_id = auth.uid() or public.is_app_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog', 'blog', true, 10485760, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "blog_objects_read" on storage.objects;
create policy "blog_objects_read" on storage.objects for select using (bucket_id = 'blog');
drop policy if exists "blog_objects_insert_own" on storage.objects;
create policy "blog_objects_insert_own" on storage.objects for insert to authenticated
with check (bucket_id = 'blog' and public.is_member() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "blog_objects_delete_own_or_admin" on storage.objects;
create policy "blog_objects_delete_own_or_admin" on storage.objects for delete to authenticated
using (bucket_id = 'blog' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_app_admin()));

notify pgrst, 'reload schema';
