\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
-- Banco desechable: crea tablas de mentira y REDEFINE las funciones de
-- permisos. Las migraciones están en supabase/migrations/.
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_alta_operativa_tipo.sql
--
-- Lo que se comprueba es la REGLA QUE EVITA EL DESTROZO: con neumáticos
-- montados no se cambia el tipo, porque los montajes quedarían apuntando a
-- posiciones de un plano que ya no es el del vehículo.
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table auth_ctx (rol text);
insert into auth_ctx values ('operador');
create or replace function tc_is_superadmin() returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'superadmin' $$;
create or replace function tc_is_admin() returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'admin' $$;
create or replace function tc_auth_empresa_id() returns uuid language sql stable as
  $$ select '00000000-0000-0000-0000-0000000000e1'::uuid $$;
create or replace function tc_operador_ve_empresa(e uuid) returns boolean language sql stable as
  $$ select (select rol from auth_ctx limit 1) = 'operador'
            and e = '00000000-0000-0000-0000-0000000000e1'::uuid $$;

create table tc_empresas (id uuid primary key, nombre text);
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana'),
                               ('00000000-0000-0000-0000-0000000000e2','Otra');
create table tc_config_ejes (id uuid primary key default gen_random_uuid(),
  nombre text not null unique, activo boolean not null default true);
insert into tc_config_ejes (nombre) values ('2x2x4'), ('2x2x2');
create table tc_tipos_vehiculo (id uuid primary key default gen_random_uuid(),
  nombre text, descripcion text, configuracion_ejes text, activo boolean not null default true);
create table tc_vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  matricula text not null, tipo_vehiculo_id uuid references tc_tipos_vehiculo(id),
  config_ejes_id uuid references tc_config_ejes(id),
  marca text, modelo text, pendiente_validar boolean not null default true,
  activo boolean not null default true, updated_at timestamptz not null default now());
create table tc_posiciones_vehiculo (id uuid primary key default gen_random_uuid(),
  tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id),
  codigo_posicion text, activo boolean not null default true);
create table tc_montajes_actuales (id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid not null references tc_vehiculos(id),
  posicion_id uuid not null references tc_posiciones_vehiculo(id));

\ir ../migrations/tyrecontrol_alta_operativa_tipo.sql
-- Segunda pasada: la migración tiene que ser idempotente.
\ir ../migrations/tyrecontrol_alta_operativa_tipo.sql

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

insert into tc_tipos_vehiculo (id, nombre, configuracion_ejes) values
  ('00000000-0000-0000-0000-0000000000f1','tractora_3_ejes','2x2x4'),
  ('00000000-0000-0000-0000-0000000000f2','semirremolque','2x2x2'),
  ('00000000-0000-0000-0000-0000000000f3','sin-plano','2x2');
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion)
select '00000000-0000-0000-0000-0000000000f1','P'||g from generate_series(1,8) g;
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion)
select '00000000-0000-0000-0000-0000000000f2','Q'||g from generate_series(1,6) g;

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

create or replace function nuevo(mat text, emp text default '00000000-0000-0000-0000-0000000000e1')
returns uuid language plpgsql as $$
declare v uuid; begin
  insert into tc_vehiculos (empresa_id, matricula) values (emp::uuid, mat) returning id into v;
  return v;
end $$;

-- ── Las pruebas ─────────────────────────────────────────────────────────────
do $$ declare v uuid; r jsonb; begin
  v := nuevo('0001AAA');
  r := tc_alta_operativa_tipo(v, '00000000-0000-0000-0000-0000000000f1');
  if (r->>'cambiado')::boolean and (r->>'posiciones')::int = 8
     and r->>'configuracion_ejes' = '2x2x4'
  then raise notice 'PASA · el técnico pone el tipo y recibe el plano que le toca';
  else raise notice 'FALLA · %', r; end if;

  if (select config_ejes_id from tc_vehiculos where id=v)
     = (select id from tc_config_ejes where nombre='2x2x4')
  then raise notice 'PASA · la configuración se enlaza por nombre, no se adivina';
  else raise notice 'FALLA · config_ejes_id no enlazado'; end if;

  -- Doble toque / reintento por red mala.
  r := tc_alta_operativa_tipo(v, '00000000-0000-0000-0000-0000000000f1');
  if not (r->>'cambiado')::boolean
  then raise notice 'PASA · repetir la misma petición no escribe ni falla';
  else raise notice 'FALLA · la segunda vez dice que ha cambiado algo'; end if;
