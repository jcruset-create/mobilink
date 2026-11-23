-- Kilómetros del MONTAJE pedidos desde la ficha del neumático (Movertis o a mano).
--
-- El km de un montaje vive en tc_montajes_actuales.km_montaje (y, al desmontar,
-- en tc_historial_montajes), y tc_montajes_actuales NO se toca desde aquí. Así
-- que el km que se pide desde la ficha se guarda APARTE, en
-- tc_km_montaje_complemento, por (neumático, vehículo, fecha de montaje): la
-- misma clave sirve para el montaje actual y para su fila del histórico cuando
-- se desmonte. Solo se usa cuando el montaje no tiene km propio.
--
--  1. tc_km_montaje_complemento (nueva).
--  2. tc_neumatico_recorrido(): km del montaje = el suyo o, si falta, el del
--     complemento; y el «hasta hoy» del montaje vigente = el mayor entre el km
--     actual del vehículo y el de su última revisión con km (hay vehículos con
--     km_actual a 0 cuya revisión de hoy marca 34.157 km).
--
-- No toca tc_montajes_actuales, tc_neumaticos, tc_vehiculo_ejes, config_ejes_id
-- ni tc_vehiculos.km_actual. Idempotente.

create table if not exists tc_km_montaje_complemento (
  neumatico_id  uuid not null references tc_neumaticos(id) on delete cascade,
  vehiculo_id   uuid not null references tc_vehiculos(id) on delete cascade,
  fecha_montaje date not null,
  km            numeric not null check (km > 0 and km < 10000000),
  origen        text not null check (origen in ('telematica', 'manual')),
  capturado_at  timestamptz,
  creado_por    uuid,
  created_at    timestamptz not null default now(),
  primary key (neumatico_id, vehiculo_id, fecha_montaje)
);
alter table tc_km_montaje_complemento enable row level security;
drop policy if exists tc_km_montaje_complemento_select on tc_km_montaje_complemento;
create policy tc_km_montaje_complemento_select on tc_km_montaje_complemento for select to authenticated
  using (
    (select tc_is_superadmin())
    or exists (select 1 from tc_vehiculos v
                where v.id = tc_km_montaje_complemento.vehiculo_id
                  and (v.empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(v.empresa_id)))
  );
-- Escribir: solo el servidor (administradores), con la clave de servicio.

create or replace function public.tc_neumatico_recorrido(p_neumatico uuid)
 returns jsonb
 language sql
 stable
as $function$
  with tramos as (
    -- Los pasados: del histórico, con sus dos extremos.
    select h.fecha_montaje as desde, h.fecha_desmontaje as hasta,
           coalesce(nullif(h.km_montaje, 0), c.km) as km_montaje, h.km_desmontaje,
           false as vigente
      from tc_historial_montajes h
      left join tc_km_montaje_complemento c
        on c.neumatico_id = h.neumatico_id and c.vehiculo_id = h.vehiculo_id and c.fecha_montaje = h.fecha_montaje
     where h.neumatico_id = p_neumatico
    union all
    -- Y el de ahora: hasta lo que lleva el vehículo hoy (su km actual o, si es
    -- mayor, el de su última revisión con km).
    select m.fecha_montaje, null,
           coalesce(nullif(m.km_montaje, 0), c.km),
           nullif(greatest(
             coalesce(v.km_actual, 0),
             coalesce((select max(r.km_vehiculo) from revisiones_vehiculo r
                        where r.vehiculo_id = v.id and r.estado_revision is distinct from 'anulada'), 0)
           ), 0),
           true
      from tc_montajes_actuales m
      join tc_vehiculos v on v.id = m.vehiculo_id
      left join tc_km_montaje_complemento c
        on c.neumatico_id = m.neumatico_id and c.vehiculo_id = m.vehiculo_id and c.fecha_montaje = m.fecha_montaje
     where m.neumatico_id = p_neumatico
  ), con_km as (
    select *, case when coalesce(km_montaje, 0) > 0 and coalesce(km_desmontaje, 0) > 0
                   then greatest(km_desmontaje - km_montaje, 0) end as km
      from tramos
  )
  select jsonb_build_object(
    'km_total',        coalesce(sum(km), 0),
    'tramos',          count(*),
    -- Los que no se pueden contar se DICEN. Un total al que le faltan tramos
    -- se lee como la vida entera de la goma, y no lo es.
    'tramos_sin_km',   count(*) filter (where km is null),
    'montado_ahora',   coalesce(bool_or(vigente), false),
    'detalle',         coalesce(jsonb_agg(jsonb_build_object(
                          'desde', desde, 'hasta', hasta,
                          'km_montaje', km_montaje, 'km_desmontaje', km_desmontaje,
                          'km', km, 'vigente', vigente
                        ) order by desde), '[]'::jsonb)
  ) from con_km;
$function$;

do $migracion$
begin
  if to_regclass('public.tc_km_montaje_complemento') is null then
    raise exception 'Falta tc_km_montaje_complemento';
  end if;
  perform set_config('mobilink.resultado', 'OK: km de montaje desde la ficha listo', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
