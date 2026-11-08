-- ════════════════════════════════════════════════════════════════════════════
-- SEA TyreControl — El desgaste, medido sobre la goma que está puesta
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tres cosas, y la primera es la que explica las otras dos:
--
--   1. `tc_mediciones_tramo`  — nueva. Parte el historial de cada neumático en
--      TRAMOS: una goma viviendo en un sitio, de punta a punta.
--   2. `tc_informes_km_por_mm` — reescrita encima de la anterior. Mismo
--      resultado, misma firma; lo que cambia es que ya no lleva su propia copia
--      del corte.
--   3. `tc_informes_desgaste`  — reescrita de verdad. Ver abajo.
--
-- ── Por qué existe `tc_mediciones_tramo` ────────────────────────────────────
--
-- Porque el corte estaba escrito dos veces y ese es exactamente el sitio donde
-- dos informes acaban contestando cosas distintas del mismo desgaste. Ahora el
-- corte vive en UNA función, los dos informes la usan, y cuando haya que
-- afinarlo se afina en un sitio.
--
-- El corte: empieza un tramo nuevo cuando el neumático cambia de vehículo
-- —el odómetro es otro—, cuando el dibujo SUBE más de `p_salto` —eso no es
-- desgaste, es otra goma en el mismo hueco— o cuando el odómetro va hacia
-- atrás. La justificación medida está en la cabecera de la migración
-- `tyrecontrol_informes_km_por_mm.sql` y no se repite aquí.
--
-- ── El tope de plausibilidad, y por qué hizo falta ──────────────────────────
--
-- El corte de 2 mm no pilla TODAS las sustituciones: si a un autobús le quitan
-- una goma con 7 mm y le ponen otra usada con 8, el dibujo sube 1 mm y la serie
-- sigue como si nada. El resultado son tramos imposibles, y están en los datos:
-- hay tramos de 695.236 km con 2,4 mm gastados —290.000 km por milímetro— que
-- no son un neumático eterno, son dos o tres neumáticos seguidos.
--
-- Medido sobre los 947 tramos buenos de la flota: la mediana está en 8.276
-- km/mm y el percentil 95 en 44.962, pero el 99 se va a 256.764 y el máximo a
-- 2.727.948. La cola no es una distribución, es basura.
--
-- Y hacen daño justo donde más: esos 40 tramos aportan casi 5 millones de
-- kilómetros al numerador y apenas milímetros al denominador. Quitándolos, el
-- AH51 pasa de 8.682 a 7.234 km/mm y el Dunlop SP346 de 31.401 a 12.891.
--
-- `p_max_km_por_mm` (50.000 por defecto) tira el tramo que implique más. Es
-- deliberadamente generoso: con 13 mm útiles, 50.000 km/mm serían 650.000 km de
-- vida, que ningún neumático de autobús hace. Lo que cae por ahí no es un
-- neumático bueno, es un cambio sin registrar.
--
-- ── Qué le pasaba a `tc_informes_desgaste` ──────────────────────────────────
--
-- Calculaba el ritmo con la primera medición del historial y la última, sin
-- preguntarse si entre medias había cambiado la goma. Medido sobre las 2.563
-- gomas que hoy están montadas y tienen mediciones:
--
--   · 677 (el 26 %) tienen MÁS DE UN TRAMO, o sea una sustitución que nadie
--     registró;
--   · de ésas, 411 se quedaban SIN PREDICCIÓN, en silencio: la resta daba cero
--     o negativo y la función devolvía null;
--   · y las otras 266 recibían un ritmo DEMASIADO OPTIMISTA, que es peor que no
--     tener ninguno: el desgaste de dos vidas repartido entre los kilómetros de
--     las dos da un neumático que parece durar el doble.
--
-- Ahora se mide sobre el ÚLTIMO tramo, que es la goma que está puesta hoy.
--
-- ── El ritmo prestado, y por qué hace falta ─────────────────────────────────
--
-- De esas 2.563 gomas, solo 679 llevan ya `p_min_km` rodados y medidos en su
-- vida actual. A las otras 1.884 no se les puede medir el ritmo propio sin
-- inventarlo: entre dos revisiones pasan 305 km y el ruido de medida es de
-- ±0,6 mm, así que un ritmo sacado de 2.000 km es ruido con unidades.
--
-- Para ésas se usa el ritmo de su MODELO Y EJE, que es justo lo que calcula
-- `tc_informes_km_por_mm` con todas las gomas iguales de la flota. No es una
-- estimación peor disfrazada de medición: la columna `origen_ritmo` dice
-- «neumatico» o «modelo» en cada fila, y la pantalla lo enseña. Un informe que
-- no distingue lo que ha medido de lo que ha supuesto no sirve para decidir.
--
-- ── Y solo las que están montadas ───────────────────────────────────────────
--
-- Una predicción de sustitución de un neumático que ya se retiró no es un dato,
-- es ruido en una lista que alguien tiene que leer. Se exige que la goma esté
-- hoy en `tc_montajes_actuales`, que se lee y no se toca.
--
-- Fuera también el `limit 200`: con él, los contadores de «vencidos» y «en 60
-- días» de la pantalla contaban sobre un recorte y no sobre la flota.

