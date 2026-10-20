-- Boosterpool: gemeinsames Guthaben fuer Booster (bisher Fridos Google Sheet).
--
-- Ablauf: Mitglieder zahlen ein (pool_deposits) -> Frido kauft Displays
-- (pool_lots) -> pro Draft nimmt jeder Booster und wird mit dem Draftpreis
-- belastet (pool_drafts) -> Restware kann verkauft werden (pool_sales).
--   Guthaben je Konto = Einzahlungen - Drafts
--   Kontostand Pool   = Einzahlungen - Einkaeufe + Verkaeufe
--   Lager je Los      = Booster gekauft - gedraftet - verkauft + Korrekturen
-- Lesen: alle Mitglieder. Schreiben: Pool-Verwalter (Frido + Admin).

create table if not exists public.pool_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create or replace function public.is_pool_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_app_admin() or exists (select 1 from public.pool_admins where user_id = auth.uid());
$$;

create table if not exists public.pool_settings (
  id        integer primary key default 1 check (id = 1),
  iban      text,
  holder    text,
  info      text,
  updated_at timestamptz not null default now()
);

create table if not exists public.pool_accounts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  slug       text references public.roster(slug) on update cascade on delete set null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.pool_lots (
  id             uuid primary key default gen_random_uuid(),
  purchased_on   date not null default current_date,
  set_name       text not null,
  cost_cents     integer not null default 0 check (cost_cents >= 0),
  displays       numeric,
  boosters       integer check (boosters is null or boosters >= 0),  -- null = nicht im Lager gefuehrt
  source         text,
  delivery       text not null default 'bestellt' check (delivery in ('bestellt', 'geliefert')),
  delivered_on   date,
  storage        text,                      -- wo liegt's (z. B. "Frido 120 · Vinc 12")
  note           text,
  created_at     timestamptz not null default now()
);

create table if not exists public.pool_deposits (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default current_date,
  account_id   uuid not null references public.pool_accounts(id) on delete cascade,
  amount_cents integer not null,            -- negativ = Auszahlung/Uebertrag
  status       text not null default 'bestätigt' check (status in ('bestätigt', 'offen', 'bar')),
  note         text,
  created_at   timestamptz not null default now()
);

create table if not exists public.pool_drafts (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null default gen_random_uuid(),   -- ein Draftabend
  date         date not null default current_date,
  account_id   uuid not null references public.pool_accounts(id) on delete cascade,
  lot_id       uuid references public.pool_lots(id) on delete set null,
  set_name     text,
  boosters     integer not null default 3 check (boosters >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  holder       text,                        -- aus wessen Lager
  tournament_id uuid references public.tournaments(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_pool_drafts_account on public.pool_drafts(account_id);
create index if not exists idx_pool_drafts_lot on public.pool_drafts(lot_id);

create table if not exists public.pool_sales (
  id           uuid primary key default gen_random_uuid(),
  date         date not null default current_date,
  lot_id       uuid references public.pool_lots(id) on delete set null,
  set_name     text,
  boosters     integer not null default 0,
  amount_cents integer not null,
  note         text,
  created_at   timestamptz not null default now()
);

create table if not exists public.pool_adjustments (
  id         uuid primary key default gen_random_uuid(),
  date       date not null default current_date,
  lot_id     uuid not null references public.pool_lots(id) on delete cascade,
  boosters   integer not null,              -- + gefunden / - verschwunden
  note       text,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['pool_settings','pool_accounts','pool_lots','pool_deposits','pool_drafts','pool_sales','pool_adjustments','pool_admins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.is_member())', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    if t = 'pool_admins' then
      execute format('create policy %I on public.%I for all using (public.is_app_admin()) with check (public.is_app_admin())', t || '_write', t);
    else
      execute format('create policy %I on public.%I for all using (public.is_pool_admin()) with check (public.is_pool_admin())', t || '_write', t);
    end if;
  end loop;
end $$;

-- Benachrichtigungen
alter table public.notification_prefs add column if not exists pool boolean not null default true;

create or replace function public.pool_balance(acc uuid)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select sum(amount_cents) from public.pool_deposits where account_id = acc), 0)
       - coalesce((select sum(amount_cents) from public.pool_drafts where account_id = acc), 0);
$$;

create or replace function public.pool_user(acc uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select p.id from public.pool_accounts a join public.profiles p on p.slug = a.slug where a.id = acc;
$$;

create or replace function public.pool_deposit_notify()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'offen' or new.amount_cents <= 0 then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  perform public.notify(public.pool_user(new.account_id), 'pool', 'pool', '💶 Boosterpool: Geld is da',
    public.eur(new.amount_cents) || ' gutgschrieben. Dein Guthaben: ' || public.eur(public.pool_balance(new.account_id)) || '. Danke, du Ehrenmann!',
    '/boosterpool.html');
  return new;
end;
$$;
drop trigger if exists trg_pool_deposit_notify on public.pool_deposits;
create trigger trg_pool_deposit_notify after insert or update of status on public.pool_deposits
for each row execute procedure public.pool_deposit_notify();

create or replace function public.pool_draft_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare bal integer := public.pool_balance(new.account_id);
begin
  perform public.notify(public.pool_user(new.account_id), 'pool', 'pool',
    '🃏 Boosterpool: ' || coalesce(new.set_name, 'Draft'),
    '−' || public.eur(new.amount_cents) || ' für ' || new.boosters || ' Booster. Guthaben: ' || public.eur(bal) ||
    case when bal < 0 then '. Du bist im Minus – Nachschub bitte! 💸'
         when bal < new.amount_cents then '. Reicht nimma für an Draft – bitte aufladen!'
         else '' end,
    '/boosterpool.html');
  return new;
end;
$$;
drop trigger if exists trg_pool_draft_notify on public.pool_drafts;
create trigger trg_pool_draft_notify after insert on public.pool_drafts
for each row execute procedure public.pool_draft_notify();

-- Frido und Mugi verwalten
insert into public.pool_admins(user_id)
select id from public.profiles where slug in ('frido', 'maugi555-gmail')
on conflict do nothing;

insert into public.pool_settings(id, iban, holder, info)
values (1, 'DE86100110012901265259', 'Frido',
        'Einzahlen aufs Pool-Konto, Verwendungszweck: Boosterpool + dein Name. Pro Draft nimmt jeder 3 Booster.')
on conflict (id) do nothing;

notify pgrst, 'reload schema';
