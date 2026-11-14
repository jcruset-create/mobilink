-- ════════════════════════════════════════════════════════════════════════════
-- Los autobuses de Plana que se quedaron en «2x4», a «2X4 BUS»
-- ════════════════════════════════════════════════════════════════════════════
--
-- La flota de Plana lleva dos etiquetas para la misma cosa: 467 vehículos con
-- la configuración «2X4 BUS» y 104 con «2x4», y las dos significan lo mismo
-- —2 ruedas en el eje 1 y 4 en el eje 2—. No es un error de datos: son dos
-- filas del catálogo `tc_config_ejes` con el mismo patrón de ruedas y distinto
-- nombre, y los vehículos se dieron de alta en tandas que cayeron en una o en
-- otra (ambos grupos son del verano de 2026, del 31 de julio al 23 de
-- septiembre). El resultado es una lista de vehículos donde la misma columna
-- dice dos cosas distintas del mismo autobús.
--
-- ── Qué cambia de verdad ────────────────────────────────────────────────────
--
-- `tc_vehiculos.config_ejes_id`, y nada más. En producción solo hay dos sitios
-- donde vive ese id (`tc_vehiculos.config_ejes_id` y `tc_config_ejes_marca`),
-- así que no hay copias denormalizadas que queden descuadradas.
--
-- En concreto, lo que la configuración de ejes decide en el panel es:
--
--   · la columna «Config» de la lista de vehículos y de su ficha;
--   · qué silueta de chasis se dibuja (`tc_config_ejes.imagen_chasis_url`, y
--     la de la marca si la hay en `tc_config_ejes_marca`).
--
-- Lo que NO decide: las posiciones de neumático. Esas cuelgan del TIPO de
-- vehículo (`tc_posiciones_vehiculo.tipo_vehiculo_id`), que este script no
-- toca. Por eso los 575 montajes actuales de estos vehículos no se mueven:
-- apuntan a `posicion_id`, y ninguna posición cambia de sitio.
--
-- ── Medido antes de escribir esto ───────────────────────────────────────────
--
--   · Los dos grupos tienen el MISMO plano real: de los vehículos que tienen
--     ejes dados de alta en `tc_vehiculo_ejes`, todos dicen «1:2 2:4», con
--     «2x4» y con «2X4 BUS» igual. No hay ningún plano que se invalide.
--   · Las dos filas del catálogo tienen su silueta genérica puesta, así que
--     ninguna ficha se queda sin dibujo.
--   · «2x4» tiene además 5 siluetas por marca (Scania, Mercedes-Benz, MAN,
--     Volvo, Iveco) y «2X4 BUS» ninguna. No se pierde nada: los 104 vehículos
--     de «2x4» están TODOS sin marca, así que esas 5 nunca les aplicaron.
--   · 96 de ellos tienen neumáticos montados (575 montajes). Ninguno se toca.
--
-- ── Lo que se queda fuera, a propósito ─────────────────────────────────────
--
-- De los 104 vehículos de Plana con «2x4», 103 son del tipo `autobus` y UNO
-- no: 6777NBD, que es `camion_2_ejes` (sin marca ni modelo). Un camión con la
-- configuración «2X4 BUS» saldría con silueta de autobús en su ficha y en la
-- pantalla de cambio de neumático, así que se deja como está. Si se quiere
-- cambiar también, es esta línea:
--
--   update tc_vehiculos set config_ejes_id = '6ac2b9a4-cf17-4d32-adff-d376e89ba702'
--    where matricula = '6777NBD' and empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb';
--
-- Los 103 incluyen 2 autobuses dados de baja (`activo = false`): también
-- aparecen en la lista con su configuración, y dejarlos fuera sería dejar el
-- mismo desajuste a medias.
--
-- Es idempotente: la segunda pasada no cambia nada, porque la primera deja de
-- cumplirse `config_ejes_id = '2x4'`.

-- ── Antes: qué se va a tocar ────────────────────────────────────────────────
select count(*) as se_van_a_cambiar            -- tiene que dar 103
  from tc_vehiculos v
  join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
 where v.empresa_id    = 'a51c9662-4b6f-4681-8e2b-599e109659eb'
   and v.config_ejes_id = '13d2691f-2e4e-46db-8c82-369ac90bdcf2'   -- 2x4
   and t.nombre         = 'autobus';

-- ── El cambio ───────────────────────────────────────────────────────────────
update tc_vehiculos v
   set config_ejes_id = '6ac2b9a4-cf17-4d32-adff-d376e89ba702'     -- 2X4 BUS
 where v.empresa_id    = 'a51c9662-4b6f-4681-8e2b-599e109659eb'    -- Plana
   and v.config_ejes_id = '13d2691f-2e4e-46db-8c82-369ac90bdcf2'   -- 2x4
   -- Solo autobuses: ver arriba lo de 6777NBD.
   and exists (select 1 from tc_tipos_vehiculo t
                where t.id = v.tipo_vehiculo_id and t.nombre = 'autobus');

-- ── Después: cómo queda la flota de Plana ───────────────────────────────────
select coalesce(ce.nombre, '(sin configuración)') as configuracion,
       count(*) as vehiculos
  from tc_vehiculos v
  left join tc_config_ejes ce on ce.id = v.config_ejes_id
 where v.empresa_id = 'a51c9662-4b6f-4681-8e2b-599e109659eb'
 group by 1
 order by 2 desc;
-- «2X4 BUS» tiene que pasar de 467 a 570, y «2x4» de 104 a 1 —el camión—.
