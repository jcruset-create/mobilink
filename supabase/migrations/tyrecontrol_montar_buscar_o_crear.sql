-- ============================================================
-- Mobilink TyreControl — Montar un neumático IDENTIFICADO deja de crear
-- una ficha nueva: se reconoce la que ya existe.
--
-- FASE 1 de docs/PROMPT_identificacion_neumaticos.md
--
-- EL FALLO (ya está en producción, no es funcionalidad nueva)
--
-- `control_individual` es una columna de CADA neumático, así que el modelo
-- mixto lleva tiempo funcionando: desde el panel ya se montan gomas con DOT,
-- número de serie y RFID (`ModalMontarFueraAlmacen` sale marcado como
-- individual POR DEFECTO). Pero los dos RPC de montaje siempre hacen
-- `insert into tc_neumaticos`. Con una goma identificada que vuelve:
--
--   1. Se monta la goma RFID E280…A1 en el 1234ABC  → se crea su ficha.
--   2. Se desmonta a almacén                        → ficha en estado 'almacen'.
--   3. Se vuelve a montar en el 5678BCD             → insert con el MISMO rfid:
--
--        ERROR: duplicate key value violates unique constraint "uq_tc_neu_rfid"
--
-- El índice único (fase4) hace de red de seguridad e impide duplicar la
-- identidad, pero a costa de reventar el montaje con un error crudo de
-- Postgres. No ha saltado todavía porque casi nadie usa la identidad y quien
-- la usa monta gomas nuevas.
--
-- LA CORRECCIÓN
--
-- Montar pasa a ser «buscar o crear»: si viene identidad (RFID o nº de serie)
-- y el montaje es individual, primero se busca la ficha. Si aparece, se
-- REUTILIZA — conserva su historial, su coste, sus km y su profundidad — y si
-- no, se crea como hasta ahora.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA, A PROPÓSITO
--
-- * El stock. Hoy el libro está cuadrado: montar hace SALIDA -1, desmontar a
--   almacén hace ENTRADA +1 (tc_devolver_usado_a_stock), y volver a montar
--   descuenta ese +1. Dejar de descontar al reutilizar dejaría el stock
--   inflado para siempre. El doble conteo entre `tc_neumaticos` y
--   `movimientos_stock` es un problema real, pero se arregla en la Decisión 1
--   de docs/PROMPT_almacen_usados_individual.md, no aquí.
--
-- * La firma de las funciones. La identidad ya viaja en `p_datos`, así que no
--   hace falta ningún parámetro nuevo: se evita crear una cuarta sobrecarga
--   de tc_montar_desde_almacen (ver tyrecontrol_profundidad_manual.sql:62).
--
-- * `chk_tc_neu_origen`. Al reutilizar se respeta el `origen` original de la
--   ficha (dice de dónde salió la goma la primera vez). La reutilización queda
--   registrada en `operaciones_neumaticos.observaciones`.
--
-- * La APK. Sigue mandando p_control_individual = false, así que su
--   comportamiento no cambia en absoluto. Es la fase 3.
--
-- Los casos conflictivos C1 (montado en otro vehículo), C2 (ficha de otra
-- empresa) y C5 (RFID y serie que discrepan) se resuelven aquí de la forma
-- conservadora: **error claro y explicado**, en vez del error crudo de
-- Postgres de hoy. Las resoluciones asistidas son la fase 4.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- ── 1. Buscar la ficha de un neumático identificado ─────────────────────────
--
-- Devuelve el id de la ficha existente, o NULL si es la primera vez que se ve
-- esta goma. Lanza excepción explicada cuando la reutilización no es segura.
create or replace function tc_buscar_neumatico_identificado(p_empresa uuid, p_datos jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rfid text; v_serie text; v_id uuid; v_neu record; v_otro record; v_veh text; v_pos text;
begin
  -- '' no es identidad: el panel manda cadena vacía cuando no se rellena
  -- (ver tyrecontrol_fix_rfid_serie_vacios.sql).
  v_rfid  := nullif(btrim(coalesce(p_datos->>'rfid_epc', '')), '');
  v_serie := nullif(btrim(coalesce(p_datos->>'numero_serie', '')), '');
  if v_rfid is null and v_serie is null then return null; end if;

  -- 1) Por RFID. El índice uq_tc_neu_rfid es GLOBAL (un RFID es único en el
  --    mundo), así que la búsqueda tiene que serlo también: si no, se
  --    encontraría "nada" y el insert chocaría igual contra el índice.
  -- Se busca sobre un uuid y no sobre un record: leer un record al que no se
  -- le ha asignado nada lanza «record is not assigned yet» cuando solo viene
  -- número de serie.
  if v_rfid is not null then
    select id into v_id from tc_neumaticos where rfid_epc = v_rfid;
  end if;

  -- 2) Por número de serie, que sí es único POR EMPRESA.
  if v_id is null and v_serie is not null then
    select id into v_id from tc_neumaticos
     where empresa_id = p_empresa and numero_serie = v_serie;
  end if;

  if v_id is null then return null; end if;   -- goma nueva para el sistema
  select * into v_neu from tc_neumaticos where id = v_id;

  -- C2 — la ficha es de otra empresa. Traspasarla le enseñaría al cliente
  -- nuevo dónde estuvo montada antes, así que no se hace sin decidirlo.
  if v_neu.empresa_id is distinct from p_empresa then
    raise exception 'IDENTIDAD_OTRA_EMPRESA: el neumático % (%) está dado de alta en otra empresa. Un administrador tiene que traspasarlo antes de montarlo aquí.',
      coalesce(v_neu.numero_interno, '?'), coalesce(v_rfid, v_serie);
  end if;

  -- Ficha dada de baja: descartada o borrada. No se resucita en un montaje.
  if v_neu.activo is not true then
    raise exception 'IDENTIDAD_DE_BAJA: el neumático % está dado de baja (estado %). Hay que reactivarlo desde el panel antes de montarlo.',
      coalesce(v_neu.numero_interno, '?'), coalesce(v_neu.estado, '?');
  end if;

  -- C1 — consta montado en otro sitio. Casi siempre significa que el
  -- desmontaje de aquel vehículo no se registró.
  if v_neu.estado = 'montado' then
    select v.matricula, po.codigo_posicion into v_veh, v_pos
      from tc_montajes_actuales m
      join tc_vehiculos v on v.id = m.vehiculo_id
      left join tc_posiciones_vehiculo po on po.id = m.posicion_id
     where m.neumatico_id = v_neu.id
     limit 1;
    if v_veh is not null then
      raise exception 'IDENTIDAD_YA_MONTADA: el neumático % consta montado en % (posición %). Desmóntalo de ahí primero, o corrígelo desde el panel.',
        coalesce(v_neu.numero_interno, '?'), v_veh, coalesce(v_pos, '?');
    end if;
    -- Estado 'montado' sin montaje vivo: la ficha quedó descuadrada. Se puede
    -- reutilizar sin riesgo, la posición nueva la deja en su sitio.
  end if;

  -- C5 — el RFID leído y el nº de serie tecleado apuntan a fichas distintas.
  -- No se resuelve en silencio: son dos gomas reclamando ser la misma.
  if v_rfid is not null and v_serie is not null then
    select * into v_otro from tc_neumaticos
     where empresa_id = p_empresa and numero_serie = v_serie and id <> v_neu.id;
    if found then
      raise exception 'IDENTIDAD_DISCREPANTE: el RFID % es del neumático % y el nº de serie % es del neumático %. Comprueba cuál de los dos datos corresponde a la rueda que tienes delante.',
        v_rfid, coalesce(v_neu.numero_interno, '?'), v_serie, coalesce(v_otro.numero_interno, '?');
    end if;
  end if;

  return v_neu.id;
