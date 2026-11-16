-- Una sola profundidad para todos los informes: la ya juzgada.
--
-- ── Qué pasaba ───────────────────────────────────────────────────────────────
--
-- La pantalla de alertas (tc_informes_alertas_vehiculos) y la tablet dan la
-- profundidad de cada goma después de tres filtros: solo cuentan las revisiones
-- completas, el protocolo contra los falsos desgastes (la mediana de las tres
-- últimas cuando la última da alerta) y, desde el PR #646, que la bajada quepa
-- en los kilómetros recorridos. Y miden contra el mínimo de la llanta: 4 mm en
-- 22,5", 3 mm de 17" a 19,5", 2 mm en el resto.
--
-- Las otras cinco funciones que cuentan desgastes no hacían nada de eso:
--
--   tc_informes_alertas         la lista de alertas del panel
--   tc_informes_kpis            los contadores del inicio
--   tc_informes_estado_flota    el semáforo de la flota
--   tc_informe_flota_detalle    el Excel de flota
--   tc_informe_ejecutivo_base   el informe ejecutivo
--
-- Cogían la última lectura tal cual —cuatro de ellas, aunque la revisión
-- hubiera quedado a medias— y cuatro medían contra 1,6 mm fijos. En Plana, el
-- mismo día: la pantalla de alertas, decenas de ruedas en rojo; el inicio, 2
-- neumáticos bajo mínimo; el estado de flota, 1 vehículo urgente.
--
-- ── Qué cambia ───────────────────────────────────────────────────────────────
--
-- Una función nueva, tc_profundidad_vigente(p_empresa), devuelve una fila por
-- goma MONTADA con su profundidad ya juzgada, su mínimo, su aviso y su
-- severidad. Las cinco funciones dejan de calcular por su cuenta y la leen.
--
--   · profundidad: revisión completa → protocolo → kilómetros. La regla de los
--     kilómetros es la de services/desgasteCreible.ts, con las mismas
--     constantes: en duda las tres últimas lecturas, base la mediana de las
--     tres anteriores, ritmo propio con 9 lecturas y 3.000 km (si no, el medio
--     de las demás ruedas del vehículo), y se tolera el doble del ritmo más
--     1 mm. Mira 180 días de lecturas, como el panel. La que no cabe se queda
--     en su base y la lectura baja pasa a «por confirmar».
--   · mínimo: el configurado para la empresa y, si no tiene, el de la llanta.
--     Decidido por Jordi el 16/11/2026.
--   · aviso («próximo al mínimo»): el configurado y, si no tiene, el mínimo
--     más 1 mm. Antes eran 3 mm fijos, por debajo del mínimo de una 22,5".
--     Decidido por Jordi el 16/11/2026.
--   · severidad: 3 para cambiar (en su mínimo y confirmada), 2 próxima al
--     mínimo o con una lectura baja por confirmar, 1 bien.
--
-- Los informes pasan a contar solo gomas montadas (el inicio contaba también
-- las desmontadas) y dejan de contar lecturas de revisiones a medias.
--
-- En Plana, medido en solo lectura antes de escribirla:
--
--                                     antes   después
--   inicio · bajo mínimo                  2        53
--   inicio · próximos al mínimo          62       237
--   estado de flota · urgente             1        35
--   estado de flota · revisar            77       118
--   estado de flota · correcto          540       465
--   ejecutivo · críticos                  1        53
--   lista de alertas · bajo mínimo      102        53
--
-- De las gomas juzgadas, la regla de los kilómetros cambia una: la delantera
-- izquierda del 2651JRM, que vuelve a 12,4 mm con el 2,2 por confirmar.
--
-- No se toca tc_informes_alertas_vehiculos: ya hace los dos primeros filtros y
-- el panel le aplica el tercero. Tampoco los históricos del ejecutivo
-- (evolución mensual y comparativa de periodos), que cuentan lecturas de cada
-- mes contra el mínimo legal de 1,6 mm.
--
-- Solo se crean o sustituyen funciones. No se escribe en ninguna tabla.
--
-- ── Se prueba sola ───────────────────────────────────────────────────────────
--
-- Un solo bloque: comprueba que las cinco funciones son las que había cuando se
-- escribió (si alguien las ha cambiado, no se toca nada), instala, se hace pasar
-- por un superadmin, un usuario de la empresa y un operador, comprueba con RLS
-- que los cuatro contadores de «para cambiar» dan el mismo número y cronometra.
-- Si algo no cuadra o no entra en el margen, se deshace entero y queda todo
-- como estaba.

do $migracion$
declare
  c_limite_ms constant numeric := 4000;
  c_limite_operador_ms constant numeric := 7000;
  -- El ejecutivo ya era el más pesado: recorre todo el histórico para la previsión.
  c_limite_ejecutivo_ms constant numeric := 12000;

  v_vigente text := $fn$create or replace function tc_profundidad_vigente(p_empresa uuid default null)
