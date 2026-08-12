-- ============================================================
-- Mobilink TyreControl — Control de revisiones: la flota por fecha
--
-- Falta la lista más simple y la que más se pide: TODOS los vehículos con su
-- última revisión, ordenados por esa fecha, para ver de un vistazo a quién le
-- toca y desde cuándo.
--
-- Lo que hay no cubre esto:
--   · "Histórico de revisiones" lista REVISIONES, una fila por cada una. Un
--     vehículo revisado seis veces sale seis veces y el que no se ha revisado
--     nunca no sale.
--   · El ejecutivo da el porcentaje agregado, no el listado.
--
-- Aquí es UNA FILA POR VEHÍCULO, incluidos los que no se han revisado jamás,
-- que son justamente los que hay que ver.
--
-- EL RANGO DE FECHAS filtra por la fecha de la última revisión. Sin rango
-- salen todos. Con rango salen los revisados por última vez dentro de él, y
-- los que no tienen ninguna revisión se quedan fuera: no tienen fecha con la
-- que entrar. Es lo que permite preguntar "¿a quién se revisó en julio?" o
-- "¿quién no se toca desde antes de marzo?".
--
-- Idempotente.
-- ============================================================

create or replace function public.tc_informe_control_revisiones(
  p_empresa uuid default null,
  p_desde   date default null,
  p_hasta   date default null
)
returns table (
  vehiculo_id      uuid,
  matricula        text,
  numero_unidad    text,
  base             text,
  tipo             text,
  ultima_revision  date,
  medido_at        timestamptz,
  origen           text,
  n_neumaticos     int,
  min_mm           numeric,
  dias_desde       int,
  intervalo_dias   int,
  proxima_revision date,
  dias_vencido     int,
  estado           text
)
language sql
security invoker
stable
set search_path = public
as $$
  with veh as (
    select v.id, v.matricula, v.numero_unidad,
           d.nombre as base,
           coalesce(t.descripcion, t.nombre) as tipo,
           coalesce(v.revision_intervalo_dias, t.revision_intervalo_dias) as intervalo
      from tc_vehiculos v
      left join tc_delegaciones d   on d.id = v.delegacion_id
      left join tc_tipos_vehiculo t on t.id = v.tipo_vehiculo_id
     where v.activo and (p_empresa is null or v.empresa_id = p_empresa)
  ),
  -- La última revisión completada de cada vehículo. distinct on es la forma
  -- de quedarse con la fila entera de ese máximo, no solo con la fecha.
  ult as (
    select distinct on (r.vehiculo_id)
           r.vehiculo_id, r.id as revision_id, r.fecha_revision::date as fecha, r.medido_at
      from revisiones_vehiculo r
     where r.estado_revision = 'completada'
       and (p_empresa is null or r.empresa_id = p_empresa)
     order by r.vehiculo_id, r.fecha_revision desc, r.created_at desc
  ),
  -- De esa revisión: cuántas ruedas se midieron, la peor, y si la hizo el
  -- arco o una persona. El método lo lleva cada rueda, así que se mira si
  -- TODAS son del arco: una revisión mixta no es "del arco".
  detalle as (
    select d.revision_id,
           count(*)::int as n,
           min(d.profundidad_mm) as peor,
           bool_and(d.metodo_profundidad = 'checkpoint'
                 or d.metodo_presion     = 'checkpoint') as todo_arco
      from revisiones_neumaticos_detalle d
      join ult u on u.revision_id = d.revision_id
     group by d.revision_id
  )
  select
    v.id, v.matricula, v.numero_unidad, v.base, v.tipo,
    u.fecha, u.medido_at,
    case when x.todo_arco then 'checkpoint' when u.revision_id is not null then 'tecnico' end,
    coalesce(x.n, 0), x.peor,
    case when u.fecha is not null then (current_date - u.fecha)::int end,
    v.intervalo,
    case when u.fecha is not null and v.intervalo is not null then u.fecha + v.intervalo end,
    case when u.fecha is not null and v.intervalo is not null
         then (current_date - (u.fecha + v.intervalo))::int end,
    case
      when v.intervalo is null then 'sin_intervalo'
      when u.fecha is null     then 'sin_revision'
      when current_date > u.fecha + v.intervalo then 'vencido'
      when (u.fecha + v.intervalo) - current_date <= 15 then 'proximo'
      else 'al_dia'
    end
  from veh v
  left join ult u     on u.vehiculo_id = v.id
  left join detalle x on x.revision_id = u.revision_id
  -- El rango se aplica a la fecha de la última revisión. Un vehículo sin
  -- ninguna no tiene fecha, así que solo aparece cuando no hay rango.
  where (p_desde is null or u.fecha >= p_desde)
    and (p_hasta is null or u.fecha <= p_hasta)
  -- Los que nunca se han revisado, primero: son los que más urge mirar.
  order by u.fecha asc nulls first, v.matricula;
$$;

comment on function public.tc_informe_control_revisiones(uuid, date, date) is
  'Una fila por vehículo con su última revisión, ordenados por esa fecha (los '
  'que no se han revisado nunca, primero). El rango filtra por la fecha de esa '
  'última revisión.';

grant execute on function public.tc_informe_control_revisiones(uuid, date, date) to authenticated;

-- ── Comprobación ────────────────────────────────────────────────────────────
do $$
declare n_total int; n_veh int; n_dup int;
begin
  select count(*) into n_total from tc_informe_control_revisiones(null, null, null);
  select count(*) into n_veh   from tc_vehiculos where activo;
  if n_total <> n_veh then
    raise exception 'Sin rango tienen que salir los % vehículos activos, y salen %', n_veh, n_total;
  end if;

  -- Una fila por vehículo: si "distinct on" fallara, un vehículo con varias
  -- revisiones saldría repetido y los totales del informe mentirían.
  select count(*) into n_dup from (
    select vehiculo_id from tc_informe_control_revisiones(null, null, null)
     group by vehiculo_id having count(*) > 1) x;
  if n_dup > 0 then
    raise exception '% vehículos salen repetidos', n_dup;
  end if;

  -- Con un rango imposible no puede salir nadie.
  if exists (select 1 from tc_informe_control_revisiones(null, '1900-01-01', '1900-01-02')) then
    raise exception 'El rango de fechas no filtra';
  end if;

  raise notice 'OK: control de revisiones, % vehículos, uno por fila', n_total;
end $$;