end $$;

comment on function tc_buscar_neumatico_identificado(uuid, jsonb) is
  'Busca la ficha de un neumático identificado por RFID (global) o nº de serie '
  '(por empresa). Devuelve NULL si es la primera vez que se ve. Lanza '
  'IDENTIDAD_OTRA_EMPRESA / IDENTIDAD_DE_BAJA / IDENTIDAD_YA_MONTADA / '
  'IDENTIDAD_DISCREPANTE cuando reutilizarla no es seguro.';

-- ── 2. Reenganchar una ficha existente a una posición ───────────────────────
--
-- Deja la goma montada conservando TODO lo suyo (historial, coste, km) y
-- completando solo los huecos: un identificador que antes no tenía, la medida
-- si le faltaba, la profundidad que informe el técnico.
create or replace function tc_reenganchar_neumatico(
  p_neumatico uuid, p_vehiculo uuid, p_posicion uuid, p_datos jsonb,
  p_condicion text, p_medida_esperada text, p_producto_almacen uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_neu record; v_rfid text; v_serie text; v_prof numeric;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;

  -- La medida manda: montar una 315/70R22.5 donde se pidió una 385/65R22.5 no
  -- es un detalle administrativo. Se compara la medida BASE (sin índices).
  if p_medida_esperada is not null and v_neu.medida is not null
     and tc_medida_base(v_neu.medida) is distinct from tc_medida_base(p_medida_esperada) then
    raise exception 'IDENTIDAD_OTRA_MEDIDA: el neumático % es % y se está montando como %. Comprueba que la rueda leída es la que tienes delante.',
      coalesce(v_neu.numero_interno, '?'), v_neu.medida, p_medida_esperada;
  end if;

  v_rfid  := nullif(btrim(coalesce(p_datos->>'rfid_epc', '')), '');
  v_serie := nullif(btrim(coalesce(p_datos->>'numero_serie', '')), '');
  -- La profundidad del usado la informa el técnico; la del nuevo no se toca
  -- (una goma que vuelve del almacén no recupera su dibujo de fábrica).
  v_prof  := nullif(btrim(coalesce(p_datos->>'profundidad_actual_mm', '')), '')::numeric;

  update tc_neumaticos set
    estado             = 'montado',
    vehiculo_id        = p_vehiculo,
    posicion_id        = p_posicion,
    control_individual = true,
    -- Solo se rellenan huecos: lo que la ficha ya sabe de sí misma manda.
    rfid_epc           = coalesce(rfid_epc, v_rfid),
    numero_serie       = coalesce(numero_serie, v_serie),
    dot                = coalesce(dot, nullif(btrim(coalesce(p_datos->>'dot','')), '')),
    medida             = coalesce(medida, p_medida_esperada),
    almacen_producto_id = coalesce(almacen_producto_id, p_producto_almacen),
    -- El trigger de tyrecontrol_profundidad_manual.sql sella la fecha solo si
    -- el valor cambia, así que la medición vieja deja de tapar a esta.
    profundidad_actual_mm = coalesce(v_prof, profundidad_actual_mm),
    updated_at         = now()
  where id = p_neumatico;
end $$;

-- ── 3. Montar desde almacén: buscar o crear ─────────────────────────────────
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
  v_reutilizado boolean := false; v_marca_op text := '';
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

  -- ── BUSCAR O CREAR ────────────────────────────────────────────────────────
  if p_control_individual then
    v_neumatico := tc_buscar_neumatico_identificado(v_empresa, p_datos);
  end if;

  if v_neumatico is not null then
    -- La goma ya existe: se reengancha, no se duplica.
    perform tc_reenganchar_neumatico(v_neumatico, p_vehiculo, p_posicion, p_datos,
                                     p_condicion, v_prod.medida, p_producto_almacen);
    select numero_interno into v_numero from tc_neumaticos where id = v_neumatico;
    v_reutilizado := true;
    v_marca_op := ' [RECONOCIDO ' || coalesce(v_numero, '?') || ']';
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

  -- El stock se descuenta IGUAL se reutilice o no la ficha: la unidad que
  -- sale del almacén es la misma en los dos casos y el libro tiene que cuadrar
  -- con el ENTRADA que hizo tc_devolver_usado_a_stock al desmontarla.
  insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion, condicion, origen_movimiento, observaciones)
  values (v_prod.empresa_id, v_cliente_almacen, p_producto_almacen, 'SALIDA', 1, v_ubicacion, p_condicion, 'montaje_tyrecontrol',
    'Montaje TyreControl (' || p_condicion || ') - neumático ' || v_numero
    || case when v_reutilizado then ' (reconocido)' else '' end);

  return v_neumatico;
