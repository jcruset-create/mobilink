\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
--
-- Banco de pruebas desechable para un PostgreSQL vacío en local. Crea tablas
-- de mentira y REDEFINE tc_is_superadmin(), tc_is_admin() y
-- tc_auth_empresa_id() como funciones que devuelven valores fijos. Contra una
-- base real eso abriría los permisos de par en par.
--
-- Las migraciones que van a Supabase son las de supabase/migrations/.
do $$
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: es el banco de pruebas '
      'desechable y esta base ya tiene TyreControl instalado. No se ha '
      'ejecutado nada. Las migraciones están en supabase/migrations/.';
  end if;
end $$;

-- ============================================================
-- Banco desechable para tyrecontrol_eliminar_vehiculo_pendiente.sql
--
-- Lo que se comprueba es el LÍMITE: que borra lo que no tiene vida detrás y
-- que se niega, diciendo qué tiene, en cuanto la tiene. Ese límite existe
-- porque media docena de claves ajenas contra tc_vehiculos son ON DELETE SET
-- NULL: sin él, borrar no fallaría, dejaría huérfano el histórico del
-- neumático. Cada tabla de historial tiene su caso para que nadie pueda
-- quitar una de la lista sin que se note.
--
--   initdb -D /tmp/pg/data -U postgres -A trust
--   pg_ctl -D /tmp/pg/data -o "-k /tmp/pg -p 55433" -l /tmp/pg/log start
--   psql -h /tmp/pg -p 55433 -U postgres -c "create database prueba"
--   psql -h /tmp/pg -p 55433 -U postgres -d prueba \
--        -f supabase/pruebas/eliminar_vehiculo.sql
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

-- Quién soy en cada prueba. Se cambia con: update auth_ctx set rol = '...'
create table auth_ctx (rol text);
insert into auth_ctx values ('admin');

create or replace function tc_is_superadmin() returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'superadmin' $$;
create or replace function tc_is_admin() returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'admin' $$;
create or replace function tc_auth_empresa_id() returns uuid language sql stable as
  $$ select '00000000-0000-0000-0000-0000000000e1'::uuid $$;

create table tc_empresas (id uuid primary key, nombre text);
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana'),
                               ('00000000-0000-0000-0000-0000000000e2','Otra');

create table tc_vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id) on delete restrict,
  matricula text not null, activo boolean not null default true,
  pendiente_validar boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (empresa_id, matricula));

-- Las cinco tablas de historial que mira la función. Las claves son las de
-- producción a propósito: `set null` donde lo son de verdad, para que este
-- banco reproduzca el motivo por el que la función tiene que contar a mano.
create table revisiones_vehiculo (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid references tc_vehiculos(id) on delete set null);
create table tc_montajes_actuales (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid references tc_vehiculos(id) on delete cascade);
create table operaciones_neumaticos (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid references tc_vehiculos(id) on delete set null);
create table tc_intervenciones (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid references tc_vehiculos(id) on delete set null);
create table tc_incidencias (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid references tc_vehiculos(id) on delete set null);

\ir ../migrations/tyrecontrol_eliminar_vehiculo_pendiente.sql
-- Segunda pasada: la migración tiene que ser idempotente.
\ir ../migrations/tyrecontrol_eliminar_vehiculo_pendiente.sql

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

create or replace function prueba(nombre text, sql text, espera text) returns void
language plpgsql as $$
declare msg text; begin
  begin execute sql; msg := 'ok';
  exception when others then msg := SQLERRM; end;
  if espera = 'ok' then
    if msg = 'ok' then raise notice 'PASA · %', nombre;
    else raise notice 'FALLA · % → %', nombre, msg; end if;
  else
    if msg like '%' || espera || '%' then raise notice 'PASA · %', nombre;
    else raise notice 'FALLA · % → esperaba "%", dio "%"', nombre, espera, msg; end if;
  end if;
end $$;

/* Deja un vehículo limpio con esa matrícula y devuelve su id. */
create or replace function nuevo(mat text, emp text default '00000000-0000-0000-0000-0000000000e1')
returns uuid language plpgsql as $$
declare v uuid; begin
  insert into tc_vehiculos (empresa_id, matricula) values (emp::uuid, mat) returning id into v;
  return v;
end $$;

-- ── Las pruebas ─────────────────────────────────────────────────────────────

select prueba('un vehículo sin nada detrás se borra',
  $q$ select tc_eliminar_vehiculo(nuevo('0001AAA')) $q$, 'ok');

do $$ begin
  if not exists (select 1 from tc_vehiculos where matricula = '0001AAA')
  then raise notice 'PASA · y desaparece de verdad de la tabla';
  else raise notice 'FALLA · el vehículo sigue ahí'; end if;
end $$;

select prueba('un id que no existe lo dice, no borra en silencio',
  $q$ select tc_eliminar_vehiculo('00000000-0000-0000-0000-00000000dead') $q$,
  'Vehículo no encontrado');

-- Cada tabla de historial, la suya: si alguien quita una de la lista de la
-- función, cae exactamente esta prueba y se ve cuál.
do $$
declare
  t text; col text; v uuid;
  tablas text[] := array['revisiones_vehiculo','tc_montajes_actuales',
                         'operaciones_neumaticos','tc_intervenciones','tc_incidencias'];
begin
  foreach t in array tablas loop
    v := nuevo('HIST' || substr(md5(t), 1, 3));
    execute format('insert into %I (vehiculo_id) values (%L)', t, v);
    begin
      perform tc_eliminar_vehiculo(v);
      raise notice 'FALLA · con una fila en % se ha borrado igual', t;
    exception when others then
      if SQLERRM like '%historial%' and SQLERRM like '%baja%'
      then raise notice 'PASA · con una fila en % no se borra y pide darlo de baja', t;
      else raise notice 'FALLA · con una fila en % dio: %', t, SQLERRM; end if;
    end;
    if exists (select 1 from tc_vehiculos where id = v)
    then null; else raise notice 'FALLA · % se borró pese al error', t; end if;
  end loop;
end $$;

do $$ declare v uuid; begin
  v := nuevo('0002BBB');
  insert into revisiones_vehiculo (vehiculo_id) values (v), (v), (v);
  begin
    perform tc_eliminar_vehiculo(v);
    raise notice 'FALLA · se ha borrado con tres revisiones';
  exception when others then
    if SQLERRM like '%3 revisión%'
    then raise notice 'PASA · el mensaje dice CUÁNTO historial tiene, no solo que lo tiene';
    else raise notice 'FALLA · mensaje sin el recuento: %', SQLERRM; end if;
  end;
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────────

update auth_ctx set rol = 'operador';
select prueba('un operador no borra vehículos',
  $q$ select tc_eliminar_vehiculo(nuevo('0003CCC')) $q$,
  'Sólo un administrador elimina vehículos');

update auth_ctx set rol = 'admin';
select prueba('un administrador no borra de OTRA empresa',
  $q$ select tc_eliminar_vehiculo(nuevo('0004DDD','00000000-0000-0000-0000-0000000000e2')) $q$,
  'Sólo un administrador elimina vehículos');

update auth_ctx set rol = 'superadmin';
select prueba('el superadministrador sí borra de cualquier empresa',
  $q$ select tc_eliminar_vehiculo(nuevo('0005EEE','00000000-0000-0000-0000-0000000000e2')) $q$, 'ok');
