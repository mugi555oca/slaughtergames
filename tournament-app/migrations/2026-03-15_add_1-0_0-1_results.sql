-- Add 1:0 and 0:1 as allowed match results
alter table public.matches drop constraint if exists matches_result_check;

alter table public.matches
  add constraint matches_result_check
  check (result in ('pending', '2:0', '2:1', '1:2', '0:2', '1:1', '1:0', '0:1', '0:0', 'ID', 'BYE'));

notify pgrst, 'reload schema';
