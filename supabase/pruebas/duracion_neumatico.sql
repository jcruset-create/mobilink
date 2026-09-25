\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_duracion_neumatico.sql
--
-- Lo que se comprueba es la cuenta de la vida de una goma, que es para lo que
-- se anotan los kilómetros:
--
--   · un neumático que pasó por dos vehículos suma sus dos tramos;
--   · el que está montado ahora cuenta hasta los km de HOY del vehículo;
--   · un tramo sin kilometraje NO se inventa: se cuenta aparte y se dice.
--
-- Y que el inventario inicial deja de perder los km, que es por donde se
-- escapaba la flota entera recién dada de alta.
-- ============================================================

create table tc_vehiculos (id uuid primary key default gen_random_uuid(), km_actual numeric);
create table tc_neumaticos (id uuid primary key default gen_random_uuid());
create table tc_montajes_actuales (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid references tc_vehiculos(id),
  neumatico_id uuid references tc_neumaticos(id),
  fecha_montaje date, km_montaje numeric);
create table tc_historial_montajes (
  id uuid primary key default gen_random_uuid(),
  vehiculo_id uuid, neumatico_id uuid,
  fecha_montaje date, km_montaje numeric,
  fecha_desmontaje date, km_desmontaje numeric);

-- Solo la parte de la migración que no depende de TyreControl entero: la
-- función de recorrido y la de los km del inventario.
\set QUIET on
create or replace function tc_inventario_inicial_km_montajes(p_vehiculo uuid, p_km numeric)
returns int language plpgsql as $$
declare v_tocados int;
begin
  if p_km is null or p_km <= 0 then return 0; end if;
  update tc_montajes_actuales set km_montaje = p_km
   where vehiculo_id = p_vehiculo and coalesce(km_montaje, 0) = 0;
  get diagnostics v_tocados = row_count;
  return v_tocados;
end $$;
\set QUIET off

-- La función de recorrido, tal cual está en la migración.
create or replace function tc_neumatico_recorrido(p_neumatico uuid)
returns jsonb language sql stable as $$
  with tramos as (
    select h.fecha_montaje as desde, h.fecha_desmontaje as hasta,
           h.km_montaje, h.km_desmontaje,
           case when coalesce(h.km_montaje,0) > 0 and coalesce(h.km_desmontaje,0) > 0
                then greatest(h.km_desmontaje - h.km_montaje, 0) end as km,
           false as vigente
      from tc_historial_montajes h
     where h.neumatico_id = p_neumatico
    union all
    select m.fecha_montaje, null, m.km_montaje, v.km_actual,
           case when coalesce(m.km_montaje,0) > 0 and coalesce(v.km_actual,0) > 0
                then greatest(v.km_actual - m.km_montaje, 0) end,
           true
      from tc_montajes_actuales m
      join tc_vehiculos v on v.id = m.vehiculo_id
     where m.neumatico_id = p_neumatico
  )
  select jsonb_build_object(
    'km_total', coalesce(sum(km), 0), 'tramos', count(*),
    'tramos_sin_km', count(*) filter (where km is null),
    'montado_ahora', coalesce(bool_or(vigente), false),
    'detalle', coalesce(jsonb_agg(jsonb_build_object(
      'desde', desde, 'hasta', hasta, 'km_montaje', km_montaje,
      'km_desmontaje', km_desmontaje, 'km', km, 'vigente', vigente) order by desde), '[]'::jsonb)
  ) from tramos;
$$;

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

-- ── Datos ───────────────────────────────────────────────────────────────────
insert into tc_vehiculos (id, km_actual) values
  ('00000000-0000-0000-0000-0000000000a1', 500000),   -- camión con 500.000 km
  ('00000000-0000-0000-0000-0000000000a2', 300000);
insert into tc_neumaticos (id) values
  ('00000000-0000-0000-0000-0000000000e1'),  -- pasó por dos vehículos y sigue montado
  ('00000000-0000-0000-0000-0000000000e2'),  -- un tramo sin km
  ('00000000-0000-0000-0000-0000000000e3');  -- nunca montado

-- El e1: 40.000 km en el primer vehículo, 25.000 en el segundo, y sigue.
insert into tc_historial_montajes (vehiculo_id, neumatico_id, fecha_montaje, km_montaje, fecha_desmontaje, km_desmontaje) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','2024-01-10', 100000, '2024-08-01', 140000),
  ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e1','2024-08-05', 200000, '2025-02-01', 225000);
