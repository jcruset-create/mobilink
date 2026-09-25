\set ON_ERROR_STOP on
-- ⛔ ESTO NO ES UNA MIGRACIÓN. NO LO PEGUES EN SUPABASE.
do $$ begin
  if exists (select 1 from pg_tables where schemaname='public' and tablename='tc_vehiculos') then
    raise exception 'ESTE FICHERO NO ES UNA MIGRACIÓN: banco desechable y esta base ya tiene TyreControl.';
  end if;
end $$;

-- ============================================================
-- Banco para tyrecontrol_tipos_cuadrar_ruedas.sql
--
-- Lo que se comprueba:
--   · la etiqueta se lee bien y, cuando no se entiende, no se inventa nada;
--   · manda el PLANO: si un tipo tiene posiciones, sus ejes y ruedas salen
--     de ahí, que es lo que se ve en la tablet;
--   · un tipo sin plano se cuadra con su etiqueta;
--   · lo que no cuadra entre etiqueta y plano NO se toca: se lista;
--   · pasarlo dos veces no cambia nada.
-- ============================================================

create table tc_tipos_vehiculo (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique, descripcion text,
  numero_ejes int not null default 2, numero_ruedas int not null default 4,
  configuracion_ejes text, activo boolean not null default true);
create table tc_posiciones_vehiculo (
  id uuid primary key default gen_random_uuid(),
  tipo_vehiculo_id uuid references tc_tipos_vehiculo(id),
  codigo_posicion text, eje int, activo boolean not null default true);

create or replace function prueba(nombre text, obtenido anyelement, espera anyelement) returns void
language plpgsql as $$ begin
  if obtenido is not distinct from espera then raise notice 'PASA · %', nombre;
  else raise notice 'FALLA · % → esperaba %, dio %', nombre, espera, obtenido; end if;
end $$;

-- ── Datos: los tipos reales, con los números viejos de la semilla ───────────
insert into tc_tipos_vehiculo (id, nombre, descripcion, numero_ejes, numero_ruedas, configuracion_ejes) values
  -- Camión 3 ejes: la semilla dijo 10 ruedas, su plano tiene 8 (2x4x2).
  ('00000000-0000-0000-0000-00000000c300','camion_3_ejes','Camión 3 ejes',3,10,'2x4x2'),
  -- Tractora: plano de 10 y etiqueta de 10. Ya cuadra, no debe moverse.
  ('00000000-0000-0000-0000-00000000c301','tractora','Cabeza tractora',3,10,'2x4x4'),
  -- Remolque: sin etiqueta y sin plano. No hay de dónde sacarlo: no se toca.
  ('00000000-0000-0000-0000-00000000c302','remolque','Remolque',2,8,null),
  -- Autocar gemelos: etiqueta buena, plano todavía sin generar.
  ('00000000-0000-0000-0000-00000000c303','autocar_2x4x4','Autocar 3 ejes gemelos',3,99,'2x4x4'),
  -- Etiqueta que no se entiende y sin plano: se queda como está.
  ('00000000-0000-0000-0000-00000000c304','raro','Tipo raro',2,4,'tridem'),
  -- Descuadrado de verdad: etiqueta de 8 y plano de 10.
  ('00000000-0000-0000-0000-00000000c305','descuadrado','Descuadrado',3,10,'2x4x2');

-- Planos: camion_3_ejes 8 ruedas en 3 ejes; tractora 10 en 3; descuadrado 10 en 3.
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje)
select '00000000-0000-0000-0000-00000000c300', 'P'||i, case when i<=2 then 1 when i<=6 then 2 else 3 end
  from generate_series(1,8) i;
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje)
select '00000000-0000-0000-0000-00000000c301', 'P'||i, case when i<=2 then 1 when i<=6 then 2 else 3 end
  from generate_series(1,10) i;
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje)
select '00000000-0000-0000-0000-00000000c305', 'P'||i, case when i<=2 then 1 when i<=6 then 2 else 3 end
  from generate_series(1,10) i;
-- Una posición desactivada no cuenta: se quitó del plano a propósito.
insert into tc_posiciones_vehiculo (tipo_vehiculo_id, codigo_posicion, eje, activo)
values ('00000000-0000-0000-0000-00000000c300','PX', 3, false);

\i supabase/migrations/tyrecontrol_tipos_cuadrar_ruedas.sql