end $$;

-- ── 4. Montar desde catálogo (sin stock): buscar o crear ────────────────────
create or replace function tc_montar_desde_catalogo(
  p_vehiculo uuid, p_posicion uuid, p_referencia uuid, p_control_individual boolean,
  p_datos jsonb default '{}'::jsonb, p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false, p_condicion text default 'nuevo',
  p_montaje_actual uuid default null, p_motivo_desmontaje text default 'desgaste', p_destino_retirado text default 'almacen'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_ref record; v_empresa uuid; v_neumatico uuid; v_montaje uuid; v_numero text;
  v_compatible boolean; v_op_id uuid; m record; v_ic text; v_es_sust boolean;
  v_marca_op text := '';
begin
  if p_condicion not in ('nuevo','usado') then raise exception 'Condición no válida'; end if;

  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;
  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;

  -- Datos de la referencia del catálogo (marca, modelo, medida, índices, dibujo).
  select r.profundidad_dibujo_mm, ts.medida as medida, ts.indice_carga_simple, ts.indice_carga_doble,
         ts.codigo_velocidad, mo.nombre as modelo_nombre, mar.nombre as marca_nombre
    into v_ref
  from tc_referencias_neumatico r
  join tyre_sizes ts on ts.id = r.tyre_size_id
  join tc_cat_modelos_neumatico mo on mo.id = r.modelo_id
  join tc_cat_marcas_neumatico mar on mar.id = mo.marca_id
  where r.id = p_referencia;
  if not found then raise exception 'Referencia de catálogo no encontrada'; end if;

  v_compatible := tc_medida_compatible(v_veh.tipo_vehiculo_id, v_ref.medida);
  if not v_compatible then
    if not p_forzar_medida then
      raise exception 'MEDIDA_INCOMPATIBLE: % no está homologada para este tipo de vehículo', v_ref.medida;
    end if;
    if not (tc_is_superadmin() or tc_is_admin()) then
      raise exception 'Solo un administrador puede forzar el montaje de una medida no homologada';
    end if;
  end if;

  -- ── Sustitución: desmontar primero el actual ──
  v_es_sust := p_montaje_actual is not null;
  if v_es_sust then
    select * into m from tc_montajes_actuales where id = p_montaje_actual;
    if not found then raise exception 'Montaje actual no encontrado'; end if;

    insert into tc_historial_montajes (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje,
      fecha_desmontaje, km_desmontaje, motivo_desmontaje, tecnico_montaje_id, tecnico_desmontaje_id, observaciones)
    values (m.empresa_id, m.vehiculo_id, m.neumatico_id, m.posicion_id, m.fecha_montaje, m.km_montaje,
      coalesce(p_fecha, current_date), p_km, p_motivo_desmontaje, m.tecnico_id, auth.uid(), coalesce(p_obs, m.observaciones));
    update tc_neumaticos set estado = p_destino_retirado, vehiculo_id = null, posicion_id = null, updated_at = now() where id = m.neumatico_id;
    insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
      montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
    values (m.empresa_id, m.vehiculo_id, m.neumatico_id, 'sustitucion', m.posicion_id, m.id, p_km, coalesce(p_fecha, current_date),
      p_motivo_desmontaje, 'montado', p_destino_retirado, p_destino_retirado, auth.uid(), p_obs);
    delete from tc_montajes_actuales where id = p_montaje_actual;
    if p_destino_retirado = 'almacen' then perform tc_devolver_usado_a_stock(m.neumatico_id, m.empresa_id); end if;
  end if;

  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and posicion_id = p_posicion) then
    raise exception 'La posición ya tiene un neumático montado';
  end if;

  v_ic := v_ref.indice_carga_simple || case when v_ref.indice_carga_doble is not null and v_ref.indice_carga_doble <> ''
            then '/' || v_ref.indice_carga_doble else '' end;

  -- ── BUSCAR O CREAR ────────────────────────────────────────────────────────
  if p_control_individual then
    v_neumatico := tc_buscar_neumatico_identificado(v_empresa, p_datos);
  end if;

  if v_neumatico is not null then
    perform tc_reenganchar_neumatico(v_neumatico, p_vehiculo, p_posicion, p_datos,
                                     p_condicion, v_ref.medida, null);
    select numero_interno into v_numero from tc_neumaticos where id = v_neumatico;
    v_marca_op := ' [RECONOCIDO ' || coalesce(v_numero, '?') || ']';
  else
    v_numero := tc_generar_numero_interno();

    insert into tc_neumaticos (
      empresa_id, numero_interno, codigo_interno, almacen_producto_id,
      control_individual, creado_automaticamente, origen,
      marca, modelo, medida, indice_carga, indice_velocidad,
      dot, numero_serie, rfid_epc, proveedor, profundidad_actual_mm,
      estado, vehiculo_id, posicion_id, activo
    ) values (
      v_empresa, v_numero, v_numero, null,
      p_control_individual, not p_control_individual,
      case when p_condicion = 'usado' then 'catalogo_usado' else 'catalogo_sin_stock' end,
      v_ref.marca_nombre, v_ref.modelo_nombre, v_ref.medida, v_ic, v_ref.codigo_velocidad,
      case when p_control_individual then p_datos->>'dot' else null end,
      case when p_control_individual then p_datos->>'numero_serie' else null end,
      case when p_control_individual then p_datos->>'rfid_epc' else null end,
      case when p_control_individual then p_datos->>'proveedor' else null end,
      case when p_condicion = 'nuevo' then v_ref.profundidad_dibujo_mm
           else nullif(p_datos->>'profundidad_actual_mm', '')::numeric end,
      'montado', p_vehiculo, p_posicion, true
    ) returning id into v_neumatico;
  end if;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, case when v_es_sust then 'sustitucion' else 'montaje' end, p_posicion, v_montaje,
    p_km, coalesce(p_fecha, current_date), 'catalogo', 'montado', 'vehiculo', auth.uid(),
    trim(both ' ' from coalesce(p_obs,'') || ' [CATÁLOGO' || case when p_condicion='usado' then ' · USADO' else '' end || ' · sin descuento de stock]' || v_marca_op))
  returning id into v_op_id;

  if not v_compatible then
    insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
    values (v_empresa, v_op_id, 'medida_incompatible', auth.uid(), auth.uid(),
      format('Medida %s forzada fuera de homologación para el tipo de vehículo', v_ref.medida), 'aprobada', now());
  end if;

  return v_neumatico;
