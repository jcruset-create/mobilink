\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_base_habitual.sql
--
-- Lo que se comprueba:
--   · gana la base con más HORAS, no la que tiene más estancias;
--   · una estancia abierta cuenta hasta su última muestra, no hasta ahora;
--   · lo de fuera de la ventana no cuenta, y lo que la cruza se recorta;
--   · repartido entre dos bases → «dudosa», con la segunda al lado;
--   · pocas horas → «dudosa»; sin estancias → «sin_datos»;
--   · una base dada de baja no cuenta;
--   · simular no escribe; asignar solo rellena las vacías; sobrescribir pisa;
--   · un vehículo dado de baja no sale; sin ser admin no se escribe;
--   · pasarlo dos veces no cambia nada.
-- ============================================================

create extension if not exists pgcrypto;

create table tc_empresas (id uuid primary key default gen_random_uuid(), nombre text);
create table tc_delegaciones (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references tc_empresas(id), nombre text, activo boolean not null default true);
create table tc_vehiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references tc_empresas(id), delegacion_id uuid references tc_delegaciones(id),
  matricula text, activo boolean not null default true);
create table tc_vehiculo_presencia_historico (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid, vehiculo_id uuid references tc_vehiculos(id),
  estado text, delegacion_id uuid references tc_delegaciones(id),
  desde timestamptz, visto_at timestamptz, hasta timestamptz, muestras int default 1);

-- Permisos de mentira, conmutables.
create table _quien (es_admin boolean, es_super boolean, empresa uuid);
insert into _quien values (true, false, '00000000-0000-0000-0000-0000000000e1');
create function tc_is_admin() returns boolean language sql as $$ select es_admin from _quien $$;
create function tc_is_superadmin() returns boolean language sql as $$ select es_super from _quien $$;
create function tc_auth_empresa_id() returns uuid language sql as $$ select empresa from _quien $$;
create function tc_puede_ver_empresa(emp uuid) returns boolean language sql as $$ select true $$;

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

\i supabase/migrations/tyrecontrol_base_habitual.sql

-- ── Datos ───────────────────────────────────────────────────────────────────
insert into tc_empresas values ('00000000-0000-0000-0000-0000000000e1', 'Plana'), ('00000000-0000-0000-0000-0000000000e2', 'Otra');
insert into tc_delegaciones (id, empresa_id, nombre, activo) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000e1', 'Vilanova', true),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000e1', 'El Vendrell', true),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000e1', 'Cerrada', false);
insert into tc_vehiculos (id, empresa_id, matricula, delegacion_id, activo) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', 'A1 claro', null, true),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000e1', 'A2 dudoso', null, true),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000e1', 'A3 sin datos', null, true),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000e1', 'A4 ya tiene', '00000000-0000-0000-0000-0000000000d2', true),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000e1', 'A5 pocas horas', null, true),
  ('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000e1', 'A6 base cerrada', null, true),
  ('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000e1', 'A7 de baja', null, false),
  ('00000000-0000-0000-0000-0000000000a8', '00000000-0000-0000-0000-0000000000e1', 'A8 abierta', null, true),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2', 'B1 otra empresa', null, true);

-- Estancia cerrada: (vehículo, base, hace N días desde, horas).
create function estancia(v text, d text, dias_atras numeric, horas numeric, estado text default 'IN_BASE') returns void
language sql as $$
  insert into tc_vehiculo_presencia_historico (empresa_id, vehiculo_id, estado, delegacion_id, desde, visto_at, hasta)
  select ve.empresa_id, ve.id, estado, nullif(d, '')::uuid,
         now() - dias_atras * interval '1 day',
         now() - dias_atras * interval '1 day' + horas * interval '1 hour',
         now() - dias_atras * interval '1 day' + horas * interval '1 hour'
    from tc_vehiculos ve where ve.id = v::uuid
$$;

-- A1: 10 noches de 10 h en Vilanova, 20 paradas de 10 min en El Vendrell.
select estancia('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d1', i, 10) from generate_series(1, 10) i;
select estancia('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', i / 2.0 + 0.5, 1.0 / 6) from generate_series(1, 20) i;
-- Y una estancia FUERA de base, que no cuenta para nada.
select estancia('00000000-0000-0000-0000-0000000000a1', '', 3.5, 8, 'OUTSIDE_BASES');
-- Y una de hace 40 días en El Vendrell de 300 h: fuera de la ventana de 30.
select estancia('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', 45, 300);
-- Y una que CRUZA el borde: empezó hace 31 días, 48 h → solo 24 dentro.
select estancia('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000d2', 31, 48);

