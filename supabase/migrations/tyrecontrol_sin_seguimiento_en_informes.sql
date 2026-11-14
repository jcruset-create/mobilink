-- ════════════════════════════════════════════════════════════════════════════
-- SEA TyreControl — Los vehículos sin seguimiento dejan de contar
-- ════════════════════════════════════════════════════════════════════════════
--
-- Segunda mitad de `tyrecontrol_vehiculos_en_seguimiento.sql`, que añadió la
-- columna sin tocar ningún informe. Aquí se enchufa: catorce funciones pasan a
-- exigir `en_seguimiento`.
--
-- ── Por qué esto es un bloque que reescribe funciones ──────────────────────
--
-- Porque la alternativa era copiar aquí los doce cuerpos enteros —uno de ellos,
-- `tc_informe_ejecutivo_base`, ocupa 18 KB— para añadirles cuatro palabras. Eso
-- son 1.200 líneas duplicadas del código que ya vive en otras migraciones, y
-- cada copia es una oportunidad de colar una errata que no se ve hasta que un
-- informe da un número raro.
--
-- Así que no se copian: se lee la definición que hay, se le aplica la
-- sustitución y se vuelve a crear. La migración no dice CÓMO queda cada
-- función, dice QUÉ cambio se le hace, que es lo único que esto añade.
--
-- ── Y por eso cuenta las sustituciones ─────────────────────────────────────
--
-- Un `replace` a ciegas sobre una función que mañana tenga otra forma dejaría
-- el informe sin filtrar y sin decir nada. Aquí cada función declara cuántas
-- veces tiene que casar el patrón, y si no cuadra **la migración se para**. Es
-- preferible que no entre a que entre a medias.
--
-- Es idempotente: una función que ya mencione `en_seguimiento` se salta.
--
-- ── Las que NO se tocan, y por qué ─────────────────────────────────────────
--
-- · `tc_informes_km_por_mm` y `tc_mediciones_tramo`. Ese informe no mide
--   nuestra flota, mide MODELOS de neumático: cuántos kilómetros aguanta cada
--   milímetro de un AH51. Una medición de un vehículo fuera del contrato sigue
--   siendo una medición buena de un AH51, y tirarla solo empeora la cifra. Por
--   eso el filtro va en `tc_informes_desgaste` —que sí dice a qué goma hay que
--   ir— y no en la base de mediciones que comparten.
--
-- · Las doce funciones de ACCIÓN sobre un vehículo concreto —montar,
--   inventariar, dar de alta el tipo, aplicar plantilla—. Si alguien decide
--   montarle una goma a un vehículo sin seguimiento, la acción tiene que
--   funcionar: bloquearla sería inventar un modo de fallo nuevo para arreglar
--   un problema de recuentos.
--
-- · `tc_pendientes_identificar`. Parece de vehículos y es de NEUMÁTICOS: lista
--   gomas sin identificar, montadas o en almacén. Una goma nuestra montada en
--   un vehículo fuera del contrato sigue siendo una goma nuestra sin
--   identificar.
--
-- · `tc_base_habitual`, `tc_almacen_usados` y todo lo de telemática y
--   presencia. En la telemática SÍ están, y es donde se quieren ver.
--
-- · `resolverVehiculo` del servidor, el de la asistencia en carretera. Si uno
--   se avería, la grúa tiene que encontrarlo.
--
-- Con `en_seguimiento` en `true` para todos —que es como nacen—, esta
-- migración tampoco cambia ningún número. Los cambia marcar vehículos.

do $migracion$
declare
  -- Función y cuántas veces tiene que aparecer `v.activo` en ella. El número
  -- no es decorativo: es la comprobación.
  objetivos constant text[][] := array[
    ['tc_informes_kpis',              '2'],
    ['tc_informes_economico',         '2'],
    ['tc_informes_estado_flota',      '1'],
    ['tc_informe_control_revisiones', '1'],
    ['tc_informe_ejecutivo',          '1'],
    ['tc_informe_ejecutivo_base',     '1'],
    ['tc_informe_flota_detalle',      '1'],
    ['tc_informes_alertas',           '1'],
    ['tc_informes_ranking_vehiculos', '1'],
    ['tc_revision_estado',            '1'],
    ['tc_alta_operativa_recuentos',   '1']
  ];
  nombre text; esperadas int; def text; nuevo text; cuantas int; cuantos_oid int;
begin
  for i in 1 .. array_length(objetivos, 1) loop
    nombre    := objetivos[i][1];
    esperadas := objetivos[i][2]::int;

    select count(*) into cuantos_oid
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = nombre;
    if cuantos_oid = 0 then raise exception 'No existe public.%', nombre; end if;
    if cuantos_oid > 1 then raise exception 'public.% está sobrecargada: hay que mirarla a mano', nombre; end if;

    select pg_get_functiondef(p.oid) into def
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public' and p.proname = nombre;

    if def like '%en_seguimiento%' then
      raise notice '%: ya la tenía, se salta', nombre;
      continue;
    end if;

    -- `\m` y `\M` son bordes de palabra: así `v.activo` no pilla a
    -- `veh.activo` ni a `p.activo`, que también existen en estos cuerpos.
    cuantas := (select count(*) from regexp_matches(def, '\mv\.activo\M', 'g'));
    if cuantas <> esperadas then
      raise exception '%: se esperaban % apariciones de v.activo y hay %. La función ha cambiado de forma: mirar antes de aplicar esto',
        nombre, esperadas, cuantas;
    end if;

    nuevo := regexp_replace(def, '\mv\.activo\M', 'v.activo and v.en_seguimiento', 'g');
    execute nuevo;
    raise notice '%: % filtro(s) añadido(s)', nombre, cuantas;
  end loop;

  -- `tc_plan_estado` aparte: su `activo` es el del PLAN, no el del vehículo,
  -- así que el filtro va en el join con `tc_vehiculos`.
  select pg_get_functiondef(p.oid) into def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'tc_plan_estado';
  if def is null then raise exception 'No existe public.tc_plan_estado'; end if;
  if def not like '%en_seguimiento%' then
    if position('join tc_vehiculos v on v.id = p.vehiculo_id' in def) = 0 then
      raise exception 'tc_plan_estado: no se encuentra el join con tc_vehiculos. Mirar antes de aplicar esto';
    end if;
    execute replace(def,
      'join tc_vehiculos v on v.id = p.vehiculo_id',
      'join tc_vehiculos v on v.id = p.vehiculo_id and v.en_seguimiento');
    raise notice 'tc_plan_estado: filtro añadido al join';
  end if;
end $migracion$;

-- ════════════════════════════════════════════════════════════════════════════
-- Y los dos informes nuevos. Éstos sí van enteros: son del repositorio, el
-- cambio es un join y no una palabra suelta, y caben.
-- ════════════════════════════════════════════════════════════════════════════

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
     -- Montada, y en un vehículo que esté en el mantenimiento integral: a la
     -- goma de un vehículo sin seguimiento no va a ir nadie a cambiarla.
     where exists (select 1 from tc_montajes_actuales ma
                     join tc_vehiculos veh on veh.id = ma.vehiculo_id
                    where ma.neumatico_id = t.neumatico_id
                      and veh.en_seguimiento)
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
      -- Mismo criterio que el informe de desgaste del que salen las fechas: si
      -- una medida solo la llevan vehículos fuera del contrato, no hay que
      -- comprarla.
      join tc_vehiculos veh on veh.id = ma.vehiculo_id and veh.en_seguimiento
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
