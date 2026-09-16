\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
--
-- Banco desechable para un PostgreSQL vacío. Crea tablas de mentira y
-- REDEFINE tc_puede_ver_empresa(). Contra una base real eso abriría los
-- permisos de par en par. Las migraciones están en supabase/migrations/.
do $$
begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_alta_operativa_pendientes.sql
--
-- Lo que se comprueba es que los RECUENTOS son los que dice la cabecera de la
-- función, en particular los tres sitios donde es fácil equivocarse:
--   · las posiciones son del TIPO, no del vehículo;
--   · una revisión ANULADA no cuenta como medición;
--   · una misma posición medida en cinco revisiones cuenta UNA vez.
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table auth_ctx (empresa uuid);
insert into auth_ctx values ('00000000-0000-0000-0000-0000000000e1');
create or replace function tc_puede_ver_empresa(emp uuid) returns boolean language sql stable as
  $$ select emp = (select empresa from auth_ctx limit 1) $$;

create table tc_empresas (id uuid primary key, nombre text);
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1','Plana'),
                               ('00000000-0000-0000-0000-0000000000e2','Otra');

create table tc_tipos_vehiculo (id uuid primary key default gen_random_uuid(), nombre text, descripcion text);
create table tc_vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  matricula text not null, numero_unidad text,
  tipo_vehiculo_id uuid references tc_tipos_vehiculo(id),
  marca text, modelo text, bastidor text, pendiente_validar boolean not null default false,
  activo boolean not null default true);
create table tc_posiciones_vehiculo (
  id uuid primary key default gen_random_uuid(),
  tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id),
  codigo_posicion text, activo boolean not null default true);
create table tc_neumaticos (id uuid primary key default gen_random_uuid());
create table tc_montajes_actuales (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid not null references tc_vehiculos(id),
  posicion_id uuid not null references tc_posiciones_vehiculo(id),
  unique (vehiculo_id, posicion_id));
create table revisiones_vehiculo (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid not null references tc_vehiculos(id),
  estado_revision text not null default 'completada');
create table revisiones_neumaticos_detalle (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references revisiones_vehiculo(id),
  vehiculo_id uuid not null references tc_vehiculos(id),
  posicion_id uuid not null references tc_posiciones_vehiculo(id),
  profundidad_mm numeric);

\ir ../migrations/tyrecontrol_alta_operativa_pendientes.sql
-- Segunda pasada: la migración tiene que ser idempotente.
\ir ../migrations/tyrecontrol_alta_operativa_pendientes.sql

-- ── Datos ───────────────────────────────────────────────────────────────────
-- Un tipo con 6 posiciones (una desactivada, que NO debe contar) y otro sin
-- ninguna, para el caso del tipo sin plano.
insert into tc_tipos_vehiculo (id, nombre, descripcion) values
  ('00000000-0000-0000-0000-0000000000f1','camion','Camión 3 ejes'),
  ('00000000-0000-0000-0000-0000000000f2','sin-plano','Tipo sin plano');
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, activo)
select '00000000-0000-0000-0000-0000000000f1', 'P'||g, true from generate_series(1,6) g;
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, activo)
values ('00000000-0000-0000-0000-0000000000f1','VIEJA', false);

insert into tc_vehiculos (id, empresa_id, matricula, tipo_vehiculo_id, marca, modelo) values
  ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000e1','SIN-TIPO', null, null, null),
  ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000e1','SIN-PLANO','00000000-0000-0000-0000-0000000000f2', null, null),
  ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000e1','A-MEDIAS','00000000-0000-0000-0000-0000000000f1', null, null),
  ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-0000000000e1','COMPLETO','00000000-0000-0000-0000-0000000000f1', null, null),
  ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000000e2','DE-OTRA','00000000-0000-0000-0000-0000000000f1', null, null);

-- A-MEDIAS: 3 montajes, 2 medidos.
insert into tc_montajes_actuales (vehiculo_id, posicion_id)
select '00000000-0000-0000-0000-00000000000c', id from tc_posiciones_vehiculo
 where tipo_vehiculo_id='00000000-0000-0000-0000-0000000000f1' and activo limit 3;
insert into revisiones_vehiculo (id, vehiculo_id) values
  ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000c');
insert into revisiones_neumaticos_detalle (revision_id, vehiculo_id, posicion_id, profundidad_mm)
select '00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000000c', id, 7.5
  from tc_posiciones_vehiculo where tipo_vehiculo_id='00000000-0000-0000-0000-0000000000f1' and activo limit 2;