-- A2: 5 noches en cada una.
select estancia('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d1', i, 10) from generate_series(1, 5) i;
select estancia('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000d2', i + 10, 10) from generate_series(1, 5) i;

-- A4: ya tiene El Vendrell a mano, pero el histórico dice Vilanova.
select estancia('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000d1', i, 10) from generate_series(1, 10) i;

-- A5: una sola noche de 8 h en Vilanova. Clarísimo pero sin peso.
select estancia('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000d1', 2, 8);

-- A6: todas sus noches en la base cerrada.
select estancia('00000000-0000-0000-0000-0000000000a6', '00000000-0000-0000-0000-0000000000d3', i, 10) from generate_series(1, 10) i;

-- A7: de baja, con histórico de sobra.
select estancia('00000000-0000-0000-0000-0000000000a7', '00000000-0000-0000-0000-0000000000d1', i, 10) from generate_series(1, 10) i;

-- A8: una estancia ABIERTA que empezó hace 5 días y se vio por última vez
-- hace 2: cuentan 72 h, no 120.
insert into tc_vehiculo_presencia_historico (empresa_id, vehiculo_id, estado, delegacion_id, desde, visto_at, hasta)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a8', 'IN_BASE',
        '00000000-0000-0000-0000-0000000000d1', now() - interval '5 days', now() - interval '2 days', null);

-- B1: otra empresa, con histórico en Vilanova (no debería pasar, pero por si).
select estancia('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000d1', i, 10) from generate_series(1, 10) i;

-- ── El cálculo ──────────────────────────────────────────────────────────────
do $$ declare r record; begin
  select * into r from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 30) where matricula = 'A1 claro';
  perform prueba('A1: gana Vilanova por horas aunque El Vendrell tenga más estancias', r.base_propuesta, 'Vilanova');
  perform prueba('A1: 100 h en Vilanova', r.horas, 100.0);
  perform prueba('A1: 10 estancias', r.estancias, 10);
  perform prueba('A1: la segunda es El Vendrell', r.segunda, 'El Vendrell');
  -- 20 paradas × 10 min = 3,3 h + 24 h del tramo que cruza el borde. Las 300 h de hace 45 días no.
  perform prueba('A1: la segunda suma las paradas y solo lo que cae dentro de la ventana', r.horas_segunda, 27.3);
  perform prueba('A1: decisión clara', r.decision, 'clara');
  perform prueba('A1: cuota ≈ 0,785', r.cuota, 0.785);

  select * into r from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 30) where matricula = 'A2 dudoso';
  perform prueba('A2: dudosa al 50 %', r.decision, 'dudosa');
  perform prueba('A2: cuota 0,5', r.cuota, 0.5);
  perform prueba('A2: la segunda tiene las mismas horas', r.horas_segunda, r.horas);

  select * into r from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 30) where matricula = 'A3 sin datos';
  perform prueba('A3: sin datos', r.decision, 'sin_datos');
  perform prueba('A3: sin propuesta', r.base_propuesta_id, null::uuid);

  select * into r from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 30) where matricula = 'A5 pocas horas';
  perform prueba('A5: 8 h no bastan aunque sea el 100 %', r.decision, 'dudosa');

  select * into r from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 30) where matricula = 'A6 base cerrada';
  perform prueba('A6: una base de baja no cuenta', r.decision, 'sin_datos');

  select * into r from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 30) where matricula = 'A8 abierta';
  perform prueba('A8: la abierta cuenta hasta la última muestra (72 h), no hasta ahora', r.horas, 72.0);
  perform prueba('A8: clara', r.decision, 'clara');

  perform prueba('un vehículo de baja no sale',
    (select count(*) from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 30) where matricula like 'A7%'), 0::bigint);
  perform prueba('la otra empresa no se mezcla',
    (select count(*) from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 30) where matricula like 'B1%'), 0::bigint);
  perform prueba('con ventana de 3 días A1 solo tiene 3 noches',
    (select horas from tc_base_habitual('00000000-0000-0000-0000-0000000000e1', 3) where matricula = 'A1 claro'), 30.0);
