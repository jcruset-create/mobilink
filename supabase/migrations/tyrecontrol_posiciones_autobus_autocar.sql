-- ============================================================
-- SEA TyreControl — Posiciones de Autobús y Autocar
--
-- La semilla de la Fase 3 creó los tipos 'autobus' y 'autocar' pero solo
-- sembró las posiciones de turismo, furgoneta, camion_2_ejes y tractora. Un
-- tipo sin posiciones no puede revisarse: al importar revisiones cae en
-- "sin posiciones" y en la APK no hay dónde pinchar.
--
--   · autobus  → 2x4   (2 ejes: 2 + 4 ruedas gemelas atrás)   6 posiciones
--   · autocar  → 2x4x2 (3 ejes: 2 + 4 gemelas + 2 del eje de arrastre) 8
--
-- Las posiciones, los códigos, el orden y las coordenadas salen calcados de
-- server/tyrecontrol/posicionesDesdeConfig.ts, que es lo que genera el botón
-- "Generar posiciones" del panel. Así un tipo sembrado aquí y uno generado
-- desde el panel quedan idénticos.
--
-- La semilla decía que el autocar tenía 10 ruedas: eso es un camión de 3
-- ejes con las dos traseras gemelas. Un autocar de 3 ejes lleva 8 (el eje de
-- arrastre es de rueda simple), y es lo que se ve en las revisiones reales.
--
-- Pegar en Supabase (SQL Editor). Idempotente: solo añade lo que falta y no
-- toca ninguna posición existente ni sus coordenadas ya calibradas a mano.
-- ============================================================

-- ── 1. Configuración de ejes y recuento de ruedas ─────────────
update tc_tipos_vehiculo
   set configuracion_ejes = '2x4', numero_ejes = 2, numero_ruedas = 6
 where nombre = 'autobus'
   and configuracion_ejes is distinct from '2x4';

update tc_tipos_vehiculo
   set configuracion_ejes = '2x4x2', numero_ejes = 3, numero_ruedas = 8
 where nombre = 'autocar'
   and configuracion_ejes is distinct from '2x4x2';

-- ── 2. Posiciones ─────────────────────────────────────────────
-- pos_x/pos_y son porcentajes del plano: el chasis ocupa la banda central
-- (28–72) y a cada lado caben dos recuadros de 14. Los ejes se reparten en
-- vertical entre el 10 % y el 76 %.
insert into tc_posiciones_vehiculo (
  tipo_vehiculo_id, codigo_posicion, nombre, eje, lado, interior_exterior,
  orden_visual, pos_x, pos_y, pos_w, pos_h, activo)
select t.id, v.codigo, v.nombre, v.eje, v.lado, v.io, v.orden, v.x, v.y, 14, 14, true
from tc_tipos_vehiculo t
join (values
  ('E1_IZQ',    'Eje 1 izquierda',     1, 'izq', null,  1,  7.0, 10.0),
  ('E1_DER',    'Eje 1 derecha',       1, 'der', null,  2, 79.0, 10.0),
  ('E2_IZQ_EXT','Eje 2 izq. exterior', 2, 'izq', 'ext', 3,  0.0, 76.0),
  ('E2_IZQ_INT','Eje 2 izq. interior', 2, 'izq', 'int', 4, 14.0, 76.0),
  ('E2_DER_INT','Eje 2 der. interior', 2, 'der', 'int', 5, 72.0, 76.0),
  ('E2_DER_EXT','Eje 2 der. exterior', 2, 'der', 'ext', 6, 86.0, 76.0)
) as v(codigo, nombre, eje, lado, io, orden, x, y) on true
where t.nombre = 'autobus'
  -- Si alguien ya le montó el plano a mano con otra nomenclatura (DEL_IZQ,
  -- R1…), no se toca: añadir los códigos E1_* le duplicaría las ruedas, y eso
  -- es mucho peor que dejarlo como está.
  and not exists (
    select 1 from tc_posiciones_vehiculo p
     where p.tipo_vehiculo_id = t.id
       and p.codigo_posicion not in ('E1_IZQ','E1_DER','E2_IZQ_EXT','E2_IZQ_INT','E2_DER_INT','E2_DER_EXT'))
on conflict (tipo_vehiculo_id, codigo_posicion) do nothing;

insert into tc_posiciones_vehiculo (
  tipo_vehiculo_id, codigo_posicion, nombre, eje, lado, interior_exterior,
  orden_visual, pos_x, pos_y, pos_w, pos_h, activo)
