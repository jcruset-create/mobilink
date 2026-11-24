-- Almacén de usados: clasificar las gomas «pendientes de clasificar» y que el
-- almacén enseñe también «stock usado» y «stock recauchutado».
--
-- En Empresa Plana el almacén salía vacío: 0 gomas en «almacen» y 1.446 en
-- «pendiente_clasificacion» que nadie había clasificado. Y lo que se clasifica
-- desde un desmontaje (almacén de flota / taller) pasa a «stock_usado», estado
-- que el almacén no miraba.
--
--  1. tc_almacen_usados(), tc_almacen_usados_resumen(), tc_reesculturar_en_almacen()
--     y tc_elegir_usado_almacen(): aceptan también stock_usado y stock_recauchutado.
--  2. tc_clasificacion_usados_log (nueva): quién clasificó qué, cuándo y adónde.
--  3. tc_pendientes_clasificar(p_empresa): las pendientes, con su grupo y sugerencia.
--  4. tc_clasificar_pendientes(p_empresa, p_ids, p_destino, p_obs): las manda al
--     almacén (stock_usado), a reciclaje (pendiente_reciclaje) o las da de baja
--     (activo = false). EXCEPCIÓN autorizada por Jordi: de tc_neumaticos solo se
--     cambia estado/activo, solo de gomas en pendiente_clasificacion y solo aquí.
--
-- No toca tc_montajes_actuales, tc_vehiculo_ejes, config_ejes_id ni
-- tc_vehiculos.km_actual. Idempotente.

-- ── 1. El almacén mira también stock_usado / stock_recauchutado ──────────────
create or replace function public.tc_almacen_usados(p_empresa uuid)
 returns table(neumatico_id uuid, numero_interno text, numero_serie text, rfid_epc text, dot text, marca text, modelo text, medida text, profundidad_actual_mm numeric, profundidad_actualizada_en timestamp with time zone, reesculturado boolean, estado text, origen text, fecha_desmontaje date, matricula_anterior text, km_acumulados numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  return query
  select n.id, n.numero_interno, n.numero_serie, n.rfid_epc, n.dot,
         n.marca, n.modelo, n.medida,
         n.profundidad_actual_mm, n.profundidad_actualizada_en,
         n.reesculturado, n.estado, n.origen,
         h.fecha_desmontaje, h.matricula,
         (select sum(greatest(coalesce(x.km_desmontaje,0) - coalesce(x.km_montaje,0), 0))
            from tc_historial_montajes x where x.neumatico_id = n.id)
    from tc_neumaticos n
    left join lateral (
      select hm.fecha_desmontaje, v.matricula
        from tc_historial_montajes hm
        left join tc_vehiculos v on v.id = hm.vehiculo_id
       where hm.neumatico_id = n.id
       order by hm.fecha_desmontaje desc nulls last
       limit 1
    ) h on true
   where n.empresa_id = p_empresa
     and n.activo = true
     and n.estado in ('almacen','reservado','stock_usado','stock_recauchutado')
   order by n.profundidad_actual_mm desc nulls last, n.numero_serie nulls last, n.numero_interno;
end $function$;

create or replace function public.tc_almacen_usados_resumen(p_empresa uuid)
 returns table(fichas bigint, con_identidad bigint, reesculturadas bigint, unidades_stock numeric)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_cliente uuid;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;
  return query
  select
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado','stock_usado','stock_recauchutado')),
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado','stock_usado','stock_recauchutado')
        and (n.rfid_epc is not null or n.numero_serie is not null)),
    (select count(*) from tc_neumaticos n
      where n.empresa_id = p_empresa and n.activo and n.estado in ('almacen','reservado','stock_usado','stock_recauchutado')
        and n.reesculturado),
    coalesce((select sum(case when ms.tipo = 'SALIDA' then -ms.cantidad else ms.cantidad end)::numeric
                from movimientos_stock ms
               where ms.cliente_id = v_cliente and ms.condicion = 'usado'), 0);
end $function$;

