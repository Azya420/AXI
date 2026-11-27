begin;

do $$
begin
  create type public.order_status as enum (
    'new',
    'paid',
    'in_modeling',
    'awaiting_approval',
    'approved',
    'printing',
    'finishing',
    'shipped',
    'completed',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique check (char_length(order_number) between 1 and 80),
  user_id uuid references public.profiles(id) on delete set null,
  customer_email text not null check (char_length(customer_email) between 3 and 254),
  customer_name text not null default '' check (char_length(customer_name) <= 160),
  title text not null default 'Figurka na zamówienie' check (char_length(title) between 1 and 200),
  status public.order_status not null default 'new',
  status_message text not null default '' check (char_length(status_message) <= 1000),
  ordered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  status public.order_status not null,
  message text not null default '' check (char_length(message) <= 1000),
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_id_idx on public.orders(user_id);
create index if not exists orders_ordered_at_idx on public.orders(ordered_at desc);
create index if not exists order_status_history_order_id_idx on public.order_status_history(order_id, created_at desc);

create or replace function public.handle_axi_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    insert into public.profiles (id, email, created_at)
    values (new.id, lower(new.email), coalesce(new.created_at, now()))
    on conflict (id) do update set email = excluded.email;
  end if;
  return new;
end;
$$;

drop trigger if exists axi_auth_user_created on auth.users;
create trigger axi_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_axi_profile();

drop trigger if exists axi_auth_user_email_changed on auth.users;
create trigger axi_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_axi_profile();

insert into public.profiles (id, email, created_at)
select id, lower(email), created_at
from auth.users
where email is not null
on conflict (id) do update set email = excluded.email;

create or replace function public.is_axi_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

revoke all on function public.is_axi_admin() from public;
grant execute on function public.is_axi_admin() to authenticated;

create or replace function public.set_axi_order_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists axi_order_updated_at on public.orders;
create trigger axi_order_updated_at
  before update on public.orders
  for each row execute function public.set_axi_order_updated_at();

create or replace function public.record_axi_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or old.status is distinct from new.status
     or old.status_message is distinct from new.status_message then
    insert into public.order_status_history (order_id, status, message, changed_by)
    values (new.id, new.status, new.status_message, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists axi_order_status_history on public.orders;
create trigger axi_order_status_history
  after insert or update of status, status_message on public.orders
  for each row execute function public.record_axi_order_status();

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.order_status_history enable row level security;

drop policy if exists "profiles_select_self_or_admin" on public.profiles;
create policy "profiles_select_self_or_admin"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_axi_admin());

drop policy if exists "orders_select_owner_or_admin" on public.orders;
create policy "orders_select_owner_or_admin"
  on public.orders for select
  to authenticated
  using (user_id = auth.uid() or public.is_axi_admin());

drop policy if exists "orders_insert_admin" on public.orders;
create policy "orders_insert_admin"
  on public.orders for insert
  to authenticated
  with check (public.is_axi_admin());

drop policy if exists "orders_update_admin" on public.orders;
create policy "orders_update_admin"
  on public.orders for update
  to authenticated
  using (public.is_axi_admin())
  with check (public.is_axi_admin());

drop policy if exists "history_select_owner_or_admin" on public.order_status_history;
create policy "history_select_owner_or_admin"
  on public.order_status_history for select
  to authenticated
  using (
    public.is_axi_admin()
    or exists (
      select 1 from public.orders
      where public.orders.id = order_status_history.order_id
        and public.orders.user_id = auth.uid()
    )
  );

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.orders from anon, authenticated;
revoke all on table public.order_status_history from anon, authenticated;

grant select on table public.profiles to authenticated;
grant select, insert, update on table public.orders to authenticated;
grant select on table public.order_status_history to authenticated;
grant usage on type public.order_status to authenticated;

commit;

-- Po uruchomieniu migracji nadaj rolę administratora istniejącemu kontu:
-- update public.profiles set role = 'admin' where email = lower('twoj-adres@example.com');
