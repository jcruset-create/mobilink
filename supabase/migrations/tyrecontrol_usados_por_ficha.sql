-- ============================================================
-- Mobilink TyreControl — DECISIÓN 1, opción A: el usado deja de contarse por
-- cantidades. La unidad es la ficha del neumático.
--
-- Cierra la Decisión 1 de docs/PROMPT_almacen_usados_individual.md
-- Requiere: tyrecontrol_almacen_usados.sql (fase 6)
--
-- EL PROBLEMA QUE SE CIERRA
--
-- Al desmontar a almacén pasaban DOS cosas: la ficha de tc_neumaticos quedaba
-- con estado='almacen' (con su identidad y sus milímetros) y, además,
-- tc_devolver_usado_a_stock sumaba +1 anónimo a movimientos_stock. La misma
-- goma contaba dos veces, y ocurría con identidad o sin ella.
--
-- LA REGLA A PARTIR DE AHORA
--
--   · NUEVO  → sigue en movimientos_stock, por cantidades. No cambia nada.
--   · USADO  → es la ficha de tc_neumaticos. Ni entra ni sale de
--              movimientos_stock.
--
-- Tiene sentido más allá de lo técnico: un neumático nuevo es intercambiable
-- con cualquier otro del mismo producto, y por eso se cuenta. Un usado NO: cada
-- uno tiene sus milímetros, su historia y sus kilómetros. Contarlos por
-- unidades era pedirle al almacén que tratara como iguales cosas que no lo son.
--
-- QUÉ CAMBIA EN LA PRÁCTICA
--
-- 1. tc_devolver_usado_a_stock deja de insertar. Se conserva como función
--    vacía para no romper a quien la llama: tc_desmontar_neumatico,
--    tc_sustituir_neumatico, tc_montar_desde_catalogo y la papelera de
--    reciclaje. Ninguno de esos ficheros hay que tocarlo.
--
-- 2. Montar un USADO desde almacén ya no descuenta stock: consume una ficha.
--    Si viene identidad, la que se haya leído (fase 1). Si no, la de más dibujo
--    que case con ese producto, y queda anotado que la eligió el sistema.
--    Y si no hay ninguna, el error lo dice claro en vez de dejar montar una
--    goma que no existe.
--
-- 3. tc_stock_almacen_empresa cuenta los usados desde tc_neumaticos. La APK y
--    el panel siguen llamándola igual; lo que cambia es de dónde sale el
--    número, que ahora es el de verdad.
--
-- LOS USADOS YA ACUMULADOS NO SE TOCAN AQUÍ
--
-- El saldo de 'usado' que haya hoy en movimientos_stock son apuntes históricos
-- de gomas que además tienen su ficha: es el doble conteo ya cometido. Ponerlo
-- a cero se hace con tc_migrar_usados_a_fichas(empresa), que se ejecuta A MANO
-- y por empresa, después de mirar el número en la pantalla de Almacén de
-- usados. No se hace solo: es un asiento en el libro de inventario del cliente
-- y tiene que decidirlo una persona.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- ── 1. Devolver a stock deja de sumar ───────────────────────────────────────
create or replace function tc_devolver_usado_a_stock(p_neumatico uuid, p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- DECISIÓN 1, OPCIÓN A: la goma desmontada YA está representada por su fila
  -- de tc_neumaticos, que queda con estado='almacen' conservando identidad,
  -- profundidad e historial. Sumar además un +1 anónimo en movimientos_stock
  -- la contaba dos veces.
  --
  -- La función se mantiene (vacía) a propósito: la llaman
  -- tc_desmontar_neumatico, tc_sustituir_neumatico, tc_montar_desde_catalogo y
  -- tyrecontrol_papelera_reciclaje. Dejándola aquí, ninguno de esos ficheros
  -- necesita cambiar, y el día que se quiera revertir se revierte en un sitio.
  return;
end $$;

comment on function tc_devolver_usado_a_stock(uuid, uuid) is
  'NO-OP desde la Decisión 1 (opción A): el usado se cuenta por fichas de '
  'tc_neumaticos, no por movimientos_stock. Se conserva por sus llamadores.';

-- ── 2. Elegir qué goma del almacén se monta ─────────────────────────────────
--
-- Cuando el técnico arrastra una tarjeta de "usado" sin identificar la rueda,
-- hay que decidir cuál de las que hay en el almacén es. Se coge la de MÁS
-- dibujo que case con el producto: es la que se elegiría a mano, porque es la
-- que más vida le queda para el eje.
--
-- Casa primero por producto de almacén y, si la ficha no lo tiene, por marca y
-- medida base — el mismo criterio que ya usaba tyrecontrol_devolver_usado_match.
create or replace function tc_elegir_usado_almacen(p_empresa uuid, p_producto uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_prod record; v_id uuid;
begin
  select * into v_prod from productos_neumaticos where id = p_producto;
  if not found then return null; end if;

  select n.id into v_id
    from tc_neumaticos n
   where n.empresa_id = p_empresa
     and n.activo = true
     and n.estado in ('almacen','reservado')
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
end $$;

comment on function tc_elegir_usado_almacen(uuid, uuid) is
  'Qué goma usada del almacén se monta cuando el técnico no identifica ninguna: '
  'la de más dibujo que case con el producto.';

-- ── 3. Montar desde almacén: el usado sale de la ficha, el nuevo del stock ──
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
  v_reutilizado boolean := false; v_marca_op text := ''; v_individual boolean;
  v_elegida boolean := false;
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

  v_individual := tc_identificacion_para_montaje(v_empresa, v_prod.medida, p_control_individual, p_datos);

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

  select cliente_almacen_id into v_cliente_almacen from tc_empresas where id = v_empresa;

  -- ── Stock: SOLO el nuevo se cuenta por cantidades (Decisión 1, opción A) ──
  if p_condicion = 'nuevo' then
    if v_cliente_almacen is null then
      raise exception 'Esta empresa no está enlazada con ningún cliente de almacén (ver TyreControl -> Enlace con almacén); no se puede descontar stock.';
    end if;

    select t.ubicacion, t.disponible into v_ubicacion, v_disponible
    from (
      select ubicacion, sum(case when tipo = 'SALIDA' then -cantidad else cantidad end) as disponible
      from movimientos_stock
      where producto_id = p_producto_almacen and cliente_id = v_cliente_almacen and condicion = 'nuevo'
      group by ubicacion
    ) t
    where t.disponible > 0
    order by t.disponible desc
    limit 1;

    if v_ubicacion is null then
      raise exception 'No hay stock nuevo disponible en almacén para % % % (cliente enlazado)',
        v_prod.marca, coalesce(v_prod.modelo,''), v_prod.medida;
    end if;
  end if;

  -- ── Qué ficha se monta ────────────────────────────────────────────────────
  if v_individual then
    v_neumatico := tc_buscar_neumatico_identificado(v_empresa, p_datos);
  end if;

  -- Usado sin identificar: se elige una de las que hay en el almacén. Antes se
  -- creaba una ficha nueva de la nada, que es de donde salía el neumático
  -- huérfano y la trazabilidad rota.
  if v_neumatico is null and p_condicion = 'usado' then
    v_neumatico := tc_elegir_usado_almacen(v_empresa, p_producto_almacen);
    if v_neumatico is null then
      raise exception 'SIN_USADOS_EN_ALMACEN: no hay ningún neumático usado de % % % en el almacén. Comprueba el Almacén de usados del cliente.',
        v_prod.marca, coalesce(v_prod.modelo,''), v_prod.medida;
    end if;
    v_elegida := true;
  end if;

  if v_neumatico is not null then
    perform tc_reenganchar_neumatico(v_neumatico, p_vehiculo, p_posicion, p_datos,
                                     p_condicion, v_prod.medida, p_producto_almacen);
    select numero_interno into v_numero from tc_neumaticos where id = v_neumatico;
    v_reutilizado := true;
    v_marca_op := case when v_elegida
                       then ' [DEL ALMACÉN ' || coalesce(v_numero, '?') || ']'
                       else ' [RECONOCIDO ' || coalesce(v_numero, '?') || ']' end;
  else
    v_numero := tc_generar_numero_interno();

    insert into tc_neumaticos (
      empresa_id, numero_interno, codigo_interno, almacen_producto_id,
      control_individual, creado_automaticamente, origen,
      marca, modelo, medida, indice_carga, indice_velocidad,
      dot, numero_serie, rfid_epc, proveedor, profundidad_actual_mm,
      estado, vehiculo_id, posicion_id, activo
    ) values (
      v_empresa, v_numero, v_numero, p_producto_almacen,
      v_individual, not v_individual, 'almacen_generico',
      v_prod.marca, v_prod.modelo, v_prod.medida,
      case when v_individual then p_datos->>'indice_carga' else null end,
      case when v_individual then p_datos->>'indice_velocidad' else null end,
      coalesce(case when v_individual then p_datos->>'dot' else null end, v_prod.dot),
      case when v_individual then p_datos->>'numero_serie' else null end,
      case when v_individual then p_datos->>'rfid_epc' else null end,
      case when v_individual then p_datos->>'proveedor' else null end,
      v_prof_dibujo,
      'montado', p_vehiculo, p_posicion, true
    ) returning id into v_neumatico;
  end if;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    'almacen', 'montado', 'vehiculo', auth.uid(),
    trim(both ' ' from coalesce(p_obs,'') || case when p_condicion='usado' then ' [USADO]' else '' end || v_marca_op))
  returning id into v_op_id;

  if not v_compatible then
    insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
    values (v_empresa, v_op_id, 'medida_incompatible', auth.uid(), auth.uid(),
      format('Medida %s forzada fuera de homologación para el tipo de vehículo', v_prod.medida), 'aprobada', now());
  end if;

  -- Solo el nuevo mueve el libro de inventario. El usado ya se ha "consumido"
  -- al pasar su ficha de 'almacen' a 'montado'.
  if p_condicion = 'nuevo' then
    insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion, condicion, origen_movimiento, observaciones)
    values (v_prod.empresa_id, v_cliente_almacen, p_producto_almacen, 'SALIDA', 1, v_ubicacion, 'nuevo', 'montaje_tyrecontrol',
      'Montaje TyreControl (nuevo) - neumático ' || v_numero
      || case when v_reutilizado then ' (reconocido)' else '' end);
  end if;

  return v_neumatico;
