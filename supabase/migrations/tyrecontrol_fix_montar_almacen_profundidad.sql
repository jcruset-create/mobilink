-- ============================================================
-- Mobilink TyreControl — Montar un USADO desde el stock vuelve a guardar
-- la profundidad que teclea el técnico
--
-- SÍNTOMA (R1234ABC): se monta un usado desde el stock del cliente con 9 mm
-- y la tarjeta enseña 16 mm, la profundidad de dibujo del catálogo.
--
-- CAUSA, confirmada mirando la base de datos de producción:
--
--   RUEDA  E1_DER · almacen_usado      NULL mm   ← desde el STOCK
--   RUEDA  E2_DER · almacen_usado      NULL mm   ← desde el STOCK
--   RUEDA  E1_IZQ · almacen_generico   NULL mm   ← desde el STOCK
--   RUEDA  E3_DER · catalogo_usado     8.0 mm    ← "sin control de stock"
--   RUEDA  E3_IZQ · catalogo_usado     8.0 mm    ← "sin control de stock"
--
-- Los montajes SIN CONTROL DE STOCK guardan bien (tc_montar_desde_catalogo);
-- los que salen del stock del cliente guardan NULL. La función viva en
-- producción, tc_montar_desde_almacen, no escribe profundidad_actual_mm: ni
-- la del usado que informa el técnico ni la de dibujo del nuevo. Quedó una
-- versión antigua del cuerpo con la firma nueva, así que la app la llamaba sin
-- error y el dato se perdía en silencio.
--
-- La app SÍ manda el valor: se comprobó ejecutando esta misma función contra
-- un PostgreSQL 16 con `{"profundidad_actual_mm": "12.5"}` y guarda 12.5.
--
-- Esta migración reinstala el cuerpo correcto (el de
-- tyrecontrol_stock_usado.sql) y comprueba al final que ha quedado bien.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

create or replace function tc_montar_desde_almacen(
  p_vehiculo uuid, p_posicion uuid, p_producto_almacen uuid, p_control_individual boolean,
  p_datos jsonb default '{}'::jsonb, p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false, p_condicion text default 'nuevo'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_prod record; v_empresa uuid; v_neumatico uuid; v_montaje uuid; v_numero text;
  v_compatible boolean; v_op_id uuid;
  v_cliente_almacen uuid; v_ubicacion text; v_disponible numeric; v_prof_dibujo numeric;
begin
  if p_condicion not in ('nuevo','usado') then raise exception 'Condición de stock no válida'; end if;

  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;

  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;

  select * into v_prod from productos_neumaticos where id = p_producto_almacen and activo = true;
  if not found then raise exception 'Producto de almacén no encontrado'; end if;

  -- Profundidad de dibujo (neumático nuevo) desde la ficha del catálogo.
  select profundidad_dibujo_mm into v_prof_dibujo
    from tc_referencias_neumatico where id = v_prod.referencia_neumatico_id;

  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and posicion_id = p_posicion) then
    raise exception 'La posición ya tiene un neumático montado';
  end if;

  v_compatible := tc_medida_compatible(v_veh.tipo_vehiculo_id, v_prod.medida);
  if not v_compatible then
    if not p_forzar_medida then
      raise exception 'MEDIDA_INCOMPATIBLE: % no está homologada para este tipo de vehículo', v_prod.medida;
    end if;
    if not (tc_is_superadmin() or tc_is_admin()) then
      raise exception 'Solo un administrador puede forzar el montaje de una medida no homologada';
    end if;
  end if;

  -- Stock real del cliente de almacén enlazado, SOLO de la condición pedida.
  select cliente_almacen_id into v_cliente_almacen from tc_empresas where id = v_empresa;
  if v_cliente_almacen is null then
    raise exception 'Esta empresa no está enlazada con ningún cliente de almacén (ver TyreControl -> Enlace con almacén); no se puede descontar stock.';
  end if;

  select t.ubicacion, t.disponible into v_ubicacion, v_disponible
  from (
    select ubicacion, sum(case when tipo = 'SALIDA' then -cantidad else cantidad end) as disponible
    from movimientos_stock
    where producto_id = p_producto_almacen and cliente_id = v_cliente_almacen and condicion = p_condicion
    group by ubicacion
  ) t
  where t.disponible > 0
  order by t.disponible desc
  limit 1;

  if v_ubicacion is null then
    raise exception 'No hay stock % disponible en almacén para % % % (cliente enlazado)',
      p_condicion, v_prod.marca, coalesce(v_prod.modelo,''), v_prod.medida;
  end if;

  v_numero := tc_generar_numero_interno();

  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno, almacen_producto_id,
    control_individual, creado_automaticamente, origen,
    marca, modelo, medida, indice_carga, indice_velocidad,
    dot, numero_serie, rfid_epc, proveedor, profundidad_actual_mm,
    estado, vehiculo_id, posicion_id, activo
  ) values (
    v_empresa, v_numero, v_numero, p_producto_almacen,
    p_control_individual, not p_control_individual,
    case when p_condicion = 'usado' then 'almacen_usado' else 'almacen_generico' end,
    v_prod.marca, v_prod.modelo, v_prod.medida,
    case when p_control_individual then p_datos->>'indice_carga' else null end,
    case when p_control_individual then p_datos->>'indice_velocidad' else null end,
    coalesce(case when p_control_individual then p_datos->>'dot' else null end, v_prod.dot),
    case when p_control_individual then p_datos->>'numero_serie' else null end,
    case when p_control_individual then p_datos->>'rfid_epc' else null end,
    case when p_control_individual then p_datos->>'proveedor' else null end,
    -- nuevo: profundidad de dibujo de la ficha; usado: la restante indicada (o null → se mide)
    case when p_condicion = 'nuevo' then v_prof_dibujo
         else nullif(p_datos->>'profundidad_actual_mm', '')::numeric end,
    'montado', p_vehiculo, p_posicion, true
  ) returning id into v_neumatico;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    'almacen', 'montado', 'vehiculo', auth.uid(),
    trim(both ' ' from coalesce(p_obs,'') || case when p_condicion='usado' then ' [USADO]' else '' end))
  returning id into v_op_id;

  if not v_compatible then
    insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
    values (v_empresa, v_op_id, 'medida_incompatible', auth.uid(), auth.uid(),
      format('Medida %s forzada fuera de homologación para el tipo de vehículo', v_prod.medida), 'aprobada', now());
  end if;

  insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion, condicion, origen_movimiento, observaciones)
  values (v_prod.empresa_id, v_cliente_almacen, p_producto_almacen, 'SALIDA', 1, v_ubicacion, p_condicion, 'montaje_tyrecontrol',
    'Montaje TyreControl (' || p_condicion || ') - neumático ' || v_numero);

  return v_neumatico;
