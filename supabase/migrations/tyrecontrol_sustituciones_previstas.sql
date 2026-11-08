-- ════════════════════════════════════════════════════════════════════════════
-- SEA TyreControl — Cuántos neumáticos habrá que cambiar, por medida y plazo
-- ════════════════════════════════════════════════════════════════════════════
--
-- La pregunta del que compra: «¿cuántas gomas de 295/80R22.5 voy a necesitar
-- en los próximos 30 días? ¿Y en 60? ¿Y en 90?». Por MEDIDA y no por marca o
-- modelo, porque lo que se pide al proveedor es una medida: de qué marca se
-- sirve ya se decide después.
--
-- SECURITY INVOKER → respeta la RLS por empresa.
--
-- ── De dónde sale ───────────────────────────────────────────────────────────
--
-- De `tc_informes_desgaste`, que es quien sabe cuándo le toca a cada goma, y
-- que ya mide el ritmo sobre el último tramo —la goma que está puesta— y
-- presta el del modelo a las que todavía no llevan rodado lo bastante. Aquí no
-- se recalcula nada: se agrupa. Si el día de mañana cambia el criterio de
-- predicción, esta previsión cambia con él y no al revés.
--
-- Los cuatro parámetros del método se pasan tal cual para que las dos
-- pantallas no puedan enseñar cifras sacadas con criterios distintos.
--
-- ── La medida se normaliza, y eso importa ──────────────────────────────────
--
-- `tc_neumaticos.medida` es texto libre y la misma medida aparece escrita de
-- varias formas: «385/65R22.5» y «385/65R22.5 158L» son la misma goma para
-- quien compra, pero son dos filas distintas si se agrupa en crudo. Así que se
-- extrae el patrón de medida —ancho/perfil R llanta— y se agrupa por ahí.
--
-- No vale `tc_norm_medida`, que es la que casa con el catálogo de referencias:
-- ésa quita espacios y mayúsculas pero deja el índice de carga pegado
-- («385/65R22.5158L»), que es justo lo que aquí hay que soltar.
--
-- Medido sobre las 4.812 gomas montadas: el patrón casa en 4.758 (el 98,9 %) y
-- las 29 formas distintas de escribirlo se quedan en 24 medidas de verdad. Las
-- 54 que no casan —las que no tienen medida puesta, y un «0»— se agrupan en
-- «(sin medida)» en vez de desaparecer: es trabajo de catálogo pendiente y
-- tiene que verse.
--
-- ── Y salen TODAS las medidas montadas, tengan datos o no ──────────────────
--
-- Esto no es un detalle: hay 346 gomas de 385/55R22.5 y 115 de 385/65R22.5
-- montadas en la flota y NINGUNA tiene una sola medición. Si la previsión
-- saliera solo de lo medido, esas 461 gomas no aparecerían, y quien lea la
-- tabla para hacer un pedido entendería que esas medidas no existen.
--
-- Así que la lista de medidas sale de `tc_montajes_actuales` —lo que hay en la
-- calle— y las fechas se le pegan al lado. Una medida sin mediciones sale con
-- su recuento de montadas y ceros en todos los plazos, que es exactamente lo
-- que hay que ver: ni se cubre ni se esconde.
--
-- ── Qué devuelve, y por qué las dos cuentas ────────────────────────────────
--
-- Una fila por medida y plazo, con:
--
--   · `en_el_tramo` — las que caen ENTRE el plazo anterior y éste. Es lo que
--     se compra ese mes.
--   · `acumulado`   — las vencidas más todo lo que cae hasta ese plazo. Es lo
--     que hay que tener disponible para entonces.
--
-- Y, repetidos en cada fila de esa medida, las tres cuentas que dicen hasta
-- dónde llega la previsión:
--
--   · `montados`  — las que hay en la calle, con datos o sin ellos;
--   · `sin_datos` — las que no tienen NINGUNA medición: el arco no las lee o
--     no han pasado por él;
--   · `sin_fecha` — las que sí se han medido pero no tienen predicción, porque
--     ni se les ha podido medir el ritmo ni prestarles el de su modelo.
--
-- Esas dos últimas son la letra pequeña. Sin ellas los totales parecerían
-- completos, y no lo son: hoy suman 834 y 461 de 4.812 montadas.

create or replace function public.tc_informes_sustituciones_previstas(
  p_empresa       uuid    default null,
  p_tramos        int[]   default array[30, 60, 90, 120, 180, 365],
  p_desde         date    default null,
  p_limite_mm     numeric default 1.6,
  p_min_km        numeric default 10000,
  p_salto         numeric default 2.0,
  p_max_km_por_mm numeric default 50000
)
returns table(
  medida text,
  montados bigint,
  sin_datos bigint,
  sin_fecha bigint,
  vencidos bigint,
  dias int,
  en_el_tramo bigint,
  acumulado bigint
)
language sql security invoker stable as $$
  with hoy as (select coalesce(p_desde, current_date) as d),
  -- Lo que hay montado AHORA, que es la lista de medidas de verdad.
  -- `distinct on` porque una goma en dos montajes no puede contar dos veces.
  montadas as (
    select distinct on (ma.neumatico_id)
           ma.neumatico_id as nid,
           coalesce(
             nullif(substring(upper(replace(coalesce(n.medida, ''), ' ', ''))
                              from '([0-9]{3}/[0-9]{2,3}R[0-9]{2}(\.[0-9])?)'), ''),
             '(sin medida)') as med
      from tc_montajes_actuales ma
      join tc_neumaticos n on n.id = ma.neumatico_id
     where (p_empresa is null or n.empresa_id = p_empresa)
     order by ma.neumatico_id, ma.fecha_montaje desc nulls last
  ),
  predichas as (
    select x.neumatico_id as nid, x.fecha_prevista
      from public.tc_informes_desgaste(p_empresa, p_limite_mm, p_min_km,
                                       p_salto, p_max_km_por_mm) x
  ),
  base as (
    select m.med, p.nid is not null as con_datos, p.fecha_prevista
      from montadas m
      left join predichas p on p.nid = m.nid
  ),
  por_medida as (
    select med,
           count(*)                                                      as montados,
           count(*) filter (where not con_datos)                         as sin_datos,
           count(*) filter (where con_datos and fecha_prevista is null)  as sin_fecha,
           count(*) filter (where fecha_prevista <= (select hoy.d from hoy)) as vencidos
      from base group by med
  ),
  tramos as (select unnest(p_tramos) as dias),
  hasta as (
    select p.med, t.dias,
           count(*) filter (
             where b.fecha_prevista >  (select hoy.d from hoy)
               and b.fecha_prevista <= (select hoy.d from hoy) + t.dias
           ) as acumulado_futuro
      from por_medida p
      cross join tramos t
      left join base b on b.med = p.med
     group by p.med, t.dias
  )
  select p.med, p.montados, p.sin_datos, p.sin_fecha, p.vencidos, h.dias,
         (h.acumulado_futuro
            - coalesce(lag(h.acumulado_futuro) over (partition by h.med order by h.dias), 0))::bigint
           as en_el_tramo,
         (p.vencidos + h.acumulado_futuro)::bigint as acumulado
    from hasta h
    join por_medida p on p.med = h.med
   order by p.montados desc, p.med, h.dias;
$$;

grant execute on function public.tc_informes_sustituciones_previstas(uuid, int[], date, numeric, numeric, numeric, numeric) to authenticated;
