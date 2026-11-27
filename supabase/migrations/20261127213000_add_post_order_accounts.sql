begin;

alter table public.profiles
  add column if not exists customer_name text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists delivery_method text not null default '',
  add column if not exists delivery_destination text not null default '',
  add column if not exists saved_data_at timestamptz;

alter table public.orders
  add column if not exists amount_total integer,
  add column if not exists currency text,
  add column if not exists payment_provider text,
  add column if not exists payment_reference text,
  add column if not exists delivery_method text not null default '',
  add column if not exists delivery_destination text not null default '';

create unique index if not exists orders_payment_reference_unique_idx
  on public.orders(payment_reference)
  where payment_reference is not null;

create index if not exists orders_customer_email_idx
  on public.orders(lower(customer_email));

commit;

-- Klucz SUPABASE_SECRET_KEY dodaj wyłącznie jako zmienną środowiskową
-- testowej usługi Render. Nigdy nie umieszczaj go w kodzie strony ani w GitHubie.