end $$;

select prueba('un tipo sin plano se rechaza, y se dice qué falta',
  $q$ select tc_alta_operativa_tipo(nuevo('0002BBB'),'00000000-0000-0000-0000-0000000000f3') $q$,
  'no tiene plano todavía');

-- LA regla: con gomas montadas no se cambia el tipo.
do $$ declare v uuid; begin
  v := nuevo('0003CCC');
  perform tc_alta_operativa_tipo(v, '00000000-0000-0000-0000-0000000000f1');
  insert into tc_montajes_actuales (vehiculo_id, posicion_id)
  select v, id from tc_posiciones_vehiculo where tipo_vehiculo_id='00000000-0000-0000-0000-0000000000f1' limit 2;
  begin
    perform tc_alta_operativa_tipo(v, '00000000-0000-0000-0000-0000000000f2');
    raise notice 'FALLA · ha cambiado el tipo con neumáticos montados';
  exception when others then
    if SQLERRM like '%montado%' and SQLERRM like '%2%'
    then raise notice 'PASA · con gomas montadas no se cambia el tipo, y se dice cuántas son';
    else raise notice 'FALLA · %', SQLERRM; end if;
  end;
  if (select tipo_vehiculo_id from tc_vehiculos where id=v) = '00000000-0000-0000-0000-0000000000f1'
  then raise notice 'PASA · y el tipo se queda como estaba';
  else raise notice 'FALLA · el tipo ha cambiado pese al error'; end if;
  -- Pero repetir el que YA tiene sigue siendo inocuo, montado o no.
  begin
    perform tc_alta_operativa_tipo(v, '00000000-0000-0000-0000-0000000000f1');
    raise notice 'PASA · con gomas montadas, reconfirmar el MISMO tipo no molesta';
  exception when others then raise notice 'FALLA · %', SQLERRM; end;
end $$;

-- Datos de oficina: ni se miran ni se tocan.
do $$ declare v uuid; begin
  v := nuevo('0004DDD');
  perform tc_alta_operativa_tipo(v, '00000000-0000-0000-0000-0000000000f2');
  if (select marca is null and modelo is null and pendiente_validar from tc_vehiculos where id=v)
  then raise notice 'PASA · no toca marca, modelo ni pendiente_validar';
  else raise notice 'FALLA · ha tocado datos de oficina'; end if;
end $$;

select prueba('un vehículo de baja no se da de alta operativa',
  $q$ do $x$ declare v uuid; begin
        v := nuevo('0005EEE'); update tc_vehiculos set activo=false where id=v;
        perform tc_alta_operativa_tipo(v,'00000000-0000-0000-0000-0000000000f1');
      end $x$ $q$, 'dado de baja');

select prueba('un vehículo que no existe lo dice',
  $q$ select tc_alta_operativa_tipo('00000000-0000-0000-0000-00000000dead','00000000-0000-0000-0000-0000000000f1') $q$,
  'Vehículo no encontrado');

-- ── Permisos ────────────────────────────────────────────────────────────────
select prueba('un operador no toca la flota de otra empresa',
  $q$ select tc_alta_operativa_tipo(nuevo('0006FFF','00000000-0000-0000-0000-0000000000e2'),
        '00000000-0000-0000-0000-0000000000f1') $q$,
  'Sin permiso sobre este vehículo');

update auth_ctx set rol = 'cliente';
select prueba('un usuario sin rol operador ni admin no puede',
  $q$ select tc_alta_operativa_tipo(nuevo('0007GGG'),'00000000-0000-0000-0000-0000000000f1') $q$,
  'Sin permiso sobre este vehículo');

update auth_ctx set rol = 'admin';
select prueba('el administrador de su empresa sí puede',
  $q$ select tc_alta_operativa_tipo(nuevo('0008HHH'),'00000000-0000-0000-0000-0000000000f1') $q$, 'ok');