returns table (
  neumatico_id uuid,
  vehiculo_id uuid,
  posicion_id uuid,
  empresa_id uuid,
  medida text,
  profundidad_mm numeric,
  fecha_revision date,
  confirmada boolean,
  pendiente_mm numeric,
  pendiente_fecha date,
  no_creible boolean,
  minimo_mm numeric,
  aviso_mm numeric,
  severidad integer
)
language sql
stable
set jit to 'off'
set work_mem to '16MB'
as $function$
  with
  medidas as (
    select d.neumatico_id, d.posicion_id, rv.vehiculo_id, d.profundidad_mm,
           rv.fecha_revision, rv.created_at, rv.id as revision_id,
           (rv.tecnico_id is not null) as manual,
           (count(*) over w = count(d.profundidad_mm) over w) as completa
    from revisiones_neumaticos_detalle d
    join revisiones_vehiculo rv on rv.id = d.revision_id
    where rv.estado_revision <> 'anulada'
      and (p_empresa is null or d.empresa_id = p_empresa)
    window w as (partition by d.revision_id)
  ),
  buenas as (
    select x.* from medidas x where x.completa and x.profundidad_mm is not null
  ),
  atribuidas as (
    select b.neumatico_id, b.vehiculo_id, b.profundidad_mm, b.fecha_revision, b.created_at, b.manual
    from buenas b
    where b.neumatico_id is not null
    union all
    select mo.neumatico_id, b.vehiculo_id, b.profundidad_mm, b.fecha_revision, b.created_at, b.manual
    from buenas b
    join tc_montajes_actuales mo
      on mo.vehiculo_id = b.vehiculo_id and mo.posicion_id = b.posicion_id
    where b.fecha_revision > mo.fecha_montaje
      and b.neumatico_id is distinct from mo.neumatico_id
  ),
  ord as (
    select a.*,
           row_number() over (partition by a.neumatico_id
                              order by a.fecha_revision desc, a.created_at desc) as k
    from atribuidas a
  ),
  tres as (
    select o.neumatico_id,
           max(o.profundidad_mm) filter (where o.k = 1) as u1,
           max(o.profundidad_mm) filter (where o.k = 2) as u2,
           max(o.profundidad_mm) filter (where o.k = 3) as u3,
           coalesce(bool_or(o.manual) filter (where o.k = 1), false) as m1,
           coalesce(bool_or(o.manual) filter (where o.k = 2), false) as m2,
           coalesce(bool_or(o.manual) filter (where o.k = 3), false) as m3,
           max(o.fecha_revision) filter (where o.k = 1) as f1,
           max(o.fecha_revision) filter (where o.k = 2) as f2,
           max(o.fecha_revision) filter (where o.k = 3) as f3
    from ord o
    where o.k <= 3
    group by o.neumatico_id
  ),
  prot as (
    select c.neumatico_id, c.n, c.m1, c.m2, c.m3,
           c.valor as prot_mm,
           case when c.valor = c.u1 then c.f1 when c.valor = c.u2 then c.f2 else c.f3 end as prot_fecha,
           c.confirmada as prot_confirmada,
           case when c.hay_pendiente then c.u1 end as prot_pendiente_mm,
           case when c.hay_pendiente then c.f1 end as prot_pendiente_fecha,
           c.u1 as ultima_mm, c.f1 as ultima_fecha
    from (
      select m.*,
             case when m.n = 1 then m.u1
                  when m.n = 2 then case when abs(m.u1 - m.u2) <= 2 then m.u1 else m.u2 end
                  else m.med end as valor,
             case when m.n = 1 then m.m1
                  when m.n = 2 then (abs(m.u1 - m.u2) <= 2 or m.m2)
                  else true end as confirmada,
             case when m.n = 1 then false
                  when m.n = 2 then abs(m.u1 - m.u2) > 2
                  else abs(m.u1 - m.med) > 2 end as hay_pendiente
      from (
        select w.*,
               case when w.n = 3
                    then w.u1 + w.u2 + w.u3 - greatest(w.u1, w.u2, w.u3) - least(w.u1, w.u2, w.u3)
               end as med
        from (
          select t.*,
                 case when t.m1 then 1 when t.m2 then 2
                      when t.u3 is not null then 3
                      when t.u2 is not null then 2 else 1 end as n
          from tres t
        ) w
      ) m
    ) c
  ),
  ruedas as (
    select mo.neumatico_id, mo.vehiculo_id, mo.posicion_id, v.empresa_id, n.medida,
           pr.n, pr.m1, pr.m2, pr.m3, pr.prot_mm, pr.prot_fecha, pr.prot_confirmada,
           pr.prot_pendiente_mm, pr.prot_pendiente_fecha, pr.ultima_mm, pr.ultima_fecha,
           mn.minimo_mm,
           -- «Próximo al mínimo»: el aviso que tenga configurado la empresa y,
           -- si no tiene, 1 mm por encima del mínimo de esa goma.
           coalesce(um.profundidad_aviso_mm, uc.profundidad_aviso_mm, ue.profundidad_aviso_mm,
                    mn.minimo_mm + 1) as aviso_mm
    from tc_montajes_actuales mo
    join tc_vehiculos v on v.id = mo.vehiculo_id
    join tc_neumaticos n on n.id = mo.neumatico_id
    left join prot pr on pr.neumatico_id = mo.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = v.empresa_id
    left join tc_config_umbrales_medida um on um.empresa_id = v.empresa_id
         and tc_norm_medida(um.medida) = tc_norm_medida(n.medida)
    left join tc_cat_medidas_neumatico cm on tc_norm_medida(cm.valor) = tc_norm_medida(n.medida)
    left join tc_config_umbrales_categoria uc on uc.empresa_id = v.empresa_id and uc.categoria = cm.categoria
    cross join lateral (
      select coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm,
                      tc_profundidad_minima_por_llanta(n.medida), 1.6) as minimo_mm
    ) mn
    where (p_empresa is null or v.empresa_id = p_empresa)
  ),
  decididas as (
    select r.neumatico_id, r.vehiculo_id, r.posicion_id, r.empresa_id, r.medida, r.minimo_mm, r.aviso_mm,
           r.n, r.m1, r.m2, r.m3, r.ultima_mm, r.ultima_fecha,
           case when r.ultima_mm <= r.minimo_mm then r.prot_mm else r.ultima_mm end as profundidad_mm,
           case when r.ultima_mm <= r.minimo_mm then r.prot_fecha else r.ultima_fecha end as fecha_revision,
           case when r.ultima_mm is null then null
                when r.ultima_mm <= r.minimo_mm then r.prot_confirmada else true end as confirmada,
           case when r.ultima_mm <= r.minimo_mm then r.prot_pendiente_mm end as pendiente_mm,
           case when r.ultima_mm <= r.minimo_mm then r.prot_pendiente_fecha end as pendiente_fecha
    from ruedas r
  ),
  -- ── El juicio de los kilómetros ─────────────────────────────────────────
  -- Solo trabaja para los vehículos con alguna rueda «para cambiar».
  candidatas as (
    select d.neumatico_id, d.vehiculo_id
    from decididas d
    where d.profundidad_mm <= d.minimo_mm and d.confirmada
      and d.n = 3 and not d.m3
  ),
  puntos as (
    select distinct on (rv.vehiculo_id, rv.fecha_revision)
           rv.vehiculo_id, rv.fecha_revision as f, rv.km_vehiculo::numeric as km
    from revisiones_vehiculo rv
    where rv.vehiculo_id in (select vehiculo_id from candidatas)
      and rv.estado_revision <> 'anulada'
      and rv.fecha_revision >= current_date - 180
      and rv.km_vehiculo > 0
    order by rv.vehiculo_id, rv.fecha_revision, rv.created_at desc
  ),
  resumen_km as (
    select p.vehiculo_id, count(*) as n, min(p.f) as f_pri, max(p.f) as f_ult
    from puntos p group by p.vehiculo_id
  ),
  serie as (
    select o.neumatico_id, mo.vehiculo_id, o.profundidad_mm as mm, o.fecha_revision as f, o.manual,
           row_number() over (partition by o.neumatico_id order by o.fecha_revision desc, o.created_at desc) as k,
           count(*) over (partition by o.neumatico_id) as total
    from ord o
    join tc_montajes_actuales mo on mo.neumatico_id = o.neumatico_id
    where mo.vehiculo_id in (select vehiculo_id from candidatas)
      and o.fecha_revision >= current_date - 180
  ),
  serie_km as (
    select s.*,
           coalesce(
             ex.km,
             case when rk.n >= 2 then
               case
                 when an.f is not null and de.f is not null then
                   round(an.km + greatest(0, (de.km - an.km) / (de.f - an.f)) * (s.f - an.f))
                 when an.f is not null then
                   round(an.km + greatest(0, (an.km - ar.km) / nullif(an.f - ar.f, 0)) * (s.f - an.f))
                 when de.f is not null then
                   round(de.km - greatest(0, (sg.km - de.km) / nullif(sg.f - de.f, 0)) * (de.f - s.f))
               end
             end) as km
    from serie s
    left join resumen_km rk on rk.vehiculo_id = s.vehiculo_id
    left join puntos ex on ex.vehiculo_id = s.vehiculo_id and ex.f = s.f
    left join lateral (select p.f, p.km from puntos p
                       where p.vehiculo_id = s.vehiculo_id and p.f < s.f
                       order by p.f desc limit 1) an on ex.f is null
    left join lateral (select p.f, p.km from puntos p
                       where p.vehiculo_id = s.vehiculo_id and p.f > s.f
                       order by p.f limit 1) de on ex.f is null
    -- Después del último punto: el ritmo de los últimos 30 días.
    left join lateral (select p.f, p.km from puntos p
                       where p.vehiculo_id = s.vehiculo_id and p.f < an.f
                       order by (an.f - p.f <= 30) desc,
                                case when an.f - p.f <= 30 then p.f end asc,
                                p.f desc
                       limit 1) ar on ex.f is null and de.f is null and an.f is not null
    -- Antes del primero: el ritmo del primer tramo.
    left join lateral (select p.f, p.km from puntos p
                       where p.vehiculo_id = s.vehiculo_id and p.f > de.f
                       order by p.f limit 1) sg on ex.f is null and an.f is null and de.f is not null
    where s.k <= 6 or s.k > s.total - 3
  ),
  -- La lectura de en medio de cada trío: ventana (1-3), base (4-6), primeras.
  trios as (
    select x.neumatico_id, x.vehiculo_id, x.total, x.trio, x.mm, x.f, x.km
    from (
      select t.*, row_number() over (partition by t.neumatico_id, t.trio order by t.mm, t.k) as pos
      from (
        select s.*, 'ventana' as trio from serie_km s where s.k <= 3
        union all
        select s.*, 'base' from serie_km s where s.k between 4 and 6
        union all
        select s.*, 'primeras' from serie_km s where s.k > s.total - 3 and s.total >= 9
      ) t
    ) x
    where x.pos = 2
  ),
  por_goma as (
    select s.neumatico_id, s.vehiculo_id, s.total,
           max(v.mm) as valor_mm,
           max(b.mm) as base_mm, max(b.f) as base_f, max(b.km) as base_km,
           max(u.km) as ultima_km,
           bool_or(u3.manual) as manual,
           max(case when s.total >= 9 and b.km - p.km >= 3000
                    then greatest(0, (p.mm - b.mm) / (b.km - p.km) * 1000) end) as ritmo
    from (select distinct neumatico_id, vehiculo_id, total from serie_km) s
    left join trios v on v.neumatico_id = s.neumatico_id and v.trio = 'ventana'
    left join trios b on b.neumatico_id = s.neumatico_id and b.trio = 'base'
    left join trios p on p.neumatico_id = s.neumatico_id and p.trio = 'primeras'
    left join serie_km u on u.neumatico_id = s.neumatico_id and u.k = 1
    left join serie_km u3 on u3.neumatico_id = s.neumatico_id and u3.k <= 3
    group by s.neumatico_id, s.vehiculo_id, s.total
  ),
  juicio as (
    select g.neumatico_id, g.base_mm, g.base_f,
           (g.base_mm - g.valor_mm) as bajada,
           greatest(0, g.ultima_km - g.base_km) as km,
           coalesce(g.ritmo, r.reserva) as ritmo
    from por_goma g
    left join lateral (select avg(o.ritmo) as reserva from por_goma o
                       where o.vehiculo_id = g.vehiculo_id and o.neumatico_id <> g.neumatico_id
                         and o.ritmo is not null) r on true
    where g.neumatico_id in (select neumatico_id from candidatas)
      and g.total >= 6 and not g.manual
      and g.ultima_km is not null and g.base_km is not null
  ),
  vigente as (
    select d.neumatico_id, d.vehiculo_id, d.posicion_id, d.empresa_id, d.medida,
           d.minimo_mm, d.aviso_mm,
           case when nc.neumatico_id is not null then nc.base_mm else d.profundidad_mm end as profundidad_mm,
           case when nc.neumatico_id is not null then nc.base_f else d.fecha_revision end as fecha_revision,
           d.confirmada,
           case when nc.neumatico_id is not null then d.profundidad_mm else d.pendiente_mm end as pendiente_mm,
           case when nc.neumatico_id is not null then d.fecha_revision else d.pendiente_fecha end as pendiente_fecha,
           (nc.neumatico_id is not null) as no_creible
    from decididas d
    left join juicio nc on nc.neumatico_id = d.neumatico_id
         and nc.ritmo is not null
         and nc.bajada > 2 * nc.ritmo * nc.km / 1000 + 1
  )
  select g.neumatico_id, g.vehiculo_id, g.posicion_id, g.empresa_id, g.medida,
         g.profundidad_mm, g.fecha_revision, g.confirmada, g.pendiente_mm, g.pendiente_fecha,
         g.no_creible, g.minimo_mm, g.aviso_mm,
         -- 3: para cambiar. 2: próxima al mínimo o con una lectura baja por
         -- confirmar. 1: bien. Sin lectura, null.
         case when g.profundidad_mm is null then null
              when g.profundidad_mm <= g.minimo_mm and g.confirmada then 3
              when g.profundidad_mm <= g.aviso_mm or g.pendiente_mm <= g.minimo_mm then 2
              else 1 end
  from vigente g;