-- ── La etiqueta ─────────────────────────────────────────────────────────────
do $$ begin
  perform prueba('2x4x2 son tres ejes de 2, 4 y 2', tc_ruedas_de_configuracion('2x4x2'), array[2,4,2]);
  perform prueba('la X mayúscula vale igual',        tc_ruedas_de_configuracion('2X4X4'), array[2,4,4]);
  perform prueba('con espacios también',             tc_ruedas_de_configuracion('  2x2  '), array[2,2]);
  perform prueba('«tridem» no se entiende',          tc_ruedas_de_configuracion('tridem'), null::int[]);
  perform prueba('con guiones tampoco',              tc_ruedas_de_configuracion('2-4-2'), null::int[]);
  perform prueba('un eje de 6 no se dibuja',         tc_ruedas_de_configuracion('2x6x2'), null::int[]);
  perform prueba('sin etiqueta, nada',               tc_ruedas_de_configuracion(null), null::int[]);
  perform prueba('vacía, nada',                      tc_ruedas_de_configuracion('   '), null::int[]);
end $$;

-- ── Manda el plano ──────────────────────────────────────────────────────────
do $$ declare e int; r int; begin
  select numero_ejes, numero_ruedas into e, r from tc_tipos_vehiculo where nombre='camion_3_ejes';
  perform prueba('camión 3 ejes: sigue teniendo 3 ejes', e, 3);
  perform prueba('camión 3 ejes: pasa de 10 ruedas a las 8 de su plano', r, 8);

  select numero_ejes, numero_ruedas into e, r from tc_tipos_vehiculo where nombre='tractora';
  perform prueba('tractora: ya cuadraba, se queda en 10', r, 10);
  perform prueba('tractora: y en 3 ejes', e, 3);
end $$;

-- ── Sin plano, manda la etiqueta ────────────────────────────────────────────
do $$ declare e int; r int; begin
  select numero_ejes, numero_ruedas into e, r from tc_tipos_vehiculo where nombre='autocar_2x4x4';
  perform prueba('autocar gemelos: sin plano todavía, lo dice su etiqueta', r, 10);
  perform prueba('autocar gemelos: y son 3 ejes', e, 3);

  select numero_ejes, numero_ruedas into e, r from tc_tipos_vehiculo where nombre='remolque';
  perform prueba('remolque: sin etiqueta y sin plano, no se inventa nada', r, 8);

  select numero_ruedas into r from tc_tipos_vehiculo where nombre='raro';
  perform prueba('etiqueta que no se entiende: tampoco se toca', r, 4);
end $$;

-- ── Lo que no cuadra se lista, no se pisa ───────────────────────────────────
do $$ declare n int; v record; begin
  select count(*) into n from tc_tipos_plano_descuadrado;
  perform prueba('solo sale el que de verdad no cuadra', n, 1);

  select * into v from tc_tipos_plano_descuadrado;
  perform prueba('y es el descuadrado', v.nombre, 'descuadrado');
  perform prueba('la etiqueta decía 8', v.ruedas_segun_la_etiqueta, 8);
  perform prueba('el plano tiene 10', v.ruedas_en_el_plano, 10);

  select numero_ruedas into n from tc_tipos_vehiculo where nombre='descuadrado';
  perform prueba('su número sale del plano, que es lo que se ve en la tablet', n, 10);
end $$;

-- ── Pasarlo dos veces no cambia nada ────────────────────────────────────────
do $$ declare antes text; despues text; begin
  select string_agg(nombre||':'||numero_ejes||'/'||numero_ruedas, ',' order by nombre)
    into antes from tc_tipos_vehiculo;
  perform 1;
  execute 'with plano as (select tipo_vehiculo_id, count(*)::int ruedas, count(distinct eje)::int ejes
             from tc_posiciones_vehiculo where activo and eje is not null group by 1)
           update tc_tipos_vehiculo t set numero_ejes = p.ejes, numero_ruedas = p.ruedas
             from plano p where p.tipo_vehiculo_id = t.id
              and (t.numero_ejes, t.numero_ruedas) is distinct from (p.ejes, p.ruedas)';
  select string_agg(nombre||':'||numero_ejes||'/'||numero_ruedas, ',' order by nombre)
    into despues from tc_tipos_vehiculo;
  perform prueba('el segundo pase deja todo igual', despues, antes);
end $$;
