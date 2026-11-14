-- ════════════════════════════════════════════════════════════════════════════
-- Los autocares de Plana que decían «2x4x2», a «2x4x2 Bus»
-- ════════════════════════════════════════════════════════════════════════════
--
-- El mismo caso que `2x4-bus-en-plana.sql` y la misma causa: el catálogo tiene
-- dos filas para el mismo patrón de ruedas —2, 4 y 2— y los vehículos se
-- dieron de alta en tandas que cayeron en una o en otra. 98 autocares con
-- «2x4x2 Bus» y 12 con «2x4x2», y la lista dice dos cosas distintas del mismo
-- autocar.
--
-- Éste sale más limpio que el de los autobuses: los 12 son del tipo `autocar`,
-- así que no hay ningún camión colado entre ellos al que haya que dejar fuera.
--
-- ── Qué cambia, y qué no ────────────────────────────────────────────────────
--
-- `tc_vehiculos.config_ejes_id`, y nada más: la columna «Config» de la lista y
-- de la ficha, y qué silueta de chasis se dibuja. Las posiciones de neumático
-- cuelgan del TIPO de vehículo y no de esto, así que los 88 montajes actuales
-- de estos 12 autocares no se mueven.
--
-- Medido antes de escribirlo:
--
--   · ninguno de los 110 vehículos —ni los 12 ni los 98— tiene ejes dados de
--     alta en `tc_vehiculo_ejes`, así que no hay ningún plano que se invalide;
--   · las dos filas del catálogo tienen su silueta genérica puesta y NINGUNA
--     tiene siluetas por marca, así que no se pierde ningún dibujo —en el de
--     los autobuses había 5 que no aplicaban; aquí no hay ninguna—;
--   · 11 de los 12 tienen neumáticos montados (88 montajes). Ninguno se toca.
--
-- ── Lo que se queda fuera ───────────────────────────────────────────────────
--
-- Hay un 13.º vehículo con «2x4x2» que NO es de Plana: 2222ABC, un
-- `camion_3_ejes` de otra empresa. El filtro por empresa lo deja donde está, y
-- además es lo que debe ser: un camión no lleva silueta de autocar.
--
-- Es idempotente: la segunda pasada no cambia nada.

-- ── Antes: qué se va a tocar ────────────────────────────────────────────────
select count(*) as se_van_a_cambiar            -- tiene que dar 12
  from tc_vehiculos v
 where v.empresa_id     = 'a51c9662-4b6f-4681-8e2b-599e109659eb'
   and v.config_ejes_id = '0c845e70-896d-4c0e-bd7d-a53f0d37f85a';   -- 2x4x2

-- ── El cambio ───────────────────────────────────────────────────────────────
update tc_vehiculos v
   set config_ejes_id = 'e9e16460-efb7-48c2-9c0b-4294ae373e57'      -- 2x4x2 Bus
 where v.empresa_id     = 'a51c9662-4b6f-4681-8e2b-599e109659eb'    -- Plana
   and v.config_ejes_id = '0c845e70-896d-4c0e-bd7d-a53f0d37f85a';   -- 2x4x2

-- ── Después: cómo queda la flota de Plana ───────────────────────────────────
select coalesce(ce.nombre, '(sin configuración)') as configuracion,
       count(*) as vehiculos
  from tc_vehiculos v
  left join tc_config_ejes ce on ce.id = v.config_ejes_id
 where v.empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb'
 group by 1
 order by 2 desc;
-- «2x4x2 Bus» tiene que pasar de 98 a 110, y «2x4x2» desaparecer de la lista.
