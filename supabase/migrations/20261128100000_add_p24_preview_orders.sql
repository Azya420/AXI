begin;

alter table public.orders
  add column if not exists customer_phone text not null default '';

commit;
