-- ============================================================
-- SEA TyreControl - Permutacion MULTIPLE en un mismo vehiculo
--
-- Aplica un plan completo (varias ruedas a la vez) en UNA sola
-- transaccion: o entra entero o no entra nada. Asi no se queda el
-- vehiculo a medias si falla un movimiento intermedio.
--
-- Queda como UNA operacion 'permutacion' con N movimientos en
-- tc_operacion_movimientos (orden 1..N), de modo que deshacer
-- revierte el plan entero de golpe.
--
-- p_destinos: [{"montaje": uuid, "posicion": uuid}, ...]
--             donde debe ACABAR cada rueda.
-- ============================================================

create or replace function tc_permutar_plan(
  p_vehiculo uuid, p_destinos jsonb, p_km numeric default null, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $func$
declare v_emp uuid; v_tipo uuid; v_op uuid; v_neu uuid; v_n int;
begin
  select empresa_id, tipo_vehiculo_id into v_emp, v_tipo from tc_vehiculos where id = p_vehiculo;
  if v_emp is null then raise exception 'Vehiculo no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_emp = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_emp)) then
    raise exception 'Sin permiso para permutar en esta empresa';
  end if;

  select count(*) into v_n from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid);
  if coalesce(v_n, 0) = 0 then raise exception 'El plan esta vacio'; end if;

  -- Dos ruedas no pueden acabar en la misma posicion.
  if exists (select 1 from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid)
               group by x.posicion having count(*) > 1) then
    raise exception 'Hay dos ruedas asignadas a la misma posicion';
  end if;

  -- Ni una rueda en dos posiciones.
  if exists (select 1 from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid)
               group by x.montaje having count(*) > 1) then
    raise exception 'Hay una rueda asignada a dos posiciones';
  end if;

  -- Todas las ruedas deben estar montadas en ESTE vehiculo.
  if exists (select 1 from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid)
               left join tc_montajes_actuales m on m.id = x.montaje
              where m.id is null or m.vehiculo_id <> p_vehiculo) then
    raise exception 'Alguna rueda del plan no esta montada en este vehiculo';
  end if;

  -- Y todas las posiciones deben ser de su tipo de vehiculo.
  if exists (select 1 from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid)
               left join tc_posiciones_vehiculo p on p.id = x.posicion and p.tipo_vehiculo_id = v_tipo
              where p.id is null) then
    raise exception 'Alguna posicion del plan no es de este tipo de vehiculo';
  end if;

  -- Si una posicion destino la ocupa una rueda que NO se mueve, el plan
  -- chocaria: hay que incluir tambien esa rueda.
  if exists (
    select 1 from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid)
      join tc_montajes_actuales oc on oc.vehiculo_id = p_vehiculo and oc.posicion_id = x.posicion
     where oc.id <> x.montaje
       and oc.id not in (select y.montaje from jsonb_to_recordset(p_destinos) as y(montaje uuid, posicion uuid))
  ) then
    raise exception 'Una posicion del plan la ocupa una rueda que no se mueve: incluyela en el plan';
  end if;

  -- Cabecera de la operacion (una sola para todo el plan).
  select m.neumatico_id into v_neu
    from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid)
    join tc_montajes_actuales m on m.id = x.montaje
   limit 1;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion,
    km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_emp, p_vehiculo, v_neu, 'permutacion', p_km, current_date,
    'montado', 'montado', 'vehiculo', auth.uid(),
    coalesce(p_obs, 'Permutacion multiple en el mismo vehiculo (APK)'))
  returning id into v_op;

  -- Movimientos: se leen los origenes ANTES de mover nada.
  insert into tc_operacion_movimientos (operacion_id, neumatico_id, movimiento_tipo,
    origen_vehiculo_id, origen_posicion_id, destino_vehiculo_id, destino_posicion_id,
    estado_anterior, estado_nuevo, orden)
  select v_op, m.neumatico_id, 'cambio_posicion', p_vehiculo, m.posicion_id, p_vehiculo, x.posicion,
         'montado', 'montado', row_number() over (order by x.posicion)
    from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid)
    join tc_montajes_actuales m on m.id = x.montaje;

  -- Aplicar: primero se sueltan TODAS (posicion null) para no chocar con
  -- unique(vehiculo_id, posicion_id), y despues se asignan los destinos.
  update tc_montajes_actuales set posicion_id = null
   where id in (select x.montaje from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid));

  update tc_montajes_actuales m set posicion_id = x.posicion
    from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid)
   where m.id = x.montaje;

  update tc_neumaticos n set posicion_id = m.posicion_id, updated_at = now()
    from tc_montajes_actuales m
   where m.id in (select x.montaje from jsonb_to_recordset(p_destinos) as x(montaje uuid, posicion uuid))
     and n.id = m.neumatico_id;

  return v_op;
end $func$;
