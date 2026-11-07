-- ════════════════════════════════════════════════════════════════════════════
-- El bastidor que ya teníamos, puesto donde se busca
-- ════════════════════════════════════════════════════════════════════════════
--
-- 805 vehículos de Plana tienen `tc_vehiculos.bastidor` vacío, y de 682 de
-- ellos SÍ sabemos el bastidor: el centro técnico lo apunta en cada
-- intervención de tacógrafo (campo E23 del impreso) y está en
-- `tc_tacografo_intervenciones.bastidor_origen` desde que se importó su
-- informe. O sea que el dato estaba en el sistema y la ficha enseñaba un
-- guion.
--
-- ── Por qué se puede hacer sin preguntar uno a uno ──────────────────────────
--
-- Porque los datos no dejan ninguna duda. Medido antes de escribir esto:
--
--   · 0 vehículos cuyas intervenciones digan DOS bastidores distintos;
--   · 0 vehículos cuyo bastidor actual discrepe del que dice el tacógrafo
--     (hay 2 que lo tienen y en los 2 coincide);
--   · los 723 bastidores distintos miden EXACTAMENTE 17 caracteres, que es
--     lo que mide un VIN.
--
-- No hay ningún empate que desatascar ni ninguna contradicción que arbitrar.
-- Si algún día la hubiera, este script no la tocaría: ver los filtros.
--
-- ── Lo que NO hace ──────────────────────────────────────────────────────────
--
-- · No pisa ningún bastidor que ya esté puesto. Si alguien lo escribió a
--   mano, manda lo suyo: este dato lo pusieron mirando el vehículo, y el del
--   impreso lo tecleó otra persona en otro sitio.
-- · No toca los vehículos cuyas intervenciones no se pongan de acuerdo.
-- · No inventa un bastidor que no mida 17 caracteres.
--
-- Es idempotente: pasarlo dos veces no cambia nada la segunda vez, porque la
-- primera deja de cumplirse `bastidor is null`.

-- ── Antes: qué se va a tocar ────────────────────────────────────────────────
select count(*) as se_van_a_rellenar
  from tc_vehiculos v
 where (v.bastidor is null or v.bastidor = '')
   and exists (
     select 1 from tc_tacografo_intervenciones i
      where i.vehiculo_id = v.id and length(i.bastidor_origen) = 17);

-- ── El relleno ──────────────────────────────────────────────────────────────
update tc_vehiculos v
   set bastidor = b.uno
  from (
    select i.vehiculo_id,
           min(i.bastidor_origen) as uno,
           count(distinct i.bastidor_origen) as cuantos
      from tc_tacografo_intervenciones i
     where i.vehiculo_id is not null
       and length(i.bastidor_origen) = 17
     group by i.vehiculo_id
  ) b
 where b.vehiculo_id = v.id
   -- Uno solo: si sus intervenciones dicen dos bastidores distintos, eso hay
   -- que mirarlo, no promediarlo.
   and b.cuantos = 1
   -- Y solo donde falta: lo que ya está puesto no se pisa.
   and (v.bastidor is null or v.bastidor = '');

-- ── Después: lo que queda sin bastidor y por qué ────────────────────────────
select
  (select count(*) from tc_vehiculos where bastidor is null or bastidor = '')
    as siguen_sin_bastidor,
  (select count(*) from tc_vehiculos v
    where (v.bastidor is null or v.bastidor = '')
      and exists (select 1 from tc_tacografo_intervenciones i
                   where i.vehiculo_id = v.id and length(i.bastidor_origen) = 17))
    as se_podrian_rellenar_todavia;   -- tiene que dar 0