-- COMPLETO: 6 montajes y 6 medidos, medidos DOS veces (dos revisiones) para
-- comprobar que no se cuenta dos veces la misma posición.
insert into tc_montajes_actuales (vehiculo_id, posicion_id)
select '00000000-0000-0000-0000-00000000000d', id from tc_posiciones_vehiculo
 where tipo_vehiculo_id='00000000-0000-0000-0000-0000000000f1' and activo;
insert into revisiones_vehiculo (id, vehiculo_id) values
  ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-00000000000d'),
  ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-00000000000d');
insert into revisiones_neumaticos_detalle (revision_id, vehiculo_id, posicion_id, profundidad_mm)
select r.id,'00000000-0000-0000-0000-00000000000d', p.id, 8
  from tc_posiciones_vehiculo p,
       (values ('00000000-0000-0000-0000-0000000000c2'::uuid),('00000000-0000-0000-0000-0000000000c3'::uuid)) r(id)
 where p.tipo_vehiculo_id='00000000-0000-0000-0000-0000000000f1' and p.activo;

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

-- ── Las pruebas ─────────────────────────────────────────────────────────────
do $$ declare r record; begin
  select * into r from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='SIN-TIPO';
  perform prueba('sin tipo: tipo nulo y cero posiciones', r.posiciones_del_tipo, 0);
  perform prueba('sin tipo: el tipo viene nulo', r.tipo_id is null, true);

  select * into r from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='SIN-PLANO';
  perform prueba('tipo sin plano: cero posiciones', r.posiciones_del_tipo, 0);
  perform prueba('tipo sin plano: pero el tipo está puesto', r.tipo_id is not null, true);

  select * into r from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='A-MEDIAS';
  perform prueba('una posición desactivada NO cuenta en el plano', r.posiciones_del_tipo, 6);
  perform prueba('inventario a medias: 3 montados', r.posiciones_con_neumatico, 3);
  perform prueba('inventario a medias: 2 medidos', r.posiciones_con_profundidad, 2);
  perform prueba('el nombre del tipo sale legible', r.tipo_nombre, 'Camión 3 ejes');

  select * into r from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='COMPLETO';
  perform prueba('completo: 6 montados', r.posiciones_con_neumatico, 6);
  perform prueba('medir dos veces la misma posición cuenta UNA', r.posiciones_con_profundidad, 6);
end $$;

-- Una revisión anulada no puede dar por medido un vehículo.
update revisiones_vehiculo set estado_revision='anulada' where id='00000000-0000-0000-0000-0000000000c3';
do $$ declare r record; begin
  select * into r from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='COMPLETO';
  perform prueba('con una de las dos revisiones anulada, la otra sostiene las 6', r.posiciones_con_profundidad, 6);
end $$;
update revisiones_vehiculo set estado_revision='anulada' where vehiculo_id='00000000-0000-0000-0000-00000000000d';
do $$ declare r record; begin
  select * into r from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='COMPLETO';
  perform prueba('anuladas TODAS, no hay ninguna medición válida', r.posiciones_con_profundidad, 0);
end $$;

-- Aislamiento y datos de oficina.
do $$ declare n int; begin
  select count(*) into n from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='DE-OTRA';
  perform prueba('no se cuela un vehículo de otra empresa', n, 0);
  select count(*) into n from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e2');
  perform prueba('sin permiso sobre la empresa, no devuelve nada', n, 0);
end $$;

do $$ declare r record; begin
  update tc_vehiculos set marca=null, modelo=null, bastidor=null, pendiente_validar=true
   where matricula='COMPLETO';
  select * into r from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='COMPLETO';
  -- Los datos de oficina no tocan ningún recuento: el vehículo sigue contando
  -- sus 6 posiciones y sus 6 montajes.
  perform prueba('sin marca, sin modelo y pendiente de validar, los recuentos no cambian',
                 r.posiciones_con_neumatico, 6);
end $$;

do $$ declare n int; begin
  update tc_vehiculos set activo=false where matricula='A-MEDIAS';
  select count(*) into n from tc_alta_operativa_recuentos('00000000-0000-0000-0000-0000000000e1') where matricula='A-MEDIAS';
  perform prueba('un vehículo de baja no sale en la cola', n, 0);
end $$;