select t.id, v.codigo, v.nombre, v.eje, v.lado, v.io, v.orden, v.x, v.y, 14, 14, true
from tc_tipos_vehiculo t
join (values
  ('E1_IZQ',    'Eje 1 izquierda',     1, 'izq', null,  1,  7.0, 10.0),
  ('E1_DER',    'Eje 1 derecha',       1, 'der', null,  2, 79.0, 10.0),
  ('E2_IZQ_EXT','Eje 2 izq. exterior', 2, 'izq', 'ext', 3,  0.0, 43.0),
  ('E2_IZQ_INT','Eje 2 izq. interior', 2, 'izq', 'int', 4, 14.0, 43.0),
  ('E2_DER_INT','Eje 2 der. interior', 2, 'der', 'int', 5, 72.0, 43.0),
  ('E2_DER_EXT','Eje 2 der. exterior', 2, 'der', 'ext', 6, 86.0, 43.0),
  ('E3_IZQ',    'Eje 3 izquierda',     3, 'izq', null,  7,  7.0, 76.0),
  ('E3_DER',    'Eje 3 derecha',       3, 'der', null,  8, 79.0, 76.0)
) as v(codigo, nombre, eje, lado, io, orden, x, y) on true
where t.nombre = 'autocar'
  and not exists (
    select 1 from tc_posiciones_vehiculo p
     where p.tipo_vehiculo_id = t.id
       and p.codigo_posicion not in ('E1_IZQ','E1_DER','E2_IZQ_EXT','E2_IZQ_INT',
                                     'E2_DER_INT','E2_DER_EXT','E3_IZQ','E3_DER'))
on conflict (tipo_vehiculo_id, codigo_posicion) do nothing;

-- ── 3. Comprobación ───────────────────────────────────────────
do $$
declare
  n_bus int; n_car int; v_bus text; v_car text;
begin
  select count(*), max(configuracion_ejes) into n_bus, v_bus
    from tc_posiciones_vehiculo p
    join tc_tipos_vehiculo t on t.id = p.tipo_vehiculo_id
   where t.nombre = 'autobus' and p.activo;

  select count(*), max(configuracion_ejes) into n_car, v_car
    from tc_posiciones_vehiculo p
    join tc_tipos_vehiculo t on t.id = p.tipo_vehiculo_id
   where t.nombre = 'autocar' and p.activo;

  -- Quedarse corto solo se acepta si el tipo ya traía un plano propio con
  -- otra nomenclatura y por eso no se ha sembrado: entonces se avisa, porque
  -- hay que revisarlo a mano, pero no se aborta.
  if n_bus < 6 then
    if exists (select 1 from tc_posiciones_vehiculo p
                 join tc_tipos_vehiculo t on t.id = p.tipo_vehiculo_id
                where t.nombre = 'autobus'
                  and p.codigo_posicion not like 'E%') then
      raise warning 'Autobús ya tenía un plano propio (% posiciones): revísalo a mano', n_bus;
    else
      raise exception 'Autobús se ha quedado con % posiciones (esperadas 6)', n_bus;
    end if;
  end if;
  if n_car < 8 then
    if exists (select 1 from tc_posiciones_vehiculo p
                 join tc_tipos_vehiculo t on t.id = p.tipo_vehiculo_id
                where t.nombre = 'autocar'
                  and p.codigo_posicion not like 'E%') then
      raise warning 'Autocar ya tenía un plano propio (% posiciones): revísalo a mano', n_car;
    else
      raise exception 'Autocar se ha quedado con % posiciones (esperadas 8)', n_car;
    end if;
  end if;

  -- El orden visual es lo que empareja "posición 3" del Excel con el eje 2
  -- izquierdo exterior. Si hubiera huecos o repetidos, la importación de
  -- revisiones colocaría los neumáticos en la rueda equivocada.
  if exists (
    select 1 from tc_tipos_vehiculo t
    where t.nombre in ('autobus', 'autocar')
      and (select count(distinct p.orden_visual) from tc_posiciones_vehiculo p
            where p.tipo_vehiculo_id = t.id and p.activo)
        <> (select count(*) from tc_posiciones_vehiculo p
             where p.tipo_vehiculo_id = t.id and p.activo)
  ) then
    raise exception 'Hay posiciones con el mismo orden_visual en autobús o autocar';
  end if;

  raise notice 'OK: autobús % (% posiciones), autocar % (% posiciones)',
    v_bus, n_bus, v_car, n_car;
end $$;