end $$;

-- ── 4. El stock que ve la APK: usados contados por ficha ────────────────────
create or replace function tc_stock_almacen_empresa(p_empresa uuid)
returns table(producto_id uuid, marca text, modelo text, medida text, nuevo numeric, usado numeric)
language plpgsql security definer set search_path = public as $$
declare v_cliente uuid;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;

  return query
  with nuevos as (
    -- El nuevo sigue siendo cantidad en el libro de inventario.
    select ms.producto_id as pid,
           sum(case when ms.tipo='SALIDA' then -ms.cantidad else ms.cantidad end)::numeric as n
      from movimientos_stock ms
     where ms.cliente_id = v_cliente and ms.condicion = 'nuevo'
     group by ms.producto_id
  ),
  usados as (
    -- El usado es una goma concreta: se cuentan fichas, no apuntes.
    select p.id as pid, count(*)::numeric as u
      from tc_neumaticos n
      join productos_neumaticos p
        on p.id = coalesce(
             n.almacen_producto_id,
             (select p2.id from productos_neumaticos p2
               where p2.activo
                 and upper(p2.marca) = upper(n.marca)
                 and tc_medida_base(p2.medida) = tc_medida_base(n.medida)
               order by p2.id limit 1))
     where n.empresa_id = p_empresa
       and n.activo = true
       and n.estado in ('almacen','reservado')
     group by p.id
  )
  select p.id, p.marca, p.modelo, p.medida,
         coalesce(nv.n, 0), coalesce(us.u, 0)
    from productos_neumaticos p
    left join nuevos nv on nv.pid = p.id
    left join usados us on us.pid = p.id
   where coalesce(nv.n,0) <> 0 or coalesce(us.u,0) <> 0
   order by p.medida, p.marca;