CREATE OR REPLACE FUNCTION public.tc_reesculturar_en_almacen(p_neumatico uuid, p_profundidad_mm numeric, p_obs text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_neu record; v_antes numeric;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;

  if not (tc_is_superadmin() or (tc_is_admin() and v_neu.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v_neu.empresa_id)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;

  -- Montada NO: para eso está el plan de trabajo, que la reesculpe en el
  -- camión y deja el parte entero como una sola operación deshacible.
  if v_neu.estado not in ('almacen','reservado','stock_usado','stock_recauchutado') then
    raise exception 'REESCULTURA_NO_EN_ALMACEN: el neumático % está en estado "%". Desde aquí solo se reesculpen las gomas que están en el almacén; si está puesta, hazlo desde el plan de trabajo del vehículo.',
      coalesce(v_neu.numero_interno,'?'), v_neu.estado;
  end if;
  if v_neu.activo is not true then
    raise exception 'REESCULTURA_DE_BAJA: el neumático % está dado de baja.', coalesce(v_neu.numero_interno,'?');
  end if;

  if p_profundidad_mm is null or p_profundidad_mm <= 0 then
    raise exception 'REESCULTURA_SIN_MM: hay que indicar los milímetros que quedan después de reesculturar.';
  end if;

  -- Reesculturar SUMA dibujo: si el número baja, es que alguien se ha
  -- equivocado de campo o de rueda.
  if v_neu.profundidad_actual_mm is not null and p_profundidad_mm < v_neu.profundidad_actual_mm then
    raise exception 'REESCULTURA_MENOS_DIBUJO: el neumático % tiene % mm y se están indicando % mm. Reesculturar añade dibujo, no lo quita.',
      coalesce(v_neu.numero_interno,'?'), v_neu.profundidad_actual_mm, p_profundidad_mm;
  end if;

  v_antes := v_neu.profundidad_actual_mm;

  -- El trigger de tyrecontrol_profundidad_manual.sql sella la fecha al cambiar
  -- el valor, así que la medición vieja deja de tapar a estos milímetros.
  update tc_neumaticos
     set profundidad_actual_mm = p_profundidad_mm,
         reesculturado = true,
         updated_at = now()
   where id = p_neumatico;

  insert into operaciones_neumaticos (empresa_id, neumatico_id, tipo_operacion,
    fecha_operacion, estado_anterior, estado_nuevo, tecnico_id, observaciones)
  values (v_neu.empresa_id, p_neumatico, 'reesculturado', current_date,
    v_neu.estado, v_neu.estado, auth.uid(),
    trim(both ' ' from coalesce(p_obs,'')
      || ' [REESCULTURADO EN ALMACÉN: ' || coalesce(v_antes::text,'?') || ' → ' || p_profundidad_mm || ' mm]'));

  return jsonb_build_object(
    'numero_interno', v_neu.numero_interno,
    'antes_mm', v_antes,
    'ahora_mm', p_profundidad_mm
  );
end $function$;

CREATE OR REPLACE FUNCTION public.tc_elegir_usado_almacen(p_empresa uuid, p_producto uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_prod record; v_id uuid;
begin
  select * into v_prod from productos_neumaticos where id = p_producto;
  if not found then return null; end if;

  select n.id into v_id
    from tc_neumaticos n
   where n.empresa_id = p_empresa
     and n.activo = true
     and n.estado in ('almacen','reservado','stock_usado','stock_recauchutado')
     and (
       n.almacen_producto_id = p_producto
       or (n.almacen_producto_id is null
           and n.marca is not null
           and upper(n.marca) = upper(v_prod.marca)
           and tc_medida_base(n.medida) = tc_medida_base(v_prod.medida))
     )
   order by n.profundidad_actual_mm desc nulls last, n.created_at
   limit 1;
  return v_id;
end $function$;

-- ── 2. Registro de clasificaciones ──────────────────────────────────────────
create table if not exists tc_clasificacion_usados_log (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null,
  neumatico_id  uuid not null references tc_neumaticos(id) on delete cascade,
  estado_antes  text not null,
  destino       text not null check (destino in ('almacen_flota','almacen_taller','reciclaje','baja')),
  observaciones text,
  usuario_id    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists ix_tc_clasif_usados_log_neu on tc_clasificacion_usados_log (neumatico_id);
alter table tc_clasificacion_usados_log enable row level security;
drop policy if exists tc_clasificacion_usados_log_select on tc_clasificacion_usados_log;
create policy tc_clasificacion_usados_log_select on tc_clasificacion_usados_log for select to authenticated
  using ((select tc_is_superadmin()) or empresa_id = (select tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id));

-- ── 3. Las pendientes de clasificar, con grupo y sugerencia ──────────────────
create or replace function public.tc_pendientes_clasificar(p_empresa uuid)
 returns table(neumatico_id uuid, codigo text, marca text, modelo text, medida text,
               profundidad_actual_mm numeric, origen text, grupo text, sugerido text, desde timestamptz)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  return query
  select n.id, coalesce(n.numero_interno, n.codigo_interno, n.numero_serie),
         n.marca, n.modelo, n.medida, n.profundidad_actual_mm, n.origen,
         g.grupo,
         case when g.grupo = 'provisional' then 'baja'
              when n.profundidad_actual_mm is not null then 'almacen'
              else 'decidir' end,
         n.updated_at
    from tc_neumaticos n
    cross join lateral (select case
        when coalesce(n.numero_interno, n.codigo_interno, '') like 'IMP-%' then 'provisional'
        when n.origen = 'importacion_excel' then 'excel'
        when n.origen = 'catalogo_usado' then 'catalogo_usado'
        else 'otros' end as grupo) g
   where n.empresa_id = p_empresa
     and n.activo = true
     and n.estado = 'pendiente_clasificacion'
   order by n.profundidad_actual_mm desc nulls last, 2;
end $function$;

-- ── 4. Clasificar en lote ───────────────────────────────────────────────────
create or replace function public.tc_clasificar_pendientes(
  p_empresa uuid, p_ids uuid[], p_destino text, p_obs text default null
)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n int := 0;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador de la empresa puede clasificar neumáticos';
  end if;
  if p_destino not in ('almacen_flota','almacen_taller','reciclaje','baja') then
    raise exception 'Destino no válido: %', p_destino;
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then return jsonb_build_object('clasificadas', 0); end if;
  if array_length(p_ids, 1) > 2000 then raise exception 'Como mucho 2000 de una vez'; end if;

  -- Solo las de ESTA empresa, activas y pendientes de clasificar: el resto se ignora.
  with objetivo as (
    select n.id, n.estado from tc_neumaticos n
     where n.id = any(p_ids) and n.empresa_id = p_empresa
       and n.activo = true and n.estado = 'pendiente_clasificacion'
     for update
  ), log as (
    insert into tc_clasificacion_usados_log (empresa_id, neumatico_id, estado_antes, destino, observaciones, usuario_id)
    select p_empresa, o.id, o.estado, p_destino, nullif(btrim(coalesce(p_obs, '')), ''), auth.uid() from objetivo o
    returning neumatico_id
  )
  update tc_neumaticos n
     set estado = case p_destino when 'reciclaje' then 'pendiente_reciclaje'
                                 when 'baja' then n.estado
                                 else 'stock_usado' end,
         activo = case when p_destino = 'baja' then false else n.activo end,
         updated_at = now()
    from log
   where n.id = log.neumatico_id;
  get diagnostics v_n = row_count;
  return jsonb_build_object('clasificadas', v_n, 'destino', p_destino);
end $function$;

grant execute on function public.tc_pendientes_clasificar(uuid) to authenticated;
grant execute on function public.tc_clasificar_pendientes(uuid, uuid[], text, text) to authenticated;

do $migracion$
begin
  if to_regclass('public.tc_clasificacion_usados_log') is null then raise exception 'Falta el registro'; end if;
  if to_regprocedure('public.tc_clasificar_pendientes(uuid,uuid[],text,text)') is null then raise exception 'Falta tc_clasificar_pendientes'; end if;
  if (select prosrc from pg_proc where proname = 'tc_almacen_usados') not like '%stock_usado%' then
    raise exception 'tc_almacen_usados no mira stock_usado';
  end if;
  perform set_config('mobilink.resultado', 'OK: almacén de usados y clasificación de pendientes listos', false);
end
$migracion$;

select current_setting('mobilink.resultado', true) as resultado;
