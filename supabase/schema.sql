-- TRUSTBOX schema. Run in Supabase SQL editor.
-- Written with IF NOT EXISTS where possible. COMPARE with your existing tables first.
create extension if not exists pgcrypto;
create sequence if not exists product_seq; create sequence if not exists shipment_seq;

create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  email text, display_name text,
  role text not null default 'customer' check (role in ('seller','customer','admin')),
  role_chosen boolean not null default false,
  created_at timestamptz default now());

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,display_name,role,role_chosen)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',new.email),
    case when new.raw_user_meta_data->>'role'='seller' then 'seller' else 'customer' end,
    new.raw_user_meta_data->>'role' is not null)
  on conflict (id) do nothing;
  return new;
end;$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Google users pick seller/customer once. Admin is only ever set manually in SQL.
create or replace function public.choose_role(r text) returns void
language plpgsql security definer set search_path=public as $$
begin
  if r not in ('seller','customer') then raise exception 'invalid role'; end if;
  update public.profiles set role=r, role_chosen=true where id=auth.uid() and role_chosen=false;
end;$$;

create or replace function public.app_role() returns text
language sql stable security definer set search_path=public as
$$ select role from public.profiles where id=auth.uid() $$;

create table if not exists public.reference_datasets(
  id uuid primary key default gen_random_uuid(),
  category text unique not null,
  temp_min numeric, temp_max numeric, humidity_max numeric, shock_max numeric, notes text);

create table if not exists public.products(
  id uuid primary key default gen_random_uuid(),
  product_code text unique default 'PRD-'||lpad(nextval('product_seq')::text,4,'0'),
  seller_id uuid not null references public.profiles(id),
  name text not null, category text not null, description text, image_url text,
  safety_notes text, price numeric, created_at timestamptz default now());

create table if not exists public.devices(
  id uuid primary key default gen_random_uuid(),
  device_code text unique not null,
  key_hash text not null,                 -- SHA-256 of the device key. Never store the key itself.
  seller_id uuid not null references public.profiles(id),
  firmware text, last_seen timestamptz, created_at timestamptz default now());

create table if not exists public.shipments(
  id uuid primary key default gen_random_uuid(),
  shipment_code text unique default 'SHIP-'||lpad(nextval('shipment_seq')::text,4,'0'),
  product_id uuid references public.products(id),
  seller_id uuid not null references public.profiles(id),
  customer_id uuid references public.profiles(id),
  device_id uuid references public.devices(id),
  status text not null default 'created' check (status in ('created','in_transit','delivered','returned')),
  condition text not null default 'safe' check (condition in ('safe','warning','critical')),
  condition_score int default 100, started_at timestamptz, delivered_at timestamptz,
  created_at timestamptz default now());

create table if not exists public.sensor_readings(
  id bigint generated always as identity primary key,
  shipment_id uuid references public.shipments(id) on delete cascade,
  device_id uuid references public.devices(id),
  temperature numeric, humidity numeric, shock numeric, vibration numeric, lat numeric, lng numeric,
  recorded_at timestamptz default now());
create index if not exists readings_ship_time on public.sensor_readings(shipment_id, recorded_at desc);

create table if not exists public.alerts(
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references public.shipments(id) on delete cascade,
  kind text not null, severity text not null check (severity in ('safe','warning','critical')),
  message text, acknowledged boolean default false, created_at timestamptz default now());

create table if not exists public.orders(
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id),
  customer_id uuid not null references public.profiles(id),
  shipment_id uuid references public.shipments(id),
  status text default 'placed', created_at timestamptz default now());

create table if not exists public.returns(
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references public.shipments(id),
  requested_by uuid references public.profiles(id),
  reason text, status text default 'pending', created_at timestamptz default now());

create table if not exists public.audit_logs(
  id bigint generated always as identity primary key,
  actor uuid, action text not null, detail jsonb, created_at timestamptz default now());

create or replace function public.can_see_shipment(sid uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select public.app_role()='admin' or exists(select 1 from public.shipments s
    where s.id=sid and (s.seller_id=auth.uid() or s.customer_id=auth.uid())) $$;

-- Row level security
do $$ declare t text; begin
  foreach t in array array['profiles','reference_datasets','products','devices','shipments','sensor_readings','alerts','orders','returns','audit_logs']
  loop execute format('alter table public.%I enable row level security',t); end loop; end $$;

create policy profiles_read on public.profiles for select using (id=auth.uid() or public.app_role()='admin');
create policy profiles_update on public.profiles for update using (id=auth.uid()) with check (id=auth.uid() and role=public.app_role());

create policy ref_read on public.reference_datasets for select to authenticated using (true);
create policy ref_admin on public.reference_datasets for all using (public.app_role()='admin') with check (public.app_role()='admin');

create policy prod_read on public.products for select to authenticated using (true);
create policy prod_write on public.products for all
  using (seller_id=auth.uid() or public.app_role()='admin')
  with check ((seller_id=auth.uid() and public.app_role()='seller') or public.app_role()='admin');

create policy dev_rw on public.devices for all
  using (seller_id=auth.uid() or public.app_role()='admin')
  with check ((seller_id=auth.uid() and public.app_role()='seller') or public.app_role()='admin');

create policy ship_read on public.shipments for select using (public.can_see_shipment(id));
create policy ship_write on public.shipments for all
  using (seller_id=auth.uid() or public.app_role()='admin')
  with check ((seller_id=auth.uid() and public.app_role()='seller') or public.app_role()='admin');

-- Readings are written only by the ingest Edge Function (service role). No insert policy on purpose.
create policy read_read on public.sensor_readings for select using (public.can_see_shipment(shipment_id));
create policy alert_read on public.alerts for select using (public.can_see_shipment(shipment_id));
create policy alert_ack on public.alerts for update using (public.can_see_shipment(shipment_id));

create policy ord_read on public.orders for select using (customer_id=auth.uid() or public.app_role()='admin'
  or exists(select 1 from public.products p where p.id=product_id and p.seller_id=auth.uid()));
create policy ord_insert on public.orders for insert with check (customer_id=auth.uid() and public.app_role()='customer');

create policy ret_read on public.returns for select using (requested_by=auth.uid() or public.can_see_shipment(shipment_id));
create policy ret_insert on public.returns for insert with check (requested_by=auth.uid());
create policy ret_admin on public.returns for update using (public.app_role() in ('seller','admin'));

create policy audit_admin on public.audit_logs for select using (public.app_role()='admin');

alter publication supabase_realtime add table public.sensor_readings, public.alerts;

insert into public.reference_datasets(category,temp_min,temp_max,humidity_max,shock_max,notes) values
 ('Glass',null,null,null,4,'Demo values, configure per product'),
 ('Temperature-sensitive',2,8,60,2,'Demo values, configure per product'),
 ('Electronics',5,35,70,3,'Demo values, configure per product')
on conflict (category) do nothing;

-- Make yourself admin once (replace the email):
-- update public.profiles set role='admin', role_chosen=true where email='you@example.com';