end $$;

-- ── Asignar ─────────────────────────────────────────────────────────────────
do $$ declare r jsonb; begin
  r := tc_asignar_base_habitual('00000000-0000-0000-0000-0000000000e1', 30);
  perform prueba('simula por defecto', r->>'simulacion', 'true');
  perform prueba('simulando: 2 asignables (A1 y A8)', (r->>'asignadas')::int, 2);
  perform prueba('simulando: 2 dudosas (A2 y A5)', (r->>'dudosas')::int, 2);
  perform prueba('simulando: 2 sin datos (A3 y A6)', (r->>'sin_datos')::int, 2);
  perform prueba('simulando: 1 respetada (A4 tiene otra a mano)', (r->>'respetadas')::int, 1);
  perform prueba('simulando: los cambios vienen listados', jsonb_array_length(r->'cambios'), 2);
  perform prueba('simulando: el primero es A1 de nada a Vilanova', r->'cambios'->0->>'a', 'Vilanova');
  perform prueba('simulando no escribe',
    (select count(*) from tc_vehiculos where delegacion_id is not null), 1::bigint);

  r := tc_asignar_base_habitual('00000000-0000-0000-0000-0000000000e1', 30, false, false);
  perform prueba('asigna 2', (r->>'asignadas')::int, 2);
  perform prueba('A1 queda en Vilanova',
    (select delegacion_id from tc_vehiculos where matricula = 'A1 claro'), '00000000-0000-0000-0000-0000000000d1'::uuid);
  perform prueba('A8 queda en Vilanova',
    (select delegacion_id from tc_vehiculos where matricula = 'A8 abierta'), '00000000-0000-0000-0000-0000000000d1'::uuid);
  perform prueba('A2 dudoso sigue vacío',
    (select delegacion_id from tc_vehiculos where matricula = 'A2 dudoso'), null::uuid);
  perform prueba('A4 conserva lo que se puso a mano',
    (select delegacion_id from tc_vehiculos where matricula = 'A4 ya tiene'), '00000000-0000-0000-0000-0000000000d2'::uuid);

  r := tc_asignar_base_habitual('00000000-0000-0000-0000-0000000000e1', 30, false, false);
  perform prueba('el segundo pase no cambia nada', (r->>'asignadas')::int, 0);

  r := tc_asignar_base_habitual('00000000-0000-0000-0000-0000000000e1', 30, true, true);
  perform prueba('sobrescribir (simulado): pisaría A4', r->'cambios'->0->>'matricula', 'A4 ya tiene');
  perform prueba('sobrescribir (simulado): de El Vendrell a Vilanova', r->'cambios'->0->>'de', 'El Vendrell');
  r := tc_asignar_base_habitual('00000000-0000-0000-0000-0000000000e1', 30, true, false);
  perform prueba('sobrescribir: 1 cambio', (r->>'asignadas')::int, 1);
  perform prueba('A4 pasa a Vilanova',
    (select delegacion_id from tc_vehiculos where matricula = 'A4 ya tiene'), '00000000-0000-0000-0000-0000000000d1'::uuid);
end $$;

-- ── Permisos ────────────────────────────────────────────────────────────────
update _quien set es_admin = false;
do $$ begin
  perform tc_asignar_base_habitual('00000000-0000-0000-0000-0000000000e1', 30, false, false);
  perform prueba('sin ser admin no deja', false, true);
exception when insufficient_privilege then
  perform prueba('sin ser admin no deja', true, true);
end $$;
update _quien set es_admin = true, empresa = '00000000-0000-0000-0000-0000000000e2';
do $$ begin
  perform tc_asignar_base_habitual('00000000-0000-0000-0000-0000000000e1', 30, false, false);
  perform prueba('admin de otra empresa no deja', false, true);
exception when insufficient_privilege then
  perform prueba('admin de otra empresa no deja', true, true);
end $$;
update _quien set es_super = true;
do $$ begin
  perform tc_asignar_base_habitual('00000000-0000-0000-0000-0000000000e1', 30, false, false);
  perform prueba('superadmin sí', true, true);
end $$;