-- ════════════════════════════════════════════════════════════════════════════
-- 1 · Las mediciones, cada una con el tramo al que pertenece
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.tc_mediciones_tramo(
  p_empresa uuid default null,
  p_salto   numeric default 2.0
)
returns table(
  neumatico_id uuid, marca text, modelo text, medida text, empresa_id uuid,
  vehiculo_id uuid, eje int, fecha date, km numeric, mm numeric, tramo int
)
language sql security invoker stable as $$
  with cruda as (
    select d.neumatico_id            as nid,
           n.marca, n.modelo, n.medida, n.empresa_id,
           rv.vehiculo_id            as vid,
           p.eje,
           rv.fecha_revision::date   as f,
           rv.km_vehiculo::numeric   as km,
           d.profundidad_mm::numeric as mm
      from revisiones_neumaticos_detalle d
      join revisiones_vehiculo rv on rv.id = d.revision_id
      join tc_neumaticos       n  on n.id  = d.neumatico_id
      left join tc_posiciones_vehiculo p on p.id = d.posicion_id
     where d.profundidad_mm is not null
       and rv.estado_revision is distinct from 'anulada'
       and rv.km_vehiculo is not null and rv.km_vehiculo > 0
       and coalesce(d.neumatico_ausente, false) = false
       and coalesce(d.no_accesible,      false) = false
       and (p_empresa is null or n.empresa_id = p_empresa)
  ),
  -- Un mismo neumático, el mismo día y con el mismo odómetro, medido DOS
  -- veces. Pasa 818 veces en la flota de Plana y en 807 las dos lecturas no
  -- coinciden (6,8 y 7,0 · 5,5 y 6,1 · 6,9 y 8,0): son dos revisiones del
  -- mismo paso por el arco.
  --
  -- Si se dejan las dos filas, el `array_agg ... order by f, km` de abajo elige
  -- una de las dos AL AZAR —el empate no lo rompe nadie— y el informe deja de
  -- ser reproducible: dos ejecuciones pueden dar números distintos. Pasó: la
  -- misma consulta daba 1.199,0 mm o 1.198,9 según el plan.
  --
  -- Son el mismo instante, así que se promedian. Deja de haber empate, deja de
  -- haber azar, y de paso se quita algo de ruido.
  m as (
    select nid, marca, modelo, medida, empresa_id,
           mode() within group (order by vid)   as vid,
           mode() within group (order by eje)   as eje,
           f, km,
           round(avg(mm), 2)                    as mm
      from cruda
     group by nid, marca, modelo, medida, empresa_id, f, km
  ),
  marcado as (
    select m.*,
           case
             -- La primera medición de una goma no corta nada: abre el primero.
             when row_number() over w = 1                  then 0
             when vid is distinct from lag(vid) over w     then 1
             when mm - lag(mm) over w > p_salto            then 1
             when km - lag(km) over w < 0                  then 1
             else 0
           end as corte
      from m
    window w as (partition by nid order by f, km)
  )
  select nid, marca, modelo, medida, empresa_id, vid, eje, f, km, mm,
         sum(corte) over (partition by nid order by f, km rows unbounded preceding)::int
    from marcado;
$$;

