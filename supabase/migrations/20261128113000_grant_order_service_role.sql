begin;

grant usage on schema public to service_role;
grant usage on type public.order_status to service_role;
grant select, insert, update on table public.orders to service_role;
grant select, update on table public.profiles to service_role;

commit;
