-- ============================================================
-- SEA TyreControl — El estado de la flota, vehículo a vehículo.
--
-- `tc_informes_estado_flota` ya clasifica la flota, pero devuelve solo los
-- RECUENTOS: 542 correctos, 65 a revisar, 1 urgente. Para un Excel hace
-- falta la lista, y para que el Excel y la pantalla no se contradigan, la
-- clasificación tiene que ser LA MISMA.
--
-- Por eso esta función repite la cascada de severidad tal cual está en la
-- otra —medida → categoría → empresa → 1,6 mm— en vez de inventarse una
-- parecida. Se ha comprobado contra producción: agregando estas filas por
-- cliente y estado salen exactamente los mismos números que devuelve
-- `tc_informes_estado_flota` para cada empresa.
--
-- Si algún día cambia el criterio, hay que cambiarlo en las dos. Lo ideal
-- sería que la de recuentos agregara sobre ésta; no se hace ahora porque
-- tocar la función que alimenta el panel es otro cambio y otro riesgo.
--
-- `security invoker`: la RLS de `tc_vehiculos` sigue mandando, así que un
-- cliente solo ve su flota aunque pida otra empresa.
--
-- Reversible con `drop function`. No altera ninguna tabla.
-- ============================================================

create or replace function tc_informe_flota_detalle(p_empresa uuid default null)
returns table (
  cliente             text,
  matricula           text,
  unidad              text,
  base                text,
  tipo                text,
  config              text,
  medida              text,
  estado              text,
  ultima_revision     text,
  dias_desde          int,
  ruedas_plano        bigint,
  ruedas_montadas     bigint,
  ruedas_medidas      bigint,
  profundidad_minima  numeric,
  bajo_minimo         bigint,
  en_aviso            bigint,
  km_actual           numeric
)
language sql stable security invoker set search_path = public as $$
with veh as (
  select v.id, v.empresa_id, v.matricula, v.numero_unidad, v.km_actual,
         v.delegacion_id, v.tipo_vehiculo_id, v.medida_id, v.medidas_por_eje, v.config_ejes_id
    from tc_vehiculos v
   where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
),
ultrev as (
  select distinct on (rv.vehiculo_id) rv.vehiculo_id, rv.id revision_id,
         rv.fecha_revision, rv.estado_revision
    from revisiones_vehiculo rv
   where rv.estado_revision <> 'anulada'
     and (p_empresa is null or rv.empresa_id = p_empresa)
   order by rv.vehiculo_id, rv.fecha_revision desc, rv.created_at desc
),
tyre as (
  select ur.vehiculo_id, d.profundidad_mm,
         coalesce(um.profundidad_minima_mm, uc.profundidad_minima_mm, ue.profundidad_minima_mm, 1.6) minmm,
         coalesce(um.profundidad_aviso_mm,  uc.profundidad_aviso_mm,  ue.profundidad_aviso_mm,  3.0) avisomm
    from ultrev ur
    join revisiones_neumaticos_detalle d on d.revision_id = ur.revision_id and d.profundidad_mm is not null
    join tc_neumaticos n on n.id = d.neumatico_id
    left join tc_config_umbrales ue on ue.empresa_id = n.empresa_id
    left join tc_cat_medidas_neumatico cm on lower(cm.valor) = lower(n.medida)
    left join tc_config_umbrales_medida um on um.empresa_id = n.empresa_id
      and regexp_replace(upper(um.medida),'\s','','g') = regexp_replace(upper(coalesce(n.medida,'')),'\s','','g')
    left join tc_config_umbrales_categoria uc on uc.empresa_id = n.empresa_id and uc.categoria = cm.categoria
),
agg as (
  select vehiculo_id, count(*) medidas, min(profundidad_mm) minimo,
         count(*) filter (where profundidad_mm <= minmm) bajo_minimo,
         count(*) filter (where profundidad_mm > minmm and profundidad_mm <= avisomm) en_aviso,
         max(case when profundidad_mm <= minmm then 3 when profundidad_mm <= avisomm then 2 else 1 end) sev
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
$$;

comment on function tc_informe_flota_detalle(uuid) is
  'El estado de la flota vehículo a vehículo, con la MISMA clasificación que '
  'tc_informes_estado_flota (medida → categoría → empresa → 1,6 mm). Para el '
  'Excel: la de recuentos no devuelve la lista. security invoker.';

grant execute on function tc_informe_flota_detalle(uuid) to authenticated;