insert into tc_montajes_actuales (vehiculo_id, neumatico_id, fecha_montaje, km_montaje) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e1','2025-02-10', 470000);

-- El e2: un tramo bueno y otro sin kilometraje.
insert into tc_historial_montajes (vehiculo_id, neumatico_id, fecha_montaje, km_montaje, fecha_desmontaje, km_desmontaje) values
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e2','2024-03-01', 120000, '2024-06-01', 150000),
  ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000e2','2024-07-01', null,   '2024-09-01', null);

-- ── La cuenta ───────────────────────────────────────────────────────────────
do $$ declare r jsonb; begin
  r := tc_neumatico_recorrido('00000000-0000-0000-0000-0000000000e1');
  -- 40.000 + 25.000 + (500.000 − 470.000) = 95.000
  perform prueba('suma los tramos de los dos vehículos y lo que lleva puesto',
                 (r->>'km_total')::numeric, 95000::numeric);
  perform prueba('cuenta los tres tramos', (r->>'tramos')::int, 3);
  perform prueba('y dice que sigue montado', (r->>'montado_ahora')::boolean, true);
  perform prueba('ninguno le falta kilometraje', (r->>'tramos_sin_km')::int, 0);
end $$;

do $$ declare r jsonb; begin
  r := tc_neumatico_recorrido('00000000-0000-0000-0000-0000000000e2');
  perform prueba('el tramo sin km NO se inventa: solo cuenta el bueno',
                 (r->>'km_total')::numeric, 30000::numeric);
  -- Esto es lo que evita leer «30.000 km» como la vida entera de la goma.
  perform prueba('y se dice que hay un tramo sin kilometraje',
                 (r->>'tramos_sin_km')::int, 1);
  perform prueba('un desmontado no figura como montado', (r->>'montado_ahora')::boolean, false);
end $$;

do $$ declare r jsonb; begin
  r := tc_neumatico_recorrido('00000000-0000-0000-0000-0000000000e3');
  perform prueba('uno que nunca se montó: cero, sin reventar', (r->>'km_total')::numeric, 0::numeric);
  perform prueba('y sin tramos', (r->>'tramos')::int, 0);
end $$;

-- Un montaje con km MAYORES que los del vehículo (dedazo en el cuadro) no
-- puede dar kilómetros negativos.
do $$ declare r jsonb; begin
  update tc_montajes_actuales set km_montaje = 600000
   where neumatico_id = '00000000-0000-0000-0000-0000000000e1';
  r := tc_neumatico_recorrido('00000000-0000-0000-0000-0000000000e1');
  perform prueba('un km de montaje mayor que el del vehículo no resta',
                 (r->>'km_total')::numeric, 65000::numeric);
  update tc_montajes_actuales set km_montaje = 470000
   where neumatico_id = '00000000-0000-0000-0000-0000000000e1';
end $$;

-- ── El inventario inicial deja de perder los km ─────────────────────────────
do $$ declare n int; v numeric; begin
  insert into tc_montajes_actuales (vehiculo_id, neumatico_id, fecha_montaje, km_montaje)
  values ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000e3','2026-01-01', null);

  n := tc_inventario_inicial_km_montajes('00000000-0000-0000-0000-0000000000a2', 300000);
  perform prueba('al cerrar el inventario, el montaje sin km se queda con los del vehículo', n, 1);

  select km_montaje into v from tc_montajes_actuales
   where neumatico_id='00000000-0000-0000-0000-0000000000e3';
  perform prueba('y son los del vehículo', v, 300000::numeric);

  -- Y ahora esa goma ya cuenta, que es de lo que se trataba.
  perform prueba('desde ese momento la goma empieza a contar',
                 (tc_neumatico_recorrido('00000000-0000-0000-0000-0000000000e3')->>'tramos')::int, 1);
end $$;

do $$ declare n int; v numeric; begin
  -- Un montaje que YA traía sus km no se pisa: los suyos son mejores.
  n := tc_inventario_inicial_km_montajes('00000000-0000-0000-0000-0000000000a1', 999999);
  perform prueba('un montaje que ya tenía km no se toca', n, 0);
  select km_montaje into v from tc_montajes_actuales
   where neumatico_id='00000000-0000-0000-0000-0000000000e1';
  perform prueba('conserva los suyos', v, 470000::numeric);

  perform prueba('sin km no hace nada', tc_inventario_inicial_km_montajes('00000000-0000-0000-0000-0000000000a1', null), 0);
end $$;