end $$;

comment on function tc_stock_almacen_empresa(uuid) is
  'Stock por producto: el NUEVO por cantidades (movimientos_stock) y el USADO '
  'contando fichas de tc_neumaticos que están en almacén (Decisión 1, opción A).';

-- ── 5. Poner a cero los usados ya acumulados (A MANO, por empresa) ──────────
--
-- No se ejecuta sola. Antes conviene mirar el desfase en la pantalla de
-- Almacén de usados: ese número son gomas contadas dos veces, y este asiento
-- lo corrige dejando rastro de por qué.
create or replace function tc_migrar_usados_a_fichas(p_empresa uuid, p_simular boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_cliente uuid; v_saldo numeric; v_fichas bigint; r record; v_n int := 0;
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id())) then
    raise exception 'Solo un administrador puede regularizar el inventario';
  end if;
  select cliente_almacen_id into v_cliente from tc_empresas where id = p_empresa;
  if v_cliente is null then
    return jsonb_build_object('error', 'La empresa no está enlazada con ningún cliente de almacén');
  end if;

  select count(*) into v_fichas from tc_neumaticos
   where empresa_id = p_empresa and activo and estado in ('almacen','reservado');
  select coalesce(sum(case when tipo='SALIDA' then -cantidad else cantidad end), 0) into v_saldo
    from movimientos_stock where cliente_id = v_cliente and condicion = 'usado';

  if p_simular then
    return jsonb_build_object('simulacion', true, 'fichas_en_almacen', v_fichas,
                              'saldo_usado_stock', v_saldo,
                              'se_regularizarian', greatest(v_saldo, 0));
  end if;

  -- Un asiento de SALIDA por producto, del importe que tenga cada uno, para
  -- dejar el saldo de 'usado' a cero sin borrar ni un apunte histórico.
  for r in
    select producto_id, ubicacion,
           sum(case when tipo='SALIDA' then -cantidad else cantidad end) as saldo
      from movimientos_stock
     where cliente_id = v_cliente and condicion = 'usado'
     group by producto_id, ubicacion
    having sum(case when tipo='SALIDA' then -cantidad else cantidad end) > 0
  loop
    insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion,
                                   condicion, origen_movimiento, observaciones)
    select p.empresa_id, v_cliente, r.producto_id, 'SALIDA', r.saldo, r.ubicacion,
           'usado', 'regularizacion_decision1',
           'Regularización: el usado pasa a contarse por fichas de neumático (Decisión 1, opción A). '
           || 'Estas ' || r.saldo || ' unidades ya estaban representadas por su ficha.'
      from productos_neumaticos p where p.id = r.producto_id;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('simulacion', false, 'fichas_en_almacen', v_fichas,
                            'saldo_anterior', v_saldo, 'asientos', v_n);
