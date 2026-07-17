-- ============================================================
-- SEA TyreControl — Operaciones · Fase 4
-- Reparaciones con tipo/resultado (catálogo), proveedor y coste.
-- Las fotos se suben desde el front a tc_operacion_adjuntos.
-- Requiere: tyrecontrol_operaciones_fase1.sql
-- ============================================================

-- Mapea el resultado de la reparación al estado final del neumático.
create or replace function tc_estado_por_resultado_reparacion(p_resultado text)
returns text language sql immutable as $$
  select case p_resultado
    when 'reparado'     then 'almacen'          -- operativo, disponible
    when 'provisional'  then 'almacen'          -- usable, se anota en observaciones
    when 'seguimiento'  then 'reparacion'       -- queda en observación
    when 'proveedor'    then 'en_reparacion'    -- enviado a taller externo
    when 'no_reparable' then 'descartado'
    when 'sustituido'   then 'descartado'
    else 'reparacion'
  end;
$$;

create or replace function tc_registrar_reparacion(
  p_neumatico uuid,
  p_tipo_reparacion text,
  p_resultado text,
  p_proveedor text default null,
  p_coste numeric default null,
  p_km numeric default null,
  p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_neu record; v_estado_nuevo text; v_op uuid; v_tipo_nombre text; v_res_nombre text; v_activo boolean;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_neu.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_neu.empresa_id)) then
    raise exception 'Sin permiso para registrar reparaciones en esta empresa';
  end if;
  if v_neu.estado = 'montado' then raise exception 'El neumático está montado; desmóntalo antes de repararlo'; end if;

  if not exists (select 1 from tc_cat_tipos_reparacion where codigo = p_tipo_reparacion and activo) then
    raise exception 'Tipo de reparación no válido';
  end if;
  if not exists (select 1 from tc_cat_resultados_reparacion where codigo = p_resultado and activo) then
    raise exception 'Resultado de reparación no válido';
  end if;
  select nombre into v_tipo_nombre from tc_cat_tipos_reparacion where codigo = p_tipo_reparacion;
  select nombre into v_res_nombre from tc_cat_resultados_reparacion where codigo = p_resultado;

  v_estado_nuevo := tc_estado_por_resultado_reparacion(p_resultado);
  v_activo := case when v_estado_nuevo = 'descartado' then false else v_neu.activo end;

  update tc_neumaticos set estado = v_estado_nuevo, activo = v_activo, updated_at = now() where id = p_neumatico;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, km_vehiculo,
    fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, proveedor, coste, tecnico_id, observaciones,
    status, completed_at)
  values (v_neu.empresa_id, null, p_neumatico, 'reparacion', p_km, current_date, 'reparacion',
    v_neu.estado, v_estado_nuevo,
    case when v_estado_nuevo = 'descartado' then 'descarte' else 'reparacion' end,
    nullif(trim(coalesce(p_proveedor,'')), ''), p_coste, auth.uid(),
    trim(both ' ' from coalesce(p_obs,'') || ' [' || v_tipo_nombre || ' · ' || v_res_nombre || ']'),
    'completada', now())
  returning id into v_op;

  insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo, estado_anterior, estado_nuevo,
    profundidad_anterior, orden)
  values (v_op, p_neumatico, 'reparacion', v_neu.estado, v_estado_nuevo, v_neu.profundidad_actual_mm, 1);

  return v_op;
end $$;

-- ── Bucket de storage para adjuntos de operaciones (fotos) ────
insert into storage.buckets (id, name, public)
  values ('tc-operaciones', 'tc-operaciones', true)
  on conflict (id) do nothing;

drop policy if exists tc_operaciones_read on storage.objects;
create policy tc_operaciones_read on storage.objects for select
  using ( bucket_id = 'tc-operaciones' );

drop policy if exists tc_operaciones_write on storage.objects;
create policy tc_operaciones_write on storage.objects for insert
  with check ( bucket_id = 'tc-operaciones' and auth.uid() is not null );

drop policy if exists tc_operaciones_update on storage.objects;
create policy tc_operaciones_update on storage.objects for update
  using ( bucket_id = 'tc-operaciones' and auth.uid() is not null );
