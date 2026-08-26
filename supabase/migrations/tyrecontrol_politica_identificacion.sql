-- ============================================================
-- Mobilink TyreControl — Política de identificación de neumáticos
--
-- FASE 2 de docs/PROMPT_identificacion_neumaticos.md
-- Requiere: tyrecontrol_montar_buscar_o_crear.sql (fase 1)
--
-- EL PROBLEMA
--
-- El modelo mixto ya funciona, pero la identidad la decide una CASILLA que
-- alguien marca o no marca, montaje a montaje, sin criterio escrito en ninguna
-- parte: `ModalMontarFueraAlmacen` sale marcado por defecto,
-- `ModalMontarDesdeFicha` sale desmarcado, `MontajesActuales` nunca identifica
-- y la APK manda `false` fijo. Dos administrativos con el mismo cliente pueden
-- hacerlo distinto el mismo día.
--
-- LA POLÍTICA
--
-- Una tabla general por empresa más una de excepciones por medida, que es el
-- patrón que ya se usa para los umbrales de profundidad
-- (tyrecontrol_informes_umbrales_categoria.sql). Tres modos:
--
--   generico     → nada se identifica
--   identificado → todo se identifica
--   mixto        → lo que digan las excepciones por medida
--
-- POR QUÉ LA RESUELVE EL SERVIDOR Y NO LA APP
--
-- Si la decidiera cada pantalla, la política dependería de que todas las
-- versiones de la APK instaladas estuvieran al día. Resolviéndola aquí, un
-- cliente cambia de modo sin que nadie actualice nada.
--
-- CERO CAMBIO DE COMPORTAMIENTO AL APLICARLA
--
-- `p_control_individual` ya admite NULL sin tocar la firma (es boolean), así
-- que la regla es:
--
--   p_control_individual = true   → individual, mande lo que mande la política
--   p_control_individual = false  → genérico,   mande lo que mande la política
--   p_control_individual = null   → decide la política
--
-- Hoy TODOS los que llaman mandan true o false explícito (los cuatro modales
-- del panel y los dos caminos de la APK), así que al aplicar esta migración no
-- cambia absolutamente nada. Pasar a null cada pantalla es una decisión
-- posterior, pantalla a pantalla, y para la APK es la fase 3.
--
-- `exigir_identidad` solo actúa cuando ha decidido la POLÍTICA, nunca cuando
-- quien llama lo ha pedido explícitamente: si no, `ModalMontarDesdeFicha`
-- —que hoy puede mandar true con los campos vacíos— empezaría a dar error.
--
-- Idempotente: se puede ejecutar varias veces.
-- ============================================================

-- ── 1. Tablas de política ───────────────────────────────────────────────────
create table if not exists public.tc_config_identificacion (
  empresa_id       uuid primary key references tc_empresas(id) on delete cascade,
  modo             text not null default 'generico',
  -- Cuando la política resuelve "identificable" y no llega ni RFID ni serie:
  --   true  → no se puede montar (trazabilidad total)
  --   false → se monta como genérico y queda pendiente de identificar
  exigir_identidad boolean not null default false,
  updated_at       timestamptz not null default now()
);
alter table public.tc_config_identificacion drop constraint if exists ck_tc_config_ident_modo;
alter table public.tc_config_identificacion add constraint ck_tc_config_ident_modo
  check (modo in ('generico','identificado','mixto'));

-- Excepciones por medida. Solo se miran en modo 'mixto'.
create table if not exists public.tc_config_identificacion_medida (
  empresa_id    uuid not null references tc_empresas(id) on delete cascade,
  medida        text not null,
  identificable boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (empresa_id, medida)
);

comment on table public.tc_config_identificacion is
  'Modo de identificación de neumáticos por empresa: generico | identificado | mixto.';
comment on table public.tc_config_identificacion_medida is
  'Excepciones por medida del modo mixto. La medida se compara por su base '
  '(tc_medida_base), así que "315/70R22.5 154/150L" y "315/70R22.5" son la misma.';

alter table public.tc_config_identificacion enable row level security;
alter table public.tc_config_identificacion_medida enable row level security;

