-- Recauchutado y reesculturado en la ficha de cada neumático.
--
-- Lo pidió Jordi: al informar las gomas que ya lleva un vehículo, una casilla
-- por posición para «recauchutado» y otra para «reesculturado», que salgan
-- marcadas solas cuando ya se sabe, y que los informes las cuenten.
--
--  1. tc_neumaticos.recauchutado (nueva, boolean, por defecto false).
--     Excepción autorizada a «no modificar tc_neumaticos»: SOLO se añade la
--     columna; no se borra, renombra ni cambia ninguna otra.
--  2. INSATRUCK son recauchutados de Insa: se unifica en una sola marca.
--     - Alias en tc_cat_marcas_alias (nuevo) y tc_marca_normalizada lo usa,
--       así «INSATRUCK» escrito a mano o importado acaba en «Insa».
--     - Las 4 gomas «INSATRUCK» pasan a «Insa».
--     - La marca, su modelo y su referencia duplicada (INSATRUCK T3 385/65,
--       que ya existe como INSA T3) se DESACTIVAN, no se borran.
--  3. Relleno: recauchutado = true en las gomas de marca recauchutadora.
--     Solo pone true, nunca quita.
--  4. Trigger: a futuro, una goma de marca recauchutadora sale recauchutada
--     sola. Nunca pone false.
--  5. tc_inventario_inicial_posicion guarda las dos casillas (solo suman).
--  6. tc_informe_ejecutivo_base: recauchutado = campo de la goma O marca, y
--     «Por marca» cuenta también los recauchutados.
--
-- No toca tc_montajes_actuales, tc_vehiculo_ejes, config_ejes_id ni
-- tc_vehiculos.km_actual. Idempotente: se puede pegar dos veces.

alter table tc_neumaticos add column if not exists recauchutado boolean not null default false;

create table if not exists tc_cat_marcas_alias (
  alias    text primary key,
  marca_id uuid not null references tc_cat_marcas_neumatico(id) on delete cascade
);
alter table tc_cat_marcas_alias enable row level security;
drop policy if exists tc_cat_marcas_alias_lectura on tc_cat_marcas_alias;
create policy tc_cat_marcas_alias_lectura on tc_cat_marcas_alias for select to authenticated using (true);

create or replace function public.tc_marca_normalizada(p text)
 returns text
 language plpgsql
 stable
as $function$
declare t text; v text;
begin
  if tc_marca_es_vacia(p) then return null; end if;
  t := btrim(regexp_replace(p, '\s+', ' ', 'g'));
  -- Un alias manda: «INSATRUCK» es Insa.
  select m.nombre into v
    from tc_cat_marcas_alias a join tc_cat_marcas_neumatico m on m.id = a.marca_id
   where upper(a.alias) = upper(t)
   limit 1;
  if v is not null then return v; end if;
  select nombre into v from tc_cat_marcas_neumatico
   where upper(nombre) = upper(t)
   order by activo desc, created_at, id
   limit 1;
  return coalesce(v, t);
end $function$;

-- Recauchutado por marca, a futuro. Va DESPUÉS del de normalizar la marca
-- (los BEFORE se disparan por orden alfabético: «marca» < «recauchutado»).
create or replace function public.tc_neumatico_recauchutado_trg()
 returns trigger
 language plpgsql
as $function$
begin
  if not coalesce(new.recauchutado, false) and exists (
       select 1 from tc_cat_marcas_neumatico ma
        where ma.es_recauchutado
          and upper(trim(ma.nombre)) = upper(trim(coalesce(new.marca, '')))) then
    new.recauchutado := true;
  end if;
  return new;
end $function$;

drop trigger if exists trg_tc_neumaticos_recauchutado on tc_neumaticos;
create trigger trg_tc_neumaticos_recauchutado
  before insert or update of marca, recauchutado on tc_neumaticos
  for each row execute function tc_neumatico_recauchutado_trg();