$function$$fn$;

  v_alertas text := $fn$CREATE OR REPLACE FUNCTION public.tc_informes_alertas(p_empresa uuid DEFAULT NULL::uuid)
 RETURNS TABLE(tipo text, severidad text, vehiculo_id uuid, matricula text, neumatico_id uuid, codigo text, posicion text, detalle text, valor numeric)
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
 SET work_mem TO '16MB'
AS $function$
  -- La profundidad de cada goma montada ya viene juzgada de
  -- tc_profundidad_vigente: revisión completa, protocolo y kilómetros.
  with montados as (
    select g.neumatico_id, g.vehiculo_id, v.matricula,
           coalesce(n.codigo_interno, n.numero_serie) as codigo, p.codigo_posicion,
           g.profundidad_mm, g.minimo_mm as minmm, g.severidad
    from tc_profundidad_vigente(p_empresa) g
    join tc_neumaticos n on n.id = g.neumatico_id
    join tc_vehiculos v on v.id = g.vehiculo_id
    left join tc_posiciones_vehiculo p on p.id = g.posicion_id
  )
  select 'bajo_minimo'::text, 'alta'::text, mo.vehiculo_id, mo.matricula, mo.neumatico_id, mo.codigo, mo.codigo_posicion,
         'Profundidad ' || mo.profundidad_mm || ' mm (≤ ' || mo.minmm || ' mínimo)', mo.profundidad_mm
  from montados mo where mo.severidad = 3

  union all
  select 'vehiculo_sin_revisar', 'media', v.id, v.matricula, null::uuid, null::text, null::text,
         'Vehículo activo sin ninguna revisión registrada', null::numeric
  from tc_vehiculos v
  where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
    and not exists (select 1 from revisiones_vehiculo rv where rv.vehiculo_id = v.id and rv.estado_revision <> 'anulada')
  union all
  -- Avisos de presión de Goodyear que siguen abiertos. Una fila por
  -- RUEDA, no por correo: `avisos` dice cuántas veces ha avisado la misma.
  select a.tipo, a.severidad, a.vehiculo_id, v.matricula, a.neumatico_id,
         coalesce(n.codigo_interno, n.numero_serie), p.codigo_posicion,
         case when a.presion_bar is null
              then 'Sin lectura de presión'
              else 'Presión ' || a.presion_bar || ' bar'
           end
         || coalesce(' de ' || a.presion_recomendada_bar || ' recomendados', '')
         || coalesce(' (' || a.desviacion_pct || ' %)', '')
         -- Que una rueda lleve días avisando es el dato que distingue una
         -- presión baja de una fuga, así que se dice en el propio detalle.
         || case when a.avisos > 1
                 then ' · ' || a.avisos || ' avisos desde el ' ||
                      to_char(a.primer_aviso_at, 'DD/MM')
                 else '' end,
         a.presion_bar
    from tc_alertas_presion a
    join tc_vehiculos v on v.id = a.vehiculo_id
    left join tc_neumaticos n on n.id = a.neumatico_id
    left join tc_posiciones_vehiculo p on p.id = a.posicion_id
   where a.estado = 'abierta'
     and (p_empresa is null or a.empresa_id = p_empresa)
  order by 2, 1;