end $$;

-- ── 5. Comprobaciones ───────────────────────────────────────────────────────
--
-- Una sola firma por función: es la trampa documentada en
-- tyrecontrol_profundidad_manual.sql:62 (tres sobrecargas conviviendo, una de
-- ellas perdiendo la profundidad en silencio).
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'tc_montar_desde_almacen';
  if n <> 1 then raise warning 'Quedan % versiones de tc_montar_desde_almacen (se esperaba 1)', n; end if;

  select count(*) into n from pg_proc where proname = 'tc_montar_desde_catalogo';
  if n <> 1 then raise warning 'Quedan % versiones de tc_montar_desde_catalogo (se esperaba 1)', n; end if;

  -- Que el cuerpo instalado es el nuevo, no una versión anterior.
  select count(*) into n from pg_proc
   where proname in ('tc_montar_desde_almacen','tc_montar_desde_catalogo')
     and prosrc like '%tc_buscar_neumatico_identificado%';
  if n <> 2 then
    raise exception 'Los RPC de montaje NO están buscando la ficha existente (encontrados %/2)', n;
  end if;

  -- Y que sigue guardando la profundidad del usado (el fallo de
  -- tyrecontrol_fix_montar_almacen_profundidad.sql no debe volver).
  select count(*) into n from pg_proc
   where proname = 'tc_montar_desde_almacen'
     and prosrc like '%p_datos->>''profundidad_actual_mm''%';
  if n = 0 then raise exception 'tc_montar_desde_almacen ha dejado de guardar la profundidad del usado'; end if;

  raise notice 'OK: montar busca la ficha existente antes de crearla, en las dos vías';
end $$;
