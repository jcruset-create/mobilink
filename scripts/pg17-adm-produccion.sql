-- Reproduccion de laboratorio del modulo de administracion, con las
-- definiciones REALES del repositorio y el estado posterior a 005 + la
-- restauracion minima (adm_ot_estado sin security_invoker, anon revocado).

create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;

do $$ begin
  create type adm_rol as enum ('admin','administracion','recepcion','supervisor','tecnico');
exception when duplicate_object then null; end $$;

create table if not exists adm_usuarios (
  id uuid primary key, nombre text, email text, rol adm_rol, activo boolean not null default true);
create table if not exists adm_customers (
  id uuid primary key default gen_random_uuid(), name text);
create table if not exists adm_work_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references adm_customers(id),
  ot_number text, vehicle_plate text,
  status text not null default 'abierta',
  total_amount numeric(12,2) not null default 0,
  center text not null default 'tarragona',
  created_at timestamptz not null default now(), closed_at timestamptz);

grant select, insert, update, delete on adm_usuarios, adm_customers, adm_work_orders
  to anon, authenticated;

-- Las funciones REALES, tal cual estan en administracion_fase1.sql
create or replace function adm_rol_actual()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select rol::text from adm_usuarios where id = auth.uid() and activo), '')
$$;
create or replace function adm_can_manage()
returns boolean language sql stable security definer set search_path = public as $$
  select adm_rol_actual() in ('admin','administracion')
$$;
create or replace function adm_can_read()
returns boolean language sql stable security definer set search_path = public as $$
  select adm_rol_actual() in ('admin','administracion','recepcion','supervisor')
$$;

alter table adm_usuarios enable row level security;
alter table adm_customers enable row level security;
alter table adm_work_orders enable row level security;

drop policy if exists adm_customers_select on adm_customers;
create policy adm_customers_select on adm_customers for select using ( adm_can_read() );
drop policy if exists adm_customers_write on adm_customers;
create policy adm_customers_write on adm_customers for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );
drop policy if exists adm_work_orders_select on adm_work_orders;
create policy adm_work_orders_select on adm_work_orders for select using ( adm_can_read() );
drop policy if exists adm_work_orders_write on adm_work_orders;
create policy adm_work_orders_write on adm_work_orders for all
  using ( adm_can_manage() ) with check ( adm_can_manage() );

create or replace view adm_ot_estado as
  select wo.id, wo.ot_number, wo.vehicle_plate, wo.status, wo.center, wo.created_at,
         c.name as customer_name
  from adm_work_orders wo
  join adm_customers c on c.id = wo.customer_id;
grant select on adm_ot_estado to authenticated;

-- Estado posterior a 005 + restauracion minima: anon fuera, sin
-- security_invoker, authenticated conserva solo el select.
revoke all on adm_ot_estado from anon;
revoke insert, update, delete on adm_ot_estado from authenticated;
alter view adm_ot_estado reset (security_invoker);

-- Usuarios de prueba, uno por caso de la matriz
insert into adm_customers (id,name) values
  ('00000000-0000-4000-c000-000000000001','Transportes Ruiz') on conflict do nothing;
insert into adm_work_orders (customer_id, ot_number, vehicle_plate, total_amount, center)
  select '00000000-0000-4000-c000-000000000001','OT-1','1234ABC', 1450.00, 'tarragona'
  where not exists (select 1 from adm_work_orders);
insert into adm_usuarios (id,nombre,rol,activo) values
  ('00000000-0000-4000-a000-00000000000a','Tecnica','tecnico',true),
  ('00000000-0000-4000-a000-00000000000b','Admin','admin',true),
  ('00000000-0000-4000-a000-00000000000c','Recepcion','recepcion',true),
  ('00000000-0000-4000-a000-00000000000d','Tecnico de baja','tecnico',false)
  on conflict (id) do nothing;