$function$$fn$;

  v_kpis text := $fn$CREATE OR REPLACE FUNCTION public.tc_informes_kpis(p_empresa uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
  with rango as (
    select coalesce(p_desde, date_trunc('month', now())::date) as d1, coalesce(p_hasta, now()::date) as d2
  ),
  revs as (
    select r.* from revisiones_vehiculo r, rango
    where (p_empresa is null or r.empresa_id = p_empresa)
      and r.estado_revision <> 'anulada' and r.fecha_revision between rango.d1 and rango.d2
  ),
  ops as (
    select o.* from operaciones_neumaticos o, rango
    where (p_empresa is null or o.empresa_id = p_empresa) and o.fecha_operacion between rango.d1 and rango.d2
  ),
  -- Solo gomas montadas, con su profundidad ya juzgada.
  ultu as (
    select g.neumatico_id, g.severidad
    from tc_profundidad_vigente(p_empresa) g
    where g.profundidad_mm is not null
  )
  select json_build_object(
    'vehiculos_activos', (select count(*) from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)),
    'vehiculos_revisados', (select count(distinct vehiculo_id) from revs),
    'vehiculos_pendientes', (select count(*) from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa) and v.id not in (select vehiculo_id from revs)),
    'revisiones_total', (select count(*) from revs),
    'tecnicos_activos', (select count(*) from tc_usuarios u where u.activo and coalesce(u.acceso_apk, false)),
    'neumaticos_total', (select count(*) from tc_neumaticos n where (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_montados', (select count(*) from tc_neumaticos n where n.estado = 'montado' and (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_almacen', (select count(*) from tc_neumaticos n where n.estado = 'almacen' and (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_reparacion', (select count(*) from tc_neumaticos n where n.estado = 'reparacion' and (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_descartados', (select count(*) from tc_neumaticos n where n.estado = 'descartado' and (p_empresa is null or n.empresa_id = p_empresa)),
    'neumaticos_bajo_minimo', (select count(*) from ultu where severidad = 3),
    'neumaticos_proximos', (select count(*) from ultu where severidad = 2),
    'op_montajes', (select count(*) from ops where tipo_operacion = 'montaje'),
    'op_rotaciones', (select count(*) from ops where tipo_operacion = 'rotacion'),
    'op_reparaciones', (select count(*) from ops where tipo_operacion = 'reparacion'),
    'op_sustituciones', (select count(*) from ops where tipo_operacion = 'sustitucion'),
    'op_descartes', (select count(*) from ops where tipo_operacion = 'descarte')
  );
$function$$fn$;

  v_flota text := $fn$CREATE OR REPLACE FUNCTION public.tc_informe_flota_detalle(p_empresa uuid DEFAULT NULL::uuid)
 RETURNS TABLE(cliente text, matricula text, unidad text, base text, tipo text, config text, medida text, estado text, ultima_revision text, dias_desde integer, ruedas_plano bigint, ruedas_montadas bigint, ruedas_medidas bigint, profundidad_minima numeric, bajo_minimo bigint, en_aviso bigint, km_actual numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with veh as (
  select v.id, v.empresa_id, v.matricula, v.numero_unidad, v.km_actual,
         v.delegacion_id, v.tipo_vehiculo_id, v.medida_id, v.medidas_por_eje, v.config_ejes_id
    from tc_vehiculos v
   where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
),
ultrev as (
  select distinct on (rv.vehiculo_id) rv.vehiculo_id, rv.id revision_id,
         rv.fecha_revision, rv.estado_revision
    from revisiones_vehiculo rv
   where rv.estado_revision <> 'anulada'
     and (p_empresa is null or rv.empresa_id = p_empresa)
   order by rv.vehiculo_id, rv.fecha_revision desc, rv.created_at desc
),
-- Las gomas que lleva montadas, con su profundidad ya juzgada: no las filas
-- de la última revisión, que si quedó a medias falseaba el estado.
tyre as (
  select g.vehiculo_id, g.profundidad_mm, g.severidad
    from tc_profundidad_vigente(p_empresa) g
   where g.profundidad_mm is not null
),
agg as (
  select vehiculo_id, count(*) medidas, min(profundidad_mm) minimo,
         count(*) filter (where severidad = 3) bajo_minimo,
         count(*) filter (where severidad = 2) en_aviso,
         max(severidad) sev
    from tyre group by vehiculo_id
)
select e.nombre cliente, v.matricula, v.numero_unidad unidad,
       del.nombre base, tv.nombre tipo, ce.nombre config,
       case when v.medidas_por_eje then 'por eje' else mn.valor end medida,
       case when ur.vehiculo_id is null then 'pendiente'
            when a.sev is null then 'revisar'
            when a.sev = 3 then 'urgente'
            when a.sev = 2 then 'revisar'
            else 'correcto' end estado,
       ur.fecha_revision::text ultima_revision,
       case when ur.fecha_revision is null then null
            else (current_date - ur.fecha_revision) end dias_desde,
       (select count(*) from tc_posiciones_vehiculo p where p.tipo_vehiculo_id = v.tipo_vehiculo_id and p.activo) ruedas_plano,
       (select count(*) from tc_montajes_actuales m where m.vehiculo_id = v.id) ruedas_montadas,
       coalesce(a.medidas,0) ruedas_medidas, a.minimo profundidad_minima,
       coalesce(a.bajo_minimo,0) bajo_minimo, coalesce(a.en_aviso,0) en_aviso,
       v.km_actual
  from veh v
  join tc_empresas e on e.id = v.empresa_id
  left join ultrev ur on ur.vehiculo_id = v.id
  left join agg a on a.vehiculo_id = v.id
  left join tc_delegaciones del on del.id = v.delegacion_id
  left join tc_tipos_vehiculo tv on tv.id = v.tipo_vehiculo_id
  left join tc_config_ejes ce on ce.id = v.config_ejes_id
  left join tc_cat_medidas_neumatico mn on mn.id = v.medida_id
 order by e.nombre, v.matricula;
$function$$fn$;

  v_estado text := $fn$CREATE OR REPLACE FUNCTION public.tc_informes_estado_flota(p_empresa uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
  with veh as (
    select v.id, v.empresa_id, v.matricula, v.numero_unidad
    from tc_vehiculos v where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  ultrev as (
    select distinct on (rv.vehiculo_id) rv.vehiculo_id, rv.id as revision_id, rv.fecha_revision
    from revisiones_vehiculo rv
    where rv.estado_revision <> 'anulada' and (p_empresa is null or rv.empresa_id = p_empresa)
    order by rv.vehiculo_id, rv.fecha_revision desc, rv.created_at desc
  ),
  tyre_sev as (
    select g.vehiculo_id, g.profundidad_mm, g.severidad as sev
    from tc_profundidad_vigente(p_empresa) g
    where g.profundidad_mm is not null
  ),
  veh_sev as (select vehiculo_id, max(sev) as sev, min(profundidad_mm) as prof_min from tyre_sev group by vehiculo_id),
  clasif as (
    select v.id, v.matricula, v.numero_unidad, ur.fecha_revision, vs.prof_min,
      case
        when ur.vehiculo_id is null then 'pendiente'
        when vs.sev is null then 'revisar'
        when vs.sev = 3 then 'urgente'
        when vs.sev = 2 then 'revisar'
        else 'correcto'
      end as estado
    from veh v
    left join ultrev ur on ur.vehiculo_id = v.id
    left join veh_sev vs on vs.vehiculo_id = v.id
  )
  select json_build_object(
    'total', (select count(*) from veh),
    'correcto', (select count(*) from clasif where estado = 'correcto'),
    'revisar', (select count(*) from clasif where estado = 'revisar'),
    'urgente', (select count(*) from clasif where estado = 'urgente'),
    'pendiente', (select count(*) from clasif where estado = 'pendiente'),
    'evolucion', (
      select coalesce(json_agg(row_to_json(e) order by e.mes), '[]'::json) from (
        select to_char(date_trunc('month', rv.fecha_revision), 'YYYY-MM') as mes, count(*)::int as revisiones
        from revisiones_vehiculo rv
        where rv.estado_revision <> 'anulada' and (p_empresa is null or rv.empresa_id = p_empresa)
          and rv.fecha_revision >= (date_trunc('month', now()) - interval '5 months')::date
        group by 1
      ) e
    ),
    'vehiculos', (
      select coalesce(json_agg(json_build_object(
               'vehiculo_id', c.id, 'matricula', c.matricula, 'numero_unidad', c.numero_unidad,
               'estado', c.estado, 'prof_min', c.prof_min, 'fecha_revision', c.fecha_revision
             ) order by c.matricula), '[]'::json)
      from clasif c
    )
  );
$function$$fn$;

  v_ejecutivo text := $fn$CREATE OR REPLACE FUNCTION public.tc_informe_ejecutivo_base(p_empresa uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET jit TO 'off'
AS $function$
with rango as (
  select
    coalesce(p_desde, date_trunc('month', now())::date) as d1,
    coalesce(p_hasta, now()::date)                      as d2
),
-- Periodo anterior de la MISMA duración, para comparar sin sesgo.
rango_prev as (
  select (d1 - (d2 - d1) - 1)::date as p1, (d1 - 1)::date as p2 from rango
),
veh as (
  select v.id, v.matricula, v.delegacion_id, v.km_actual, v.tipo_vehiculo_id
  from tc_vehiculos v
  where v.activo and v.en_seguimiento and (p_empresa is null or v.empresa_id = p_empresa)
),
revs as (
  select r.* from revisiones_vehiculo r, rango
  where (p_empresa is null or r.empresa_id = p_empresa)
    and r.estado_revision <> 'anulada'
    and r.fecha_revision between rango.d1 and rango.d2
),
revs_prev as (
  select r.* from revisiones_vehiculo r, rango_prev
  where (p_empresa is null or r.empresa_id = p_empresa)
    and r.estado_revision <> 'anulada'
    and r.fecha_revision between rango_prev.p1 and rango_prev.p2
),
-- La profundidad de cada goma montada, ya juzgada (revisión completa,
-- protocolo contra falsos desgastes y kilómetros): tc_profundidad_vigente.
ult as (
  select g.neumatico_id, g.profundidad_mm, null::numeric as presion_bar, g.posicion_id,
    g.vehiculo_id, g.fecha_revision, g.empresa_id, g.medida, n.marca,
    n.modelo, n.reesculturado, g.severidad,
    g.minimo_mm as minmm, g.aviso_mm as avisomm
  from tc_profundidad_vigente(p_empresa) g
  join tc_neumaticos n on n.id = g.neumatico_id
  where g.profundidad_mm is not null
),
ultu as (select u.* from ult u),
clas as (
  select t.*,
    case
      when t.severidad = 3                              then 'critico'
      when t.severidad = 2                              then 'bajo'
      when t.profundidad_mm <= t.avisomm + 2            then 'medio'
      when t.profundidad_mm <= t.avisomm + 5            then 'bueno'
      else 'excelente'
    end as nivel,
    -- Bandas del "banco de goma", CERRADAS por arriba como en el informe:
    -- "mayor de 4 mm y hasta 6 mm" = (4,6], así un 6,0 exacto cae en 4-6.
    case
      when t.profundidad_mm <=  4  then '<=4'
      when t.profundidad_mm <=  6  then '4-6'
      when t.profundidad_mm <=  8  then '6-8'
      when t.profundidad_mm <= 10  then '8-10'
      when t.profundidad_mm <= 12  then '10-12'
      else '>12'
    end as banda
  from ultu t
),
-- Estado por vehículo = el de su peor neumático.
veh_estado as (
  select v.id, v.matricula, v.delegacion_id, v.km_actual,
    count(c.neumatico_id)                                  as n_neumaticos,
    min(c.profundidad_mm)                                  as min_mm,
    round(avg(c.profundidad_mm)::numeric, 2)               as media_mm,
    max(c.fecha_revision)                                  as ultima_revision,
    count(*) filter (where c.nivel = 'critico')            as n_criticos,
    count(*) filter (where c.nivel = 'bajo')               as n_bajos
  from veh v
  left join clas c on c.vehiculo_id = v.id
  group by v.id, v.matricula, v.delegacion_id, v.km_actual
),
veh_clasif as (
  select ve.*,
    case
      when ve.n_neumaticos = 0   then 'sin_datos'
      when ve.n_criticos   > 0   then 'intervenir'
      when ve.n_bajos      > 0   then 'revisar'
      when ve.min_mm <= 5        then 'vigilar'
      else 'correcto'
    end as semaforo
  from veh_estado ve
),
-- ── Desgaste medido: mm/día entre primera y última medición ──────────────
serie as (
  select d.neumatico_id, d.profundidad_mm::numeric as prof, rv.fecha_revision::date as fecha
  from revisiones_neumaticos_detalle d
  join revisiones_vehiculo rv on rv.id = d.revision_id
  join tc_neumaticos n on n.id = d.neumatico_id
  where d.profundidad_mm is not null and rv.estado_revision <> 'anulada'
    and (p_empresa is null or n.empresa_id = p_empresa)
),
ritmo as (
  select neumatico_id,
    (array_agg(prof  order by fecha asc ))[1] as prof_ini,
    (array_agg(prof  order by fecha desc))[1] as prof_fin,
    (array_agg(fecha order by fecha desc))[1] as fecha_fin,
    ((array_agg(fecha order by fecha desc))[1] - (array_agg(fecha order by fecha asc))[1]) as ddias
  from serie group by neumatico_id having count(*) >= 2
),
-- Solo cuenta el desgaste positivo: si la profundidad sube es que se cambió
-- el neumático o se corrigió una lectura.
prediccion as (
  select r.neumatico_id, c.minmm,
    (r.prof_ini - r.prof_fin) / nullif(r.ddias, 0) as mm_dia,
    c.profundidad_mm as prof_actual
  from ritmo r
  join clas c on c.neumatico_id = r.neumatico_id
  where r.ddias > 0 and (r.prof_ini - r.prof_fin) > 0
),
pred_dias as (
  select neumatico_id,
    floor((prof_actual - minmm) / nullif(mm_dia, 0))::int as dias_restantes
  from prediccion
),
-- ── Anomalías ────────────────────────────────────────────────────────────
eje_dif as (
  select c.vehiculo_id, v.matricula, p.eje,
    round((max(c.profundidad_mm) - min(c.profundidad_mm))::numeric, 1) as dif_mm,
    count(distinct nullif(trim(c.marca), '')) as n_marcas
  from clas c
  join tc_posiciones_vehiculo p on p.id = c.posicion_id
  join veh v on v.id = c.vehiculo_id
  where p.eje is not null
  group by c.vehiculo_id, v.matricula, p.eje
  having count(*) >= 2
),
-- ── Evolución mensual (12 meses) ─────────────────────────────────────────
meses as (
  select to_char(gs, 'YYYY-MM') as mes, gs::date as ini,
         (gs + interval '1 month - 1 day')::date as fin
  from generate_series(date_trunc('month', now()) - interval '11 months',
                       date_trunc('month', now()), interval '1 month') gs
),
-- Serie histórica del banco de goma: reparto por banda de cada mes, más
-- reesculturados y recauchutados. Cada mes cuenta SUS mediciones: la
-- columna de marzo es la foto de marzo.
evol_bandas as (
  select m.mes,
    count(d.profundidad_mm) as total,
    count(*) filter (where d.profundidad_mm <=  4) as b1,
    count(*) filter (where d.profundidad_mm >  4 and d.profundidad_mm <=  6) as b2,
    count(*) filter (where d.profundidad_mm >  6 and d.profundidad_mm <=  8) as b3,
    count(*) filter (where d.profundidad_mm >  8 and d.profundidad_mm <= 10) as b4,
    count(*) filter (where d.profundidad_mm > 10 and d.profundidad_mm <= 12) as b5,
    count(*) filter (where d.profundidad_mm > 12) as b6,
    count(*) filter (where n.reesculturado) as rees,
    count(*) filter (where mr.es_recau) as recau,
    count(*) filter (where n.reesculturado and mr.es_recau) as rees_y_recau
  from meses m
  left join revisiones_vehiculo r
    on r.estado_revision <> 'anulada'
   and r.fecha_revision between m.ini and m.fin
   and (p_empresa is null or r.empresa_id = p_empresa)
  left join revisiones_neumaticos_detalle d
    on d.revision_id = r.id and d.profundidad_mm is not null
  left join tc_neumaticos n on n.id = d.neumatico_id
  -- Recauchutado = la marca está marcada como tal en el catálogo (INSA...),
  -- mismo criterio que el informe de montaje y el asistente.
  left join lateral (
    select exists (
      select 1 from tc_cat_marcas_neumatico ma
      where ma.es_recauchutado and coalesce(ma.activo, true)
        and upper(trim(ma.nombre)) = upper(trim(coalesce(n.marca, '')))
    ) as es_recau
  ) mr on true
  group by m.mes
),
evol as (
  select m.mes,
    (select count(*) from revisiones_vehiculo r
      where (p_empresa is null or r.empresa_id = p_empresa)
        and r.estado_revision <> 'anulada'
        and r.fecha_revision between m.ini and m.fin) as revisiones,
    (select round(avg(d.profundidad_mm)::numeric, 2)
       from revisiones_neumaticos_detalle d
       join revisiones_vehiculo r on r.id = d.revision_id
      where (p_empresa is null or r.empresa_id = p_empresa)
        and r.estado_revision <> 'anulada' and d.profundidad_mm is not null
        and r.fecha_revision between m.ini and m.fin) as prof_media,
    (select count(*)
       from revisiones_neumaticos_detalle d
       join revisiones_vehiculo r on r.id = d.revision_id
      where (p_empresa is null or r.empresa_id = p_empresa)
        and r.estado_revision <> 'anulada' and d.profundidad_mm is not null
        and d.profundidad_mm <= 1.6
        and r.fecha_revision between m.ini and m.fin) as bajo_legal
  from meses m
)
select jsonb_build_object(
  'periodo', (select jsonb_build_object('desde', d1, 'hasta', d2) from rango),
  'periodo_anterior', (select jsonb_build_object('desde', p1, 'hasta', p2) from rango_prev),
  'generado', now(),

  'cabecera', jsonb_build_object(
    'vehiculos_total',     (select count(*) from veh),
    'vehiculos_revisados', (select count(distinct vehiculo_id) from revs),
    'vehiculos_pendientes',(select count(*) from veh where id not in (select vehiculo_id from revs)),
    'neumaticos_medidos',  (select count(*) from clas),
    'revisiones',          (select count(*) from revs)
  ),

  'comparativa', jsonb_build_object(
    'revisiones_actual',   (select count(*) from revs),
    'revisiones_previo',   (select count(*) from revs_prev),
    'vehiculos_revisados_actual', (select count(distinct vehiculo_id) from revs),
    'vehiculos_revisados_previo', (select count(distinct vehiculo_id) from revs_prev),
    'prof_media_actual', (
      select round(avg(d.profundidad_mm)::numeric, 2)
      from revisiones_neumaticos_detalle d join revs r on r.id = d.revision_id
      where d.profundidad_mm is not null),
    'prof_media_previo', (
      select round(avg(d.profundidad_mm)::numeric, 2)
      from revisiones_neumaticos_detalle d join revs_prev r on r.id = d.revision_id
      where d.profundidad_mm is not null),
    'criticos_actual', (
      select count(*) from revisiones_neumaticos_detalle d join revs r on r.id = d.revision_id
      where d.profundidad_mm is not null and d.profundidad_mm <= 1.6),
    'criticos_previo', (
      select count(*) from revisiones_neumaticos_detalle d join revs_prev r on r.id = d.revision_id
      where d.profundidad_mm is not null and d.profundidad_mm <= 1.6)
  ),

  'niveles', (
    select coalesce(jsonb_object_agg(nivel, n), '{}'::jsonb)
    from (select nivel, count(*) as n from clas group by nivel) x),
  'bandas', (
    select coalesce(jsonb_agg(jsonb_build_object('banda', banda, 'n', n) order by orden), '[]'::jsonb)
    from (
      select banda, count(*) as n,
        case banda when '<=4' then 1 when '4-6' then 2 when '6-8' then 3
                   when '8-10' then 4 when '10-12' then 5 else 6 end as orden
      from clas group by banda) x),

  'estadistica', (
    select jsonb_build_object(
      'n', count(*),
      'media',   round(avg(profundidad_mm)::numeric, 2),
      'mediana', round((percentile_cont(0.5) within group (order by profundidad_mm))::numeric, 2),
      'p10',     round((percentile_cont(0.1) within group (order by profundidad_mm))::numeric, 2),
      'p25',     round((percentile_cont(0.25) within group (order by profundidad_mm))::numeric, 2),
      'p75',     round((percentile_cont(0.75) within group (order by profundidad_mm))::numeric, 2),
      'p90',     round((percentile_cont(0.9) within group (order by profundidad_mm))::numeric, 2),
      'minimo',  round(min(profundidad_mm)::numeric, 2),
      'maximo',  round(max(profundidad_mm)::numeric, 2),
      'desviacion', round(coalesce(stddev_samp(profundidad_mm), 0)::numeric, 2),
      'coef_variacion', case when avg(profundidad_mm) > 0
        then round((coalesce(stddev_samp(profundidad_mm), 0) / avg(profundidad_mm) * 100)::numeric, 1) end
    ) from clas),

  -- Serie histórica del banco de goma (12 meses)
  'evolucion_bandas', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'total', total,
      'bandas', jsonb_build_object(
        '<=4', b1, '4-6', b2, '6-8', b3, '8-10', b4, '10-12', b5, '>12', b6),
      'reesculturados', rees,
      'recauchutados', recau,
      'rees_y_recau', rees_y_recau) order by mes), '[]'::jsonb)
    from evol_bandas),

  'evolucion', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'mes', mes, 'revisiones', revisiones,
      'prof_media', prof_media, 'bajo_legal', bajo_legal) order by mes), '[]'::jsonb)
    from evol),

  -- Se agrega primero y se construye el JSON después: agregar dentro de
  -- jsonb_build_object obliga a un GROUP BY imposible, y ordenar por
  -- (x->>'unidades') compararía TEXTO (el 9 iría antes que el 10).
  'por_medida', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'medida', medida, 'unidades', unidades,
      'prof_media', prof_media, 'criticos', criticos) order by unidades desc), '[]'::jsonb)
    from (
      select coalesce(nullif(trim(medida), ''), 'Sin registrar') as medida,
             count(*) as unidades,
             round(avg(profundidad_mm)::numeric, 2) as prof_media,
             count(*) filter (where nivel = 'critico') as criticos
      from clas group by coalesce(nullif(trim(medida), ''), 'Sin registrar')) y),
  'por_marca', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'marca', marca, 'unidades', unidades, 'prof_media', prof_media,
      'criticos', criticos, 'reesculturados', reesculturados) order by unidades desc), '[]'::jsonb)
    from (
      select coalesce(nullif(trim(marca), ''), 'Sin registrar') as marca,
             count(*) as unidades,
             round(avg(profundidad_mm)::numeric, 2) as prof_media,
             count(*) filter (where nivel = 'critico') as criticos,
             count(*) filter (where reesculturado) as reesculturados
      from clas group by coalesce(nullif(trim(marca), ''), 'Sin registrar')) y),

  'por_base', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'base', base, 'vehiculos', vehiculos, 'intervenir', intervenir,
      'revisar', revisar, 'sin_datos', sin_datos,
      'min_mm', min_mm, 'media_mm', media_mm) order by vehiculos desc), '[]'::jsonb)
    from (
      select coalesce(dl.nombre, 'Sin delegación') as base,
             count(*) as vehiculos,
             count(*) filter (where vc.semaforo = 'intervenir') as intervenir,
             count(*) filter (where vc.semaforo = 'revisar')    as revisar,
             count(*) filter (where vc.semaforo = 'sin_datos')  as sin_datos,
             round(min(vc.min_mm)::numeric, 1)   as min_mm,
             round(avg(vc.media_mm)::numeric, 2) as media_mm
      from veh_clasif vc
      left join tc_delegaciones dl on dl.id = vc.delegacion_id
      group by coalesce(dl.nombre, 'Sin delegación')) y),

  -- Por número de eje (sin etiquetar función: el dato no existe)
  'por_eje', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'eje', eje, 'unidades', unidades,
      'prof_media', prof_media, 'criticos', criticos) order by eje), '[]'::jsonb)
    from (
      select p.eje as eje, count(*) as unidades,
             round(avg(c.profundidad_mm)::numeric, 2) as prof_media,
             count(*) filter (where c.nivel = 'critico') as criticos
      from clas c join tc_posiciones_vehiculo p on p.id = c.posicion_id
      where p.eje is not null
      group by p.eje) y),

  'vehiculos', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'matricula', matricula,
      'base', (select dl.nombre from tc_delegaciones dl where dl.id = vc.delegacion_id),
      'semaforo', semaforo,
      'n_neumaticos', n_neumaticos,
      'min_mm', min_mm,
      'media_mm', media_mm,
      'criticos', n_criticos,
      'bajos', n_bajos,
      'km', km_actual,
      'ultima_revision', ultima_revision
    ) order by
      case semaforo when 'intervenir' then 1 when 'revisar' then 2
                    when 'vigilar' then 3 when 'correcto' then 4 else 5 end,
      min_mm asc nulls last), '[]'::jsonb)
    from veh_clasif vc),

  'anomalias', jsonb_build_object(
    'ejes_descompensados', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'matricula', matricula, 'eje', eje, 'dif_mm', dif_mm) order by dif_mm desc), '[]'::jsonb)
      from eje_dif where dif_mm >= 2),
    'ejes_marcas_mezcladas', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'matricula', matricula, 'eje', eje, 'marcas', n_marcas) order by n_marcas desc), '[]'::jsonb)
      from eje_dif where n_marcas > 1),
    'sin_marca', (select count(*) from clas where nullif(trim(marca), '') is null),
    'sin_medida', (select count(*) from clas where nullif(trim(medida), '') is null)
  ),

  'prediccion', jsonb_build_object(
    'con_ritmo_medido', (select count(*) from pred_dias),
    'sin_historico',    (select count(*) from clas c
                          where c.neumatico_id not in (select neumatico_id from pred_dias)),
    'vencidos',   (select count(*) from pred_dias where dias_restantes <= 0),
    'dias_30',    (select count(*) from pred_dias where dias_restantes >   0 and dias_restantes <=  30),
    'dias_60',    (select count(*) from pred_dias where dias_restantes >  30 and dias_restantes <=  60),
    'dias_90',    (select count(*) from pred_dias where dias_restantes >  60 and dias_restantes <=  90),
    'dias_180',   (select count(*) from pred_dias where dias_restantes >  90 and dias_restantes <= 180)
  )
);
$function$$fn$;

  -- Huella del cuerpo de cada función: la que había cuando se escribió esto y
  -- la nueva. Si en producción no es ninguna de las dos, alguien la ha cambiado
  -- entre medias y no se pisa.
  c_huellas constant jsonb := '{
      "tc_informes_alertas": [
          "5040cef72ba3fc898718997521af354a",
          "ebe1d63f79431968723e3631dae5b671"
      ],
      "tc_informes_kpis": [
          "c74db97bfb3afb5b9a20d2477800ffbd",
          "c8b27721c48dd8785eb94956d4a45fa5"
      ],
      "tc_informe_flota_detalle": [
          "6c2e97e2b79ecaa48173f8aa6b443aee",
          "c496164e34a3c807f5cf647c62483881"
      ],
      "tc_informes_estado_flota": [
          "9331868ed1ccad733f34d7da77c8dadc",
          "29f3c56a5caad2ea8bc294ce1c32109d"
      ],
      "tc_informe_ejecutivo_base": [
          "e2eb040c7c4f2cfce19469febe0cdc94",
          "45520f7b017cbd33f12f23b1d013747d"
      ]
  }'::jsonb;

  v_nombre text;
  v_huella text;
  v_empresa uuid;
  v_usuario uuid;
  v_quien text;
  v_t0 timestamptz;
  v_ms numeric;
  v_limite numeric;
  v_medicion text := '';
  v_n_vigente bigint;
  v_n_alertas bigint;
  v_n_kpis bigint;
  v_n_flota bigint;
  v_n_ejecutivo bigint;
  v_urg_estado bigint;
  v_urg_flota bigint;
  v_json jsonb;