end $$;

comment on function tc_migrar_usados_a_fichas(uuid, boolean) is
  'Deja a cero el saldo de usado en movimientos_stock, que era el doble conteo. '
  'Por defecto SIMULA: hay que llamarla con p_simular=false para que escriba.';

-- ── 6. Comprobaciones ───────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'tc_montar_desde_almacen';
  if n <> 1 then raise warning 'Quedan % versiones de tc_montar_desde_almacen (se esperaba 1)', n; end if;

  -- Devolver a stock tiene que estar vacía: si vuelve a insertar, vuelve el
  -- doble conteo y no se notaría hasta cuadrar un inventario.
  select count(*) into n from pg_proc
   where proname = 'tc_devolver_usado_a_stock' and prosrc like '%insert into movimientos_stock%';
  if n <> 0 then raise exception 'tc_devolver_usado_a_stock sigue sumando al stock: vuelve el doble conteo'; end if;

  -- Y montar un usado no debe descontar: el usado ya no vive en el libro.
  select count(*) into n from pg_proc
   where proname = 'tc_montar_desde_almacen' and prosrc like '%tc_elegir_usado_almacen%';
  if n <> 1 then raise exception 'tc_montar_desde_almacen no está eligiendo la ficha del almacén'; end if;

  raise notice 'OK: el usado se cuenta por fichas; el nuevo sigue en movimientos_stock';
end $$;
