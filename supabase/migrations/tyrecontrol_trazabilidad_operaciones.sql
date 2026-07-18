-- ============================================================
-- SEA TyreControl — Trazabilidad de operaciones e intervenciones
--
-- 1) Las reparaciones "en sitio" (reparar pinchazo, corregir presión…) que
--    resuelven una incidencia SIN desmontar el neumático pasan a registrarse
--    también en operaciones_neumaticos (tipo 'reparacion'), enlazadas a su
--    incidencia de origen, para que aparezcan en el histórico de operaciones
--    y en el informe de la intervención.
-- 2) Enlace operación → incidencia de origen (operaciones_neumaticos.incidencia_id).
-- 3) La intervención guarda el estado del vehículo ANTES y DESPUÉS (planos) y
--    las incidencias que la originaron, para la ficha con trazabilidad.
--
-- Idempotente: reejecutable sin efectos secundarios.
-- ============================================================

-- 1/2 · Enlace operación → incidencia de origen
alter table operaciones_neumaticos
  add column if not exists incidencia_id uuid references tc_incidencias(id) on delete set null;
create index if not exists idx_op_incidencia on operaciones_neumaticos (incidencia_id);

-- 3 · Snapshots e incidencias de origen en la intervención
alter table tc_intervenciones add column if not exists montaje_antes   jsonb;
alter table tc_intervenciones add column if not exists montaje_despues jsonb;
alter table tc_intervenciones add column if not exists incidencias     jsonb;
alter table tc_intervenciones add column if not exists imagen_chasis   text; -- para pintar el plano antes/después

-- ── tc_resolver_incidencia_parcial: además de cerrar la incidencia, deja
--    traza en operaciones_neumaticos cuando es una reparación en sitio ──────
create or replace function tc_resolver_incidencia_parcial(
  p_incidencia_id uuid,
  p_problema_ids uuid[],
  p_tipo text,
  p_medicion_final jsonb default null,
  p_material text default null,
  p_resultado text default null,
  p_observaciones text default null,
  p_foto_url text default null,
  p_tiempo_seg integer default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_inc tc_incidencias%rowtype;
  v_abiertos integer;
  v_uid uuid := auth.uid();
  v_rev_id uuid;
  v_rev_pend integer;
  v_mont record;
  v_motivo text;
begin
  select * into v_inc from tc_incidencias where id = p_incidencia_id;
  if not found then raise exception 'Incidencia no encontrada'; end if;
  if not tc_puede_ver_empresa(v_inc.empresa_id) then
    raise exception 'Sin permiso sobre esta incidencia';
  end if;

  -- Registrar la operación de resolución (log de la incidencia).
  insert into tc_incidencia_operaciones (
    incidencia_id, empresa_id, tipo, medicion_inicial, medicion_final,
    material, resultado, observaciones, foto_url, tecnico_id, tiempo_seg
  ) values (
    p_incidencia_id, v_inc.empresa_id, p_tipo, v_inc.medicion_inicial, p_medicion_final,
    p_material, p_resultado, p_observaciones, p_foto_url, v_uid, p_tiempo_seg
  );

  -- Traza en el histórico de operaciones SOLO para reparaciones "en sitio"
  -- (el neumático se queda montado). Las sustituciones ya generan sus propias
  -- operaciones de montaje/desmontaje y no deben duplicarse aquí.
  if p_tipo in ('reparar_pinchazo','corregir_presion','cambiar_valvula','equilibrar',
                'solicitar_alineacion','reapretar','actualizar_neumatico')
     and v_inc.posicion_id is not null then
    select ma.neumatico_id, ma.posicion_id, ma.vehiculo_id
      into v_mont
      from tc_montajes_actuales ma
     where ma.vehiculo_id = v_inc.vehiculo_id
       and ma.posicion_id = v_inc.posicion_id
     limit 1;
    if found then
      v_motivo := case p_tipo
                    when 'reparar_pinchazo' then 'pinchazo'
                    when 'corregir_presion' then 'preventivo'
                    else 'reparacion' end;
      insert into operaciones_neumaticos (
        empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
        km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino,
        tecnico_id, observaciones, incidencia_id
      ) values (
        v_inc.empresa_id, v_inc.vehiculo_id, v_mont.neumatico_id, 'reparacion', v_inc.posicion_id,
        null, current_date, v_motivo, 'montado', 'montado', 'vehiculo',
        v_uid, coalesce(p_observaciones, p_tipo), p_incidencia_id
      );
    end if;
  end if;

  -- Marcar los problemas indicados como solucionados.
  update tc_incidencia_problemas
     set estado = 'solucionado', resuelto_at = now()
   where incidencia_id = p_incidencia_id
     and id = any(p_problema_ids)
     and estado <> 'solucionado';

  -- ¿Quedan problemas abiertos en la incidencia?
  select count(*) into v_abiertos
    from tc_incidencia_problemas
   where incidencia_id = p_incidencia_id and estado <> 'solucionado';

  if v_abiertos = 0 then
    update tc_incidencias
       set estado = 'solucionada', resuelta_at = now(), resuelta_por = v_uid,
           medicion_final = coalesce(p_medicion_final, medicion_final)
     where id = p_incidencia_id;

    v_rev_id := v_inc.revision_id;
    if v_rev_id is not null then
      select count(*) into v_rev_pend
        from tc_incidencias
       where revision_id = v_rev_id
         and estado not in ('solucionada','cancelada','no_procede');
      if v_rev_pend = 0 then
        update revisiones_vehiculo
           set estado_revision = 'completada_con_incidencias'
         where id = v_rev_id
           and estado_revision = 'completada_incidencia_pendiente';
      end if;
    end if;

    return 'solucionada';
  end if;

  return v_inc.estado; -- sigue abierta (resolución parcial)
end $$;
