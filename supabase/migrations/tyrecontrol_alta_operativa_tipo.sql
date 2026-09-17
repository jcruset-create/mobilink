-- ============================================================
-- SEA TyreControl — Poner el tipo a un vehículo desde la tablet.
--
-- Es el paso que desbloquea todo lo demás: sin tipo no hay plano, sin plano no
-- hay posiciones y sin posiciones no hay dónde colgar una medición.
--
-- ── Por qué una función y no un UPDATE ──────────────────────────────────────
--
-- Porque `tc_vehiculos_write` (fase 3) es solo para administradores, y eso no
-- se toca: ampliar la escritura de la tabla de vehículos para que un técnico
-- pueda poner un tipo le daría de paso la matrícula, la empresa, los km y el
-- estado de baja. Esta función abre UNA puerta estrecha, igual que hacen
-- `tc_validar_vehiculo` y `tc_alta_vehiculo_desde_parte`.
--
-- ── La regla que evita el destrozo ──────────────────────────────────────────
--
-- Las posiciones cuelgan del TIPO. Si un vehículo ya tiene neumáticos montados
-- y se le cambia el tipo, sus montajes quedan apuntando a posiciones de un
-- plano que ya no es el suyo: el neumático sigue en la base, pero en una rueda
-- que ese camión no tiene. Por eso, con montajes vigentes, esto NO cambia el
-- tipo: falla y lo dice. Poner el tipo por primera vez —que es el caso del
-- alta— no toca nada de eso.
--
-- ── Lo que NO hace ──────────────────────────────────────────────────────────
--
-- No crea posiciones: ya existen, son del tipo y las comparten todos sus
-- vehículos. No toca marca, modelo, bastidor ni `pendiente_validar`: son datos
-- de oficina y no son cosa del técnico.
--
-- Reversible con `drop function`. No altera ninguna tabla.
-- ============================================================

create or replace function tc_alta_operativa_tipo(p_vehiculo uuid, p_tipo uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v           record;
  t           record;
  v_posiciones int;
  v_montajes   int;
  v_config     uuid;
begin
  select * into v from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;

  -- El mismo criterio de alcance que el resto de TyreControl: el técnico ve
  -- las flotas que tenga asignadas. No se inventa uno más estrecho aquí.
  if not (tc_is_superadmin()
          or (tc_is_admin() and v.empresa_id = tc_auth_empresa_id())
          or tc_operador_ve_empresa(v.empresa_id)) then
    raise exception 'Sin permiso sobre este vehículo';
  end if;
  if not v.activo then raise exception 'El vehículo está dado de baja'; end if;

  select * into t from tc_tipos_vehiculo where id = p_tipo and activo;
  if not found then raise exception 'Tipo de vehículo no encontrado'; end if;

  select count(*) into v_posiciones
    from tc_posiciones_vehiculo where tipo_vehiculo_id = p_tipo and activo;
  if v_posiciones = 0 then
    raise exception 'Ese tipo no tiene plano todavía: hay que generarle las posiciones antes de poder usarlo.';
  end if;

  -- Repetir la misma petición no es un error: la red mala y el doble toque
  -- existen. Se contesta lo mismo y no se escribe nada.
  if v.tipo_vehiculo_id = p_tipo then
    return jsonb_build_object('vehiculo_id', v.id, 'tipo_id', p_tipo, 'cambiado', false,
                              'posiciones', v_posiciones, 'configuracion_ejes', t.configuracion_ejes);
  end if;

  select count(*) into v_montajes from tc_montajes_actuales where vehiculo_id = p_vehiculo;
  if v_montajes > 0 then
    raise exception 'Este vehículo ya tiene % neumático(s) montado(s): cambiarle el tipo dejaría esos montajes en posiciones de otro plano. Hay que desmontarlos primero.', v_montajes;
  end if;

  -- La configuración del vehículo se enlaza con el catálogo por NOMBRE, que es
  -- único y usa el mismo texto que el tipo ("2x2x4"). Si no hubiera entrada en
  -- el catálogo se deja como estaba: es un dato informativo de la ficha y no
  -- puede tumbar el alta.
  select id into v_config from tc_config_ejes
   where nombre = t.configuracion_ejes and activo;

  update tc_vehiculos
     set tipo_vehiculo_id = p_tipo,
         config_ejes_id   = coalesce(v_config, config_ejes_id),
         updated_at       = now()
   where id = p_vehiculo;

  return jsonb_build_object('vehiculo_id', v.id, 'tipo_id', p_tipo, 'cambiado', true,
                            'posiciones', v_posiciones, 'configuracion_ejes', t.configuracion_ejes);
end $$;

comment on function tc_alta_operativa_tipo(uuid, uuid) is
  'Pone el tipo de vehículo desde la APK del técnico, que no puede escribir '
  'tc_vehiculos. Exige que el tipo tenga plano, enlaza la configuración de '
  'ejes por nombre y se niega a cambiar el tipo si el vehículo ya tiene '
  'neumáticos montados, porque sus montajes quedarían en posiciones de otro '
  'plano. Repetir la misma petición no escribe ni falla.';

grant execute on function tc_alta_operativa_tipo(uuid, uuid) to authenticated;
