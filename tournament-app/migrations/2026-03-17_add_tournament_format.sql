-- Add tournament format fields
alter table public.tournaments
  add column if not exists format_key text not null default 'other-cube',
  add column if not exists edi_code text;

-- backfill defaults
update public.tournaments
set format_key = coalesce(nullif(format_key, ''), 'other-cube')
where format_key is null or format_key = '';

notify pgrst, 'reload schema';