-- Guarda las casillas al informar la goma.
create or replace function public.tc_inventario_inicial_posicion(p_vehiculo uuid, p_posicion uuid, p_referencia uuid, p_datos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  declare
    v_veh        record;
    v_empresa    uuid;
    v_revision   uuid;
    v_neumatico  uuid;
    v_montaje    record;
    v_profundidad numeric;
    v_presion    numeric;
    v_serie      text;
    v_dot        text;
    v_rfid       text;
    v_total      int;
    v_hechas     int;
  begin
    select * into v_veh from tc_vehiculos where id = p_vehiculo;
    if not found then raise exception 'Vehículo no encontrado'; end if;
    v_empresa := v_veh.empresa_id;

    if not (tc_is_superadmin()
            or (tc_is_admin() and v_empresa = tc_auth_empresa_id())
            or tc_operador_ve_empresa(v_empresa)) then
      raise exception 'Sin permiso sobre este vehículo';
    end if;

    v_profundidad := nullif(p_datos->>'profundidad_mm', '')::numeric;
    if v_profundidad is null then
      raise exception 'Falta la profundidad: sin ella la goma no se puede seguir.';
    end if;
    if v_profundidad < 0 or v_profundidad > 30 then
      raise exception 'Profundidad imposible: % mm.', v_profundidad;
    end if;
    v_presion := nullif(p_datos->>'presion_bar', '')::numeric;
    if v_presion is not null and (v_presion <= 0 or v_presion > 15) then
      raise exception 'Presión imposible: % bar.', v_presion;
    end if;
    v_serie := nullif(trim(p_datos->>'numero_serie'), '');
    v_dot   := nullif(trim(p_datos->>'dot'), '');
    v_rfid  := nullif(upper(trim(p_datos->>'rfid_epc')), '');

    if v_serie is not null and exists (
         select 1 from tc_neumaticos
          where empresa_id = v_empresa and numero_serie = v_serie and activo) then
      raise exception 'Ese número de serie (%) ya está en otro neumático de esta empresa.', v_serie;
    end if;

    select * into v_montaje from tc_montajes_actuales
     where vehiculo_id = p_vehiculo and posicion_id = p_posicion;

    -- El RFID es único en toda la base. Si ya lo lleva una goma montada en otra
    -- rueda, se dice en vez de reventar el índice.
    if v_rfid is not null and exists (
         select 1 from tc_neumaticos n
           join tc_montajes_actuales m on m.neumatico_id = n.id
          where n.rfid_epc = v_rfid
            and not (m.vehiculo_id = p_vehiculo and m.posicion_id = p_posicion)) then
      raise exception 'Esa etiqueta RFID (%) ya está en una goma montada en otra rueda.', v_rfid;
    end if;

    select id into v_revision from revisiones_vehiculo
     where vehiculo_id = p_vehiculo and estado_revision = 'borrador'
     order by created_at desc limit 1;
    if v_revision is null then
      insert into revisiones_vehiculo (empresa_id, vehiculo_id, tecnico_id, estado_revision, observaciones)
      values (v_empresa, p_vehiculo, auth.uid(), 'borrador', 'Inventario inicial del vehículo')
      returning id into v_revision;
    end if;

    if v_montaje.id is not null then
      v_neumatico := v_montaje.neumatico_id;
      -- Corrección: el RFID se pone solo a una goma creada por este mismo
      -- inventario y que aún no lo tenía. Una goma con historia no se toca.
      if v_rfid is not null then
        update tc_neumaticos set rfid_epc = v_rfid, updated_at = now()
         where id = v_neumatico and origen = 'carga_inicial' and rfid_epc is null;
      end if;
    else
      v_neumatico := tc_montar_desde_catalogo(
        p_vehiculo, p_posicion, p_referencia,
        true,
        jsonb_build_object('numero_serie', v_serie, 'dot', v_dot, 'rfid_epc', v_rfid,
                           'profundidad_actual_mm', v_profundidad::text),
        null,
        current_date,
        'Inventario inicial: la goma ya estaba montada',
        false,
        'usado');

      update tc_neumaticos set origen = 'carga_inicial', updated_at = now()
       where id = v_neumatico;
      update operaciones_neumaticos
         set estado_anterior = 'inventario_inicial',
             observaciones = 'Inventario inicial: la goma ya estaba montada cuando el vehículo entró en TyreControl. No es una venta ni un trabajo facturable.'
       where neumatico_id = v_neumatico and tipo_operacion = 'montaje';
    end if;

    -- Recauchutado / reesculturado marcados en la pantalla. Solo SUMAN: una
    -- casilla sin marcar no le quita a la goma lo que ya fuera. La marca
    -- recauchutadora la marca sola el trigger de tc_neumaticos.
    if coalesce(p_datos->>'recauchutado', '') = 'true' or coalesce(p_datos->>'reesculturado', '') = 'true' then
      update tc_neumaticos
         set recauchutado  = recauchutado  or coalesce(p_datos->>'recauchutado', '')  = 'true',
             reesculturado = reesculturado or coalesce(p_datos->>'reesculturado', '') = 'true',
             updated_at = now()
       where id = v_neumatico;
    end if;

    insert into revisiones_neumaticos_detalle (
      revision_id, empresa_id, vehiculo_id, neumatico_id, posicion_id,
      profundidad_mm, presion_bar, metodo_profundidad, metodo_presion,
      observaciones, foto_url)
    values (
      v_revision, v_empresa, p_vehiculo, v_neumatico, p_posicion,
      v_profundidad, v_presion, 'manual',
      case when v_presion is null then null else 'manual' end,
      nullif(trim(p_datos->>'observaciones'), ''), nullif(trim(p_datos->>'foto_url'), ''))
    on conflict (revision_id, posicion_id) do update set
      neumatico_id       = excluded.neumatico_id,
      profundidad_mm     = excluded.profundidad_mm,
      presion_bar        = excluded.presion_bar,
      metodo_profundidad = excluded.metodo_profundidad,
      metodo_presion     = excluded.metodo_presion,
      observaciones      = excluded.observaciones,
      foto_url           = coalesce(excluded.foto_url, revisiones_neumaticos_detalle.foto_url);

    select count(*)::int into v_total
      from tc_posiciones_vehiculo where tipo_vehiculo_id = v_veh.tipo_vehiculo_id and activo;
    select count(*)::int into v_hechas
      from revisiones_neumaticos_detalle
     where revision_id = v_revision and profundidad_mm is not null;

    return jsonb_build_object(
      'revision_id', v_revision,
      'neumatico_id', v_neumatico,
      'numero_interno', (select numero_interno from tc_neumaticos where id = v_neumatico),
      'hechas', v_hechas, 'total', v_total,
      'presion_medida', v_presion is not null,
      'rfid_epc', (select rfid_epc from tc_neumaticos where id = v_neumatico));
  end $function$;

-- Informe ejecutivo: recauchutado = campo de la goma o marca recauchutadora.
create or replace function public.tc_informe_ejecutivo_base(p_empresa uuid DEFAULT NULL::uuid, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date)
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
    n.modelo, n.reesculturado, n.recauchutado, g.severidad,
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
    select coalesce(n.recauchutado, false) or exists (
      select 1 from tc_cat_marcas_neumatico ma
      where ma.es_recauchutado
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
      'criticos', criticos, 'reesculturados', reesculturados,
      'recauchutados', recauchutados) order by unidades desc), '[]'::jsonb)
    from (
      select coalesce(nullif(trim(marca), ''), 'Sin registrar') as marca,
             count(*) as unidades,
             round(avg(profundidad_mm)::numeric, 2) as prof_media,
             count(*) filter (where nivel = 'critico') as criticos,
             count(*) filter (where reesculturado) as reesculturados,
             count(*) filter (where recauchutado) as recauchutados
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
$function$;

do $migracion$
declare
  v_insa uuid; v_truck uuid; v_ref_insa uuid; v_ref_truck uuid;
  v_gomas int; v_marcadas int; v_total_recau int;
begin
  select id into v_insa from tc_cat_marcas_neumatico where nombre = 'Insa' order by activo desc, created_at limit 1;
  if v_insa is null then raise exception 'No existe la marca Insa en el catálogo'; end if;
  select id into v_truck from tc_cat_marcas_neumatico where upper(nombre) = 'INSATRUCK' limit 1;

  update tc_cat_marcas_neumatico set es_recauchutado = true where id = v_insa and not es_recauchutado;
  insert into tc_cat_marcas_alias (alias, marca_id) values ('INSATRUCK', v_insa)
    on conflict (alias) do nothing;

  if v_truck is not null then
    -- La referencia duplicada: los productos que la usaran pasan a la de Insa.
    select r.id into v_ref_truck from tc_referencias_neumatico r
      join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
     where mo.marca_id = v_truck and r.referencia_completa = 'INSATRUCK T3 385/65 R22.5 158L';
    select id into v_ref_insa from tc_referencias_neumatico where referencia_completa = 'INSA T3 385/65 R22.5 158L';
    if v_ref_truck is not null and v_ref_insa is not null then
      update productos_neumaticos set referencia_neumatico_id = v_ref_insa
       where referencia_neumatico_id = v_ref_truck;
    end if;
    update tc_referencias_neumatico set activo = false, updated_at = now()
     where modelo_id in (select id from tc_cat_modelos_neumatico where marca_id = v_truck) and activo;
    update tc_cat_modelos_neumatico set activo = false
     where marca_id = v_truck and coalesce(activo, true);
    update tc_cat_marcas_neumatico set activo = false, es_recauchutado = true where id = v_truck;
  end if;

  -- Las gomas: INSATRUCK → Insa (el trigger de marca ya usa el alias).
  update tc_neumaticos set marca = 'Insa', updated_at = now()
   where upper(btrim(marca)) = 'INSATRUCK';
  get diagnostics v_gomas = row_count;

  -- Relleno: solo pone true.
  update tc_neumaticos n set recauchutado = true
   where not n.recauchutado and exists (
     select 1 from tc_cat_marcas_neumatico ma
      where ma.es_recauchutado and upper(trim(ma.nombre)) = upper(trim(coalesce(n.marca, ''))));
  get diagnostics v_marcadas = row_count;

  -- Autocomprobación.
  if tc_marca_normalizada('insatruck') <> 'Insa' then raise exception 'El alias INSATRUCK no normaliza a Insa'; end if;
  if exists (select 1 from tc_neumaticos where upper(btrim(marca)) = 'INSATRUCK') then
    raise exception 'Quedan gomas con marca INSATRUCK';
  end if;
  if exists (select 1 from tc_neumaticos n where not n.recauchutado and upper(trim(coalesce(n.marca,''))) = 'INSA') then
    raise exception 'Quedan gomas Insa sin marcar como recauchutadas';
  end if;
  select count(*) into v_total_recau from tc_neumaticos where recauchutado;

  perform set_config('mobilink.resultado', format(
    'OK: %s gomas INSATRUCK pasan a Insa · %s marcadas ahora como recauchutadas · %s recauchutadas en total',
    v_gomas, v_marcadas, v_total_recau), false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
