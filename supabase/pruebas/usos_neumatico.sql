\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_usos_neumatico.sql
--
-- Lo que se vigila es el REPARTO: que cada uno de los textos que hay de verdad
-- en el catálogo acabe donde debe. Los casos no son inventados; están sacados
-- de las migraciones de catálogo cargadas (Bridgestone, Michelin, Continental…).
--
-- Y sobre todo los tres que rompen el orden alfabético de las reglas:
--   · «Winter regional» es INVIERNO, no regional;
--   · «Mixed on/off road / Construction» es MIXTO —habla de carretera Y de
--     obra—, y «obra» queda para el que solo habla de obra;
--   · «Long haul / Regional» es LARGA DISTANCIA, que es lo que manda.
-- ============================================================

do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create or replace function tc_is_superadmin() returns boolean language sql stable as $$ select true $$;
create or replace function tc_is_admin() returns boolean language sql stable as $$ select true $$;

create table tc_cat_marcas_neumatico (id uuid primary key default gen_random_uuid(), nombre text);
create table tc_cat_modelos_neumatico (
  id uuid primary key default gen_random_uuid(),
  marca_id uuid references tc_cat_marcas_neumatico(id),
  nombre text not null,
  eje_recomendado text,
  aplicacion text);

insert into tc_cat_marcas_neumatico (id, nombre)
  values ('00000000-0000-0000-0000-000000000b11'::uuid, 'Bridgestone');

-- Los textos reales del catálogo, con lo que debería salir de cada uno.
create table esperado (texto text primary key, codigo text);
insert into esperado values
  ('Larga distancia / autopista',        'larga_distancia'),
  ('Long haul',                          'larga_distancia'),
  ('Long haul / Regional',               'larga_distancia'),
  ('Larga distancia autocar',            'larga_distancia'),
  ('Regional',                           'regional'),
  ('Regional / versátil',                'mixto'),
  ('Regional / Aggressive',              'regional'),
  ('Urbano',                             'urbano'),
  ('On-road / On-off road',              'mixto'),
  ('Mixed on/off road / Construction',   'mixto'),
  ('Cantera / obra',                     'obra'),
  ('Construction',                       'obra'),
  ('Mixto moderado carretera/obra',      'mixto'),
  ('Winter regional / interregional',    'invierno');

insert into tc_cat_modelos_neumatico (marca_id, nombre, aplicacion)
  select '00000000-0000-0000-0000-000000000b11'::uuid, 'M-' || texto, texto from esperado;

-- Un modelo sin aplicación y otro con un texto que no se parece a nada.
insert into tc_cat_modelos_neumatico (marca_id, nombre, aplicacion) values
  ('00000000-0000-0000-0000-000000000b11'::uuid, 'SIN-APLICACION', null),
  ('00000000-0000-0000-0000-000000000b11'::uuid, 'RARO', 'Tracción forestal especial');

\ir ../migrations/tyrecontrol_usos_neumatico.sql
-- Segunda pasada: tiene que ser idempotente, y no debe reclasificar lo ya hecho.
\ir ../migrations/tyrecontrol_usos_neumatico.sql

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

-- ── Las listas ──────────────────────────────────────────────────────────────
do $$ declare n int; begin
  select count(*) into n from tc_cat_ejes_neumatico;
  perform prueba('los cuatro ejes están', n, 4);
  select count(*) into n from tc_cat_aplicaciones_neumatico;
  perform prueba('los siete tipos de uso están', n, 7);
  select count(*) into n from tc_cat_ejes_neumatico where codigo='direccion' and nombre='Dirección';
  perform prueba('el eje lleva su nombre para enseñar', n, 1);
end $$;

-- ── EL REPARTO, caso por caso ───────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select * from esperado loop
    perform prueba(
      format('«%s» → %s', r.texto, r.codigo),
      (select aplicacion from tc_cat_modelos_neumatico where nombre = 'M-' || r.texto),
      r.codigo);
  end loop;
end $$;

-- ── Lo que no encaja se queda quieto y se enseña ────────────────────────────
do $$ declare v text; n int; begin
  select aplicacion into v from tc_cat_modelos_neumatico where nombre='RARO';
  perform prueba('lo que no encaja conserva su texto', v, 'Tracción forestal especial');

  select count(*) into n from tc_modelos_aplicacion_sin_clasificar where nombre='RARO';
  perform prueba('y sale en la lista de sin clasificar', n, 1);

  select count(*) into n from tc_modelos_aplicacion_sin_clasificar where nombre='M-Regional';
  perform prueba('lo que sí encajó NO sale en esa lista', n, 0);

  select aplicacion into v from tc_cat_modelos_neumatico where nombre='SIN-APLICACION';
  perform prueba('un modelo sin aplicación sigue sin ella: no se le inventa una', v, null);
end $$;

-- ── El texto original no se pierde ──────────────────────────────────────────
do $$ declare v text; n int; begin
  select aplicacion_original into v from tc_cat_modelos_neumatico where nombre='M-Long haul / Regional';
  perform prueba('se guarda el texto original por si el reparto se equivoca', v, 'Long haul / Regional');

  select count(*) into n from tc_cat_modelos_neumatico
   where aplicacion is not null and aplicacion_original is null;
  perform prueba('ningún modelo clasificado se quedó sin su original', n, 0);
end $$;

-- ── Volver a pasarla no vuelve a repartir ───────────────────────────────────
--
-- Importa porque `regional` (el código) contiene «regional» y la regla lo
-- volvería a coger; si no se excluyera lo ya normalizado, una segunda pasada
-- podría moverlo a otro sitio.
do $$ declare v text; begin
  update tc_cat_modelos_neumatico set aplicacion='invierno' where nombre='M-Regional';
  perform 1;
end $$;
\ir ../migrations/tyrecontrol_usos_neumatico.sql
do $$ declare v text; begin
  select aplicacion into v from tc_cat_modelos_neumatico where nombre='M-Regional';
  perform prueba('un código ya asignado a mano no se vuelve a repartir', v, 'invierno');
end $$;