end $$;

-- ── Comprobación: que el cuerpo instalado es el bueno ───────────────────────
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc
   where proname = 'tc_montar_desde_almacen'
     and prosrc like '%p_datos->>''profundidad_actual_mm''%';
  if n = 0 then
    raise exception 'La función sigue SIN guardar la profundidad del usado';
  end if;
  raise notice 'OK: tc_montar_desde_almacen guarda la profundidad del usado';
end $$;

-- ── Reparación de lo ya montado ─────────────────────────────────────────────
--
-- Los NUEVOS que entraron por el fallo se quedaron sin profundidad; la suya es
-- la de dibujo del catálogo, así que se puede reponer sin inventar nada.
--
-- La fecha se deja en la de creación del neumático y NO en now(): si alguien
-- ya midió esa rueda después de montarla, su medición tiene que seguir
-- mandando (ver profundidad_actualizada_en y profundidadVigente en la app).
-- El trigger sella now() en cada cambio, así que hay que corregirla después,
-- rueda por rueda y solo en las reparadas.
--
-- Los USADOS con NULL no se tocan: solo el técnico sabe los milímetros que
-- midió, y ponerles el dibujo del catálogo sería inventarse un dato. Hay que
-- volver a medirlos.
do $$
declare r record; n int := 0;
begin
  for r in
    select neu.id, neu.created_at, ref.profundidad_dibujo_mm as mm
      from tc_neumaticos neu
      join productos_neumaticos prod on prod.id = neu.almacen_producto_id
      join tc_referencias_neumatico ref on ref.id = prod.referencia_neumatico_id
     where neu.origen = 'almacen_generico'
       and neu.profundidad_actual_mm is null
       and ref.profundidad_dibujo_mm is not null
  loop
    update tc_neumaticos set profundidad_actual_mm = r.mm where id = r.id;
    update tc_neumaticos set profundidad_actualizada_en = r.created_at where id = r.id;
    n := n + 1;
  end loop;
  raise notice 'Nuevos reparados con la profundidad de catálogo: %', n;
end $$;

-- Cuántos usados se quedaron sin dato y hay que volver a medir.
do $$
declare n int;
begin
  select count(*) into n from tc_neumaticos
   where origen in ('almacen_usado','catalogo_usado')
     and estado = 'montado' and activo
     and profundidad_actual_mm is null;
  if n > 0 then
    raise notice 'Hay % neumático(s) usados montados sin profundidad: hay que medirlos', n;
  end if;
end $$;