begin
  -- Pegado desde Windows el texto llega con CRLF: se le quita a todo lo que se
  -- va a ejecutar.
  v_vigente := replace(v_vigente, chr(13), '');
  v_alertas := replace(v_alertas, chr(13), '');
  v_kpis := replace(v_kpis, chr(13), '');
  v_flota := replace(v_flota, chr(13), '');
  v_estado := replace(v_estado, chr(13), '');
  v_ejecutivo := replace(v_ejecutivo, chr(13), '');

  -- ── Antes de tocar nada ──────────────────────────────────────────────────
  if to_regprocedure('public.tc_profundidad_minima_por_llanta(text)') is null
     or to_regprocedure('public.tc_norm_medida(text)') is null
     or to_regclass('public.tc_montajes_actuales') is null then
    raise exception 'No se toca nada: falta tc_profundidad_minima_por_llanta, tc_norm_medida o tc_montajes_actuales.';
  end if;

  for v_nombre in select jsonb_object_keys(c_huellas) loop
    select md5(replace(p.prosrc, chr(13), '')) into v_huella
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_nombre;
    if v_huella is null then
      raise exception 'No se toca nada: no existe la función %.', v_nombre;
    end if;
    if not (c_huellas -> v_nombre) ? v_huella then
      raise exception 'No se toca nada: % ha cambiado desde que se escribió esta migración (huella %). Hay que rehacerla sobre la versión de ahora.',
        v_nombre, v_huella;
    end if;
  end loop;

  select rv.empresa_id into v_empresa
    from revisiones_vehiculo rv group by rv.empresa_id order by count(*) desc limit 1;

  begin
    -- 1. La función común y las cinco que la leen. Ninguna cambia las columnas
    --    que devuelve, así que vale `create or replace`.
    execute v_vigente;
    execute 'revoke execute on function tc_profundidad_vigente(uuid) from public, anon';
    execute 'grant execute on function tc_profundidad_vigente(uuid) to authenticated';
    execute 'grant execute on function tc_profundidad_vigente(uuid) to service_role';
    execute v_alertas;
    execute v_kpis;
    execute v_flota;
    execute v_estado;
    execute v_ejecutivo;

    -- 2. La prueba: como la aplicación, con RLS y con usuarios de verdad.
    foreach v_quien in array array['superadmin', 'de la empresa', 'operador'] loop
      v_usuario := case v_quien
        when 'superadmin' then (select u.id from tc_usuarios u where u.es_superadmin order by u.id limit 1)
        when 'de la empresa' then (select u.id from tc_usuarios u
                                    where u.empresa_id = v_empresa and not u.es_superadmin order by u.id limit 1)
        else (select oe.usuario_id from tc_operador_empresas oe where oe.empresa_id = v_empresa order by 1 limit 1)
      end;
      continue when v_usuario is null or v_empresa is null;

      perform set_config('request.jwt.claims',
                         json_build_object('sub', v_usuario, 'role', 'authenticated')::text, true);
      set local role authenticated;

      v_medicion := v_medicion || v_quien || ':';
      v_limite := c_limite_ms;
      if v_quien = 'operador' then
        v_limite := c_limite_operador_ms;
      end if;

      v_t0 := clock_timestamp();
      select count(*) filter (where g.severidad = 3) into v_n_vigente from tc_profundidad_vigente(v_empresa) g;
      v_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);
      v_medicion := v_medicion || format(' común %s ms,', v_ms);
      if v_ms > v_limite then
        reset role;
        raise exception using errcode = 'MB001', message = 'La función común no entra en el margen. ' || v_medicion;
      end if;

      v_t0 := clock_timestamp();
      select count(*) filter (where a.tipo = 'bajo_minimo') into v_n_alertas from tc_informes_alertas(v_empresa) a;
      v_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);
      v_medicion := v_medicion || format(' alertas %s ms,', v_ms);
      if v_ms > v_limite then
        reset role;
        raise exception using errcode = 'MB001', message = 'tc_informes_alertas no entra en el margen. ' || v_medicion;
      end if;

      v_t0 := clock_timestamp();
      v_json := tc_informes_kpis(v_empresa)::jsonb;
      v_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);
      v_n_kpis := (v_json ->> 'neumaticos_bajo_minimo')::bigint;
      v_medicion := v_medicion || format(' inicio %s ms,', v_ms);
      if v_ms > v_limite then
        reset role;
        raise exception using errcode = 'MB001', message = 'tc_informes_kpis no entra en el margen. ' || v_medicion;
      end if;

      v_t0 := clock_timestamp();
      v_json := tc_informes_estado_flota(v_empresa)::jsonb;
      v_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);
      v_urg_estado := (v_json ->> 'urgente')::bigint;
      v_medicion := v_medicion || format(' estado %s ms,', v_ms);
      if v_ms > v_limite then
        reset role;
        raise exception using errcode = 'MB001', message = 'tc_informes_estado_flota no entra en el margen. ' || v_medicion;
      end if;

      v_t0 := clock_timestamp();
      select coalesce(sum(f.bajo_minimo), 0), count(*) filter (where f.estado = 'urgente')
        into v_n_flota, v_urg_flota from tc_informe_flota_detalle(v_empresa) f;
      v_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);
      v_medicion := v_medicion || format(' flota %s ms,', v_ms);
      if v_ms > v_limite then
        reset role;
        raise exception using errcode = 'MB001', message = 'tc_informe_flota_detalle no entra en el margen. ' || v_medicion;
      end if;

      v_t0 := clock_timestamp();
      v_json := tc_informe_ejecutivo_base(v_empresa);
      v_ms := round(extract(epoch from clock_timestamp() - v_t0) * 1000);
      v_n_ejecutivo := coalesce((v_json -> 'niveles' ->> 'critico')::bigint, 0);
      v_medicion := v_medicion || format(' ejecutivo %s ms. ', v_ms);
      if v_ms > c_limite_ejecutivo_ms then
        reset role;
        raise exception using errcode = 'MB001', message = 'tc_informe_ejecutivo_base no entra en el margen. ' || v_medicion;
      end if;

      reset role;

      -- Para lo que se hace todo esto: que digan lo mismo. La lista de
      -- alertas, el inicio y el ejecutivo cuentan todas las gomas montadas;
      -- el Excel de flota, solo las de vehículos en seguimiento, así que
      -- puede dar menos pero nunca más. El semáforo y el Excel, iguales.
      if v_n_alertas <> v_n_vigente or v_n_kpis <> v_n_vigente or v_n_ejecutivo <> v_n_vigente
         or v_n_flota > v_n_vigente or v_urg_estado <> v_urg_flota then
        raise exception using errcode = 'MB001', message = format(
          'Los contadores no cuadran (%s): común %s, alertas %s, inicio %s, ejecutivo %s, flota %s; urgentes estado %s, flota %s. ',
          v_quien, v_n_vigente, v_n_alertas, v_n_kpis, v_n_ejecutivo, v_n_flota, v_urg_estado, v_urg_flota);
      end if;
      v_medicion := v_medicion || format('[para cambiar %s, vehículos urgentes %s] ', v_n_vigente, v_urg_estado);
    end loop;

    v_medicion := 'OK: los informes leen la profundidad ya juzgada. ' || v_medicion;

  exception when sqlstate 'MB001' then
    -- El sub-bloque se ha deshecho entero —funciones y rol incluidos—: queda
    -- todo como estaba y se cuenta por qué.
    v_medicion := 'NO INSTALADA, todo queda como estaba. ' || sqlerrm;
  end;

  perform set_config('mobilink.medicion', v_medicion, false);
  raise notice '%', v_medicion;
end
$migracion$;

-- El resultado de la prueba y las cifras de Plana. Solo llama a funciones que
-- existen se haya instalado o no. Esperado si se instala (medido el
-- 16/11/2026): 53 bajo mínimo, 237 próximos, 35 urgentes, 118 revisar,
-- 465 correcto, 104 pendiente, 53 críticos.
select current_setting('mobilink.medicion', true) as medicion,
       k.j ->> 'neumaticos_bajo_minimo' as inicio_bajo_minimo,
       k.j ->> 'neumaticos_proximos' as inicio_proximos,
       e.j ->> 'urgente' as flota_urgente,
       e.j ->> 'revisar' as flota_revisar,
       e.j ->> 'correcto' as flota_correcto,
       e.j ->> 'pendiente' as flota_pendiente,
       x.j -> 'niveles' ->> 'critico' as ejecutivo_criticos
  from (select tc_informes_kpis('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)::jsonb as j) k,
       (select tc_informes_estado_flota('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid)::jsonb as j) e,
       (select tc_informe_ejecutivo_base('a51c9662-4b6f-4681-8e2b-599e109659eb'::uuid) as j) x;
