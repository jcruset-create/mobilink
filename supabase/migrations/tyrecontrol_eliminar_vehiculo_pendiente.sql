-- ============================================================
-- SEA TyreControl — Borrar un vehículo que nunca llegó a usarse.
--
-- La lista de «pendientes de validar» se llena de vehículos que no deberían
-- existir: altas duplicadas desde la tablet, importaciones de Excel con
-- matrículas de prueba, vehículos que la conciliación creó y que el cliente
-- ya no tiene. Hasta ahora la única salida era darlos de baja, y seguían ahí
-- ocupando sitio en todas las listas.
--
-- ── Por qué no un DELETE a secas ────────────────────────────────────────────
--
-- Porque la base NO frena. De todo lo que apunta a `tc_vehiculos`:
--
--   * se borraría en cascada la ficha técnica, el historial de ITV, el plan
--     de mantenimiento, los ejes y medidas y la presencia en bases;
--   * se quedarían HUÉRFANAS, sin decir nada, las operaciones de neumático,
--     las intervenciones, los partes y la productividad: son `on delete set
--     null`, así que la vida del NEUMÁTICO sobrevive pero pierde a qué
--     vehículo se montó. Eso es peor que borrar: deja un registro que miente
--     por omisión, y la vida del neumático es el activo de este producto.
--
-- Solo dos claves están en `restrict`. Confiar en ellas sería confiar en que
-- el histórico está justo en esas dos tablas, que no es el caso.
--
-- Por eso esta función borra ÚNICAMENTE vehículos sin nada detrás, y cuando
-- hay algo no borra: lo dice y deja que la persona decida darlo de baja, que
-- conserva todo. El límite es a propósito y no debería relajarse sin pensar
-- muy bien qué se hace entonces con el histórico del neumático.
-- ============================================================

create or replace function tc_eliminar_vehiculo(p_vehiculo uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v        record;
  v_lastre text[] := '{}';
  v_n      int;
begin
  select * into v from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;

  -- Borrar es cosa del administrador de la empresa, igual que validar.
  if not (tc_is_superadmin() or (tc_is_admin() and v.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Sólo un administrador elimina vehículos';
  end if;

  -- ¿Tiene vida detrás? Se cuenta todo lo que ata al vehículo con la historia
  -- de un neumático o con un parte firmado por alguien.
  select count(*) into v_n from revisiones_vehiculo where vehiculo_id = p_vehiculo;
  if v_n > 0 then v_lastre := v_lastre || format('%s revisión/es', v_n); end if;

  select count(*) into v_n from tc_montajes_actuales where vehiculo_id = p_vehiculo;
  if v_n > 0 then v_lastre := v_lastre || format('%s neumático/s montado/s', v_n); end if;

  select count(*) into v_n from operaciones_neumaticos where vehiculo_id = p_vehiculo;
  if v_n > 0 then v_lastre := v_lastre || format('%s operación/es de neumático', v_n); end if;

  select count(*) into v_n from tc_intervenciones where vehiculo_id = p_vehiculo;
  if v_n > 0 then v_lastre := v_lastre || format('%s intervención/es', v_n); end if;

  select count(*) into v_n from tc_incidencias where vehiculo_id = p_vehiculo;
  if v_n > 0 then v_lastre := v_lastre || format('%s incidencia/s', v_n); end if;

  if array_length(v_lastre, 1) > 0 then
    raise exception 'Este vehículo tiene historial (%) y no se puede eliminar: dalo de baja para conservarlo.',
      array_to_string(v_lastre, ', ');
  end if;

  delete from tc_vehiculos where id = p_vehiculo;
end $$;

comment on function tc_eliminar_vehiculo(uuid) is
  'Borra un vehículo que no llegó a usarse (alta duplicada, matrícula de '
  'prueba, importación equivocada). Solo el administrador de su empresa, y '
  'SOLO si no tiene revisiones, montajes, operaciones, intervenciones ni '
  'incidencias: con historial falla a propósito y pide darlo de baja, porque '
  'media docena de claves ajenas son ON DELETE SET NULL y el borrado dejaría '
  'huérfana la vida del neumático en vez de impedirse.';

grant execute on function tc_eliminar_vehiculo(uuid) to authenticated;