grant execute on function public.tc_mediciones_tramo(uuid, numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2 · Kilómetros por milímetro — misma firma y mismo resultado, sin su copia
--     del corte
-- ════════════════════════════════════════════════════════════════════════════
-- La firma gana un parámetro, así que la vieja se tira: si se dejara, PostgREST
-- vería dos candidatas para la misma llamada y no sabría cuál coger.
drop function if exists public.tc_informes_km_por_mm(uuid, numeric, numeric);

create or replace function public.tc_informes_km_por_mm(
  p_empresa        uuid    default null,
  p_min_km         numeric default 10000,
  p_salto          numeric default 2.0,
  p_max_km_por_mm  numeric default 50000
)
returns table(
  marca text, modelo text, eje int,
  tramos bigint, neumaticos bigint,
  km_totales numeric, mm_totales numeric, km_por_mm numeric,
  p25 numeric, mediana numeric, p75 numeric,
  mm_nuevo numeric, mm_retirada numeric,
  neumaticos_modelo bigint
)
language sql security invoker stable as $$
  with m as (
    select t.* from public.tc_mediciones_tramo(p_empresa, p_salto) t
     where t.marca is not null and t.modelo is not null
  ),
  tramo as (
    select neumatico_id as nid, marca, modelo, tramo,
           count(*)                                          as n,
           max(km) - min(km)                                 as span_km,
           mode() within group (order by eje)                as eje,
           (array_agg(mm order by fecha, km))[1]
             - (array_agg(mm order by fecha desc, km desc))[1] as desgaste
      from m
     group by neumatico_id, marca, modelo, tramo
  ),
  buenos as (
    select * from tramo
     where n >= 3 and span_km >= p_min_km and desgaste > 0
       -- Un tramo que implique más que esto no es un neumático: ver la cabecera.
       and span_km / desgaste <= p_max_km_por_mm
  ),
  extremos as (
    select marca, modelo,
           round(percentile_cont(0.99) within group (order by mm)::numeric, 1) as mm_nuevo,
           round(percentile_cont(0.01) within group (order by mm)::numeric, 1) as mm_retirada
      from m group by marca, modelo
  ),
  del_modelo as (
    select marca, modelo, count(distinct nid) as neumaticos_modelo
      from buenos group by marca, modelo
  )
  select b.marca, b.modelo, b.eje,
         count(*)                                                   as tramos,
         count(distinct b.nid)                                      as neumaticos,
         round(sum(b.span_km), 0)                                   as km_totales,
         round(sum(b.desgaste), 1)                                  as mm_totales,
         round(sum(b.span_km) / sum(b.desgaste), 0)                 as km_por_mm,
         round(percentile_cont(0.25) within group (order by b.span_km / b.desgaste)::numeric, 0) as p25,
         round(percentile_cont(0.50) within group (order by b.span_km / b.desgaste)::numeric, 0) as mediana,
         round(percentile_cont(0.75) within group (order by b.span_km / b.desgaste)::numeric, 0) as p75,
         e.mm_nuevo, e.mm_retirada, dm.neumaticos_modelo
    from buenos b
    join extremos   e  on e.marca  = b.marca and e.modelo  = b.modelo
    join del_modelo dm on dm.marca = b.marca and dm.modelo = b.modelo
   group by b.marca, b.modelo, b.eje, e.mm_nuevo, e.mm_retirada, dm.neumaticos_modelo
  having count(*) >= 3 and sum(b.desgaste) >= 5
   order by sum(b.span_km) desc
   limit 500;
$$;

grant execute on function public.tc_informes_km_por_mm(uuid, numeric, numeric, numeric) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3 · Predicción de sustitución, sobre la goma que está puesta
-- ════════════════════════════════════════════════════════════════════════════
-- La firma cambia (tres parámetros nuevos y columnas nuevas), así que hay que
-- tirar la vieja antes: `create or replace` no puede cambiar el tipo devuelto.
drop function if exists public.tc_informes_desgaste(uuid);

create or replace function public.tc_informes_desgaste(
  p_empresa       uuid    default null,
  p_limite_mm     numeric default 1.6,     -- el mínimo legal
  p_min_km        numeric default 10000,   -- para fiarse del ritmo propio de la goma
  p_salto         numeric default 2.0,
  p_max_km_por_mm numeric default 50000
)
returns table(
  neumatico_id uuid, codigo text, marca text, modelo text, medida text,
  matricula text,
  ultima_prof numeric, ultima_fecha date,
  mm_por_1000km numeric,
  /** «neumatico» si el ritmo es suyo medido; «modelo» si es prestado. */
  origen_ritmo text,
  km_restantes numeric, fecha_prevista date,
  n_medidas bigint
)
language sql security invoker stable as $$
  with m as (
    select t.neumatico_id as nid, t.marca, t.modelo, t.medida,
           t.eje, t.fecha, t.km, t.mm, t.tramo
      from public.tc_mediciones_tramo(p_empresa, p_salto) t
     where exists (select 1 from tc_montajes_actuales ma
                    where ma.neumatico_id = t.neumatico_id)
  ),
  -- El último tramo de cada goma es la vida que está viviendo ahora mismo.
  con_final as (
    select m.*, max(tramo) over (partition by nid) as tramo_final from m
  ),
  actual as (
    select nid, marca, modelo, medida,
           mode() within group (order by eje)                  as eje,
           count(*)                                            as n,
           max(km) - min(km)                                   as span_km,
           (max(fecha) - min(fecha))                           as dias,
           (array_agg(mm order by fecha, km))[1]               as mm_ini,
           (array_agg(mm order by fecha desc, km desc))[1]     as mm_fin,
           max(fecha)                                          as ultima_fecha,
           -- ¿Se le puede medir el ritmo a ella misma, o hay que prestárselo?
           -- Mismo criterio que el informe de km/mm, tope incluido.
           count(*) >= 3
             and max(km) - min(km) >= p_min_km
             and (array_agg(mm order by fecha, km))[1]
                 - (array_agg(mm order by fecha desc, km desc))[1] > 0
             and (max(km) - min(km))
                 / nullif((array_agg(mm order by fecha, km))[1]
                          - (array_agg(mm order by fecha desc, km desc))[1], 0)
                 <= p_max_km_por_mm                            as propio
      from con_final
     where tramo = tramo_final
     group by nid, marca, modelo, medida
  ),
  -- El ritmo de cada modelo y eje, de la misma fuente que el informe de km/mm.
  ritmo_modelo as (
    select marca, modelo, eje, sum(mm_totales) / sum(km_totales) as mm_por_km
      from public.tc_informes_km_por_mm(p_empresa, p_min_km, p_salto, p_max_km_por_mm)
     group by marca, modelo, eje
  ),
  calc as (
    select a.*,
           case when a.propio then (a.mm_ini - a.mm_fin) / a.span_km else rm.mm_por_km end as mm_por_km,
           case when a.propio then 'neumatico' else 'modelo' end                          as origen,
           case when a.dias > 0 and a.span_km > 0 then a.span_km / a.dias end as km_dia
      from actual a
      left join ritmo_modelo rm
             on rm.marca = a.marca and rm.modelo = a.modelo
            and rm.eje is not distinct from a.eje
  )
  select c.nid,
         coalesce(n.codigo_interno, n.numero_serie),
         c.marca, c.modelo, c.medida,
         v.matricula,
         c.mm_fin        as ultima_prof,
         c.ultima_fecha,
         case when c.mm_por_km > 0 then round(c.mm_por_km * 1000, 3) end as mm_por_1000km,
         case when c.mm_por_km > 0 then c.origen end                     as origen_ritmo,
         case when c.mm_por_km > 0
              then round(greatest(c.mm_fin - p_limite_mm, 0) / c.mm_por_km, 0) end as km_restantes,
         case when c.mm_por_km > 0 and c.km_dia > 0
              then c.ultima_fecha
                   + round(greatest(c.mm_fin - p_limite_mm, 0) / c.mm_por_km / c.km_dia)::int end as fecha_prevista,
         c.n
    from calc c
    join tc_neumaticos n on n.id = c.nid
    -- Una goma no debería estar montada en dos sitios; si lo estuviera, el
    -- informe no puede sacar la misma fila dos veces.
    left join lateral (
      select v.matricula from tc_montajes_actuales ma
        join tc_vehiculos v on v.id = ma.vehiculo_id
       where ma.neumatico_id = c.nid limit 1
    ) v on true
   order by 12 asc nulls last, 11 asc nulls last;
$$;

grant execute on function public.tc_informes_desgaste(uuid, numeric, numeric, numeric, numeric) to authenticated;