drop policy if exists tc_config_ident_select on public.tc_config_identificacion;
create policy tc_config_ident_select on public.tc_config_identificacion
  for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_config_ident_write on public.tc_config_identificacion;
create policy tc_config_ident_write on public.tc_config_identificacion
  for all using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

drop policy if exists tc_config_ident_medida_select on public.tc_config_identificacion_medida;
create policy tc_config_ident_medida_select on public.tc_config_identificacion_medida
  for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_config_ident_medida_write on public.tc_config_identificacion_medida;
create policy tc_config_ident_medida_write on public.tc_config_identificacion_medida
  for all using ( tc_is_superadmin() or tc_is_admin() ) with check ( tc_is_superadmin() or tc_is_admin() );

-- ── 2. Resolver la política ─────────────────────────────────────────────────
--
-- Sin fila de configuración se comporta como 'generico', que es lo que hace
-- hoy el sistema para quien no ha tocado nada.
create or replace function tc_identificacion_resuelve(p_empresa uuid, p_medida text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_modo text; v_exc boolean;
begin
  select modo into v_modo from tc_config_identificacion where empresa_id = p_empresa;
  v_modo := coalesce(v_modo, 'generico');

  if v_modo = 'generico'     then return false; end if;
  if v_modo = 'identificado' then return true;  end if;

  -- mixto: manda la excepción de la medida; si no hay ninguna, genérico.
  select identificable into v_exc
    from tc_config_identificacion_medida
   where empresa_id = p_empresa
     and tc_medida_base(medida) = tc_medida_base(p_medida)
   limit 1;
  return coalesce(v_exc, false);
end $$;

comment on function tc_identificacion_resuelve(uuid, text) is
  'Dice si un neumático de esta empresa y esta medida se controla '
  'individualmente. Sin configuración devuelve false (comportamiento actual).';

-- Solo para las pantallas: el modo y el detalle, en una llamada.
create or replace function tc_identificacion_config(p_empresa uuid)
returns table(modo text, exigir_identidad boolean, medidas jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (tc_is_superadmin() or (tc_is_admin() and p_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(p_empresa)) then
    raise exception 'Sin permiso sobre esta empresa';
  end if;
  return query
  select coalesce(c.modo, 'generico'),
         coalesce(c.exigir_identidad, false),
         coalesce((select jsonb_agg(jsonb_build_object('medida', m.medida, 'identificable', m.identificable)
                                    order by m.medida)
                     from tc_config_identificacion_medida m where m.empresa_id = p_empresa), '[]'::jsonb)
    from (select 1) x
    left join tc_config_identificacion c on c.empresa_id = p_empresa;
end $$;

-- ── 3. Un sitio único donde se aplica la política ───────────────────────────
--
-- Devuelve si el montaje es individual, y de paso valida `exigir_identidad`.
-- Los dos RPC llaman aquí para no repetir la regla (ni poder desincronizarla).
create or replace function tc_identificacion_para_montaje(
  p_empresa uuid, p_medida text, p_pedido boolean, p_datos jsonb
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_individual boolean; v_hay_identidad boolean; v_exigir boolean;
begin
  -- Lo que pide quien llama manda; la política solo decide si no dice nada.
  if p_pedido is not null then return p_pedido; end if;

  v_individual := tc_identificacion_resuelve(p_empresa, p_medida);
  if not v_individual then return false; end if;

  v_hay_identidad :=
       nullif(btrim(coalesce(p_datos->>'rfid_epc', '')), '') is not null
    or nullif(btrim(coalesce(p_datos->>'numero_serie', '')), '') is not null;
  if v_hay_identidad then return true; end if;

  select exigir_identidad into v_exigir from tc_config_identificacion where empresa_id = p_empresa;
  if coalesce(v_exigir, false) then
    raise exception 'IDENTIDAD_REQUERIDA: esta empresa exige identificar los neumáticos de medida %. Lee el RFID o teclea el número de serie antes de montar.', p_medida;
  end if;

  -- Sin identidad y sin exigirla: se monta como genérico y queda pendiente de
  -- identificar (la acción «Identificar esta rueda» es la fase 5).
  return false;
end $$;

-- ── 4. Los dos RPC consultan la política ────────────────────────────────────
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

  -- Política de identificación: p_control_individual manda si viene informado.
  v_individual := tc_identificacion_para_montaje(v_empresa, v_prod.medida, p_control_individual, p_datos);

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

  -- ── BUSCAR O CREAR (fase 1) ───────────────────────────────────────────────
  if v_individual then
    v_neumatico := tc_buscar_neumatico_identificado(v_empresa, p_datos);
  end if;

  if v_neumatico is not null then
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
      v_individual, not v_individual,
      case when p_condicion = 'usado' then 'almacen_usado' else 'almacen_generico' end,
      v_prod.marca, v_prod.modelo, v_prod.medida,
      case when v_individual then p_datos->>'indice_carga' else null end,
      case when v_individual then p_datos->>'indice_velocidad' else null end,
      coalesce(case when v_individual then p_datos->>'dot' else null end, v_prod.dot),
      case when v_individual then p_datos->>'numero_serie' else null end,
      case when v_individual then p_datos->>'rfid_epc' else null end,
      case when v_individual then p_datos->>'proveedor' else null end,
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

  -- El stock se descuenta IGUAL se reutilice o no la ficha: la unidad que sale
  -- del almacén es la misma en los dos casos.
  insert into movimientos_stock (empresa_id, cliente_id, producto_id, tipo, cantidad, ubicacion, condicion, origen_movimiento, observaciones)
  values (v_prod.empresa_id, v_cliente_almacen, p_producto_almacen, 'SALIDA', 1, v_ubicacion, p_condicion, 'montaje_tyrecontrol',
    'Montaje TyreControl (' || p_condicion || ') - neumático ' || v_numero
    || case when v_reutilizado then ' (reconocido)' else '' end);

  return v_neumatico;
end $$;

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
  v_marca_op text := ''; v_individual boolean;
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

  v_individual := tc_identificacion_para_montaje(v_empresa, v_ref.medida, p_control_individual, p_datos);

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

  -- ── BUSCAR O CREAR (fase 1) ───────────────────────────────────────────────
  if v_individual then
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
      v_individual, not v_individual,
      case when p_condicion = 'usado' then 'catalogo_usado' else 'catalogo_sin_stock' end,
      v_ref.marca_nombre, v_ref.modelo_nombre, v_ref.medida, v_ic, v_ref.codigo_velocidad,
      case when v_individual then p_datos->>'dot' else null end,
      case when v_individual then p_datos->>'numero_serie' else null end,
      case when v_individual then p_datos->>'rfid_epc' else null end,
      case when v_individual then p_datos->>'proveedor' else null end,
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
do $$
declare n int;
begin
  select count(*) into n from pg_proc where proname = 'tc_montar_desde_almacen';
  if n <> 1 then raise warning 'Quedan % versiones de tc_montar_desde_almacen (se esperaba 1)', n; end if;
  select count(*) into n from pg_proc where proname = 'tc_montar_desde_catalogo';
  if n <> 1 then raise warning 'Quedan % versiones de tc_montar_desde_catalogo (se esperaba 1)', n; end if;

  -- La fase 1 sigue en pie y la política está enchufada en las dos vías.
  select count(*) into n from pg_proc
   where proname in ('tc_montar_desde_almacen','tc_montar_desde_catalogo')
     and prosrc like '%tc_buscar_neumatico_identificado%';
  if n <> 2 then raise exception 'Los RPC han dejado de buscar la ficha existente (%/2)', n; end if;

  select count(*) into n from pg_proc
   where proname in ('tc_montar_desde_almacen','tc_montar_desde_catalogo')
     and prosrc like '%tc_identificacion_para_montaje%';
  if n <> 2 then raise exception 'Los RPC no consultan la política de identificación (%/2)', n; end if;

  select count(*) into n from pg_proc
   where proname = 'tc_montar_desde_almacen' and prosrc like '%p_datos->>''profundidad_actual_mm''%';
  if n = 0 then raise exception 'tc_montar_desde_almacen ha dejado de guardar la profundidad del usado'; end if;

  raise notice 'OK: política de identificación enchufada en las dos vías, sin cambio de comportamiento por defecto';
end $$;
