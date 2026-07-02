-- ============================================================
-- SEA TyreControl — Fase 14: Módulo maestro de medidas de
-- neumático. Extiende tc_cat_medidas_neumatico (Fase 9) en vez
-- de crear una tabla paralela, y añade compatibilidad medida <->
-- tipo de vehículo + bloqueo de montaje de medida no homologada
-- (salvo autorización de admin, igual que "fuera de almacén").
-- ============================================================

-- ── 1. Atributos técnicos de la medida ────────────────────────
alter table tc_cat_medidas_neumatico
  add column if not exists ancho        numeric,
  add column if not exists perfil       numeric,
  add column if not exists diametro     numeric,
  add column if not exists construccion text,
  add column if not exists aplicacion   text,
  add column if not exists notas        text;

alter table tc_cat_medidas_neumatico drop constraint if exists chk_medida_construccion;
alter table tc_cat_medidas_neumatico add constraint chk_medida_construccion
  check (construccion is null or construccion in ('radial','diagonal','otros'));

alter table tc_cat_medidas_neumatico drop constraint if exists chk_medida_aplicacion;
alter table tc_cat_medidas_neumatico add constraint chk_medida_aplicacion
  check (aplicacion is null or aplicacion in (
    'direccion','traccion','remolque','mixta','regional','larga_distancia',
    'obra','cantera','urbano','autobus','todo_terreno'
  ));

-- Backfill: parsea ancho/perfil/diametro de los valores ya existentes
-- (formato "315/80R22.5", "315/80 R22.5", "13R22.5"...).
update tc_cat_medidas_neumatico
set ancho = (regexp_match(valor, '^(\d+)\s*/'))[1]::numeric
where ancho is null and valor ~ '^\d+\s*/';

update tc_cat_medidas_neumatico
set perfil = (regexp_match(valor, '/\s*(\d+)'))[1]::numeric
where perfil is null and valor ~ '/\s*\d+';

update tc_cat_medidas_neumatico
set diametro = (regexp_match(valor, 'R\s*(\d+(\.\d+)?)', 'i'))[1]::numeric
where diametro is null and valor ~* 'R\s*\d';

-- ── 2. Compatibilidad medida <-> tipo de vehículo ─────────────
create table if not exists tc_medidas_tipo_vehiculo (
  id              uuid primary key default gen_random_uuid(),
  medida_id       uuid not null references tc_cat_medidas_neumatico(id) on delete cascade,
  tipo_vehiculo_id uuid not null references tc_tipos_vehiculo(id) on delete cascade,
  unique (medida_id, tipo_vehiculo_id)
);
create index if not exists idx_tc_medtv_medida on tc_medidas_tipo_vehiculo (medida_id);
create index if not exists idx_tc_medtv_tipo on tc_medidas_tipo_vehiculo (tipo_vehiculo_id);

alter table tc_medidas_tipo_vehiculo enable row level security;
drop policy if exists tc_medtv_select on tc_medidas_tipo_vehiculo;
create policy tc_medtv_select on tc_medidas_tipo_vehiculo for select using ( auth.uid() is not null );
drop policy if exists tc_medtv_write on tc_medidas_tipo_vehiculo;
create policy tc_medtv_write on tc_medidas_tipo_vehiculo for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

-- ── 3. Semilla: medidas principales + enlace a tipos existentes ─
-- Solo se enlazan a los tipos que YA existen en tc_tipos_vehiculo
-- (tractora, semirremolque, camion_2_ejes, camion_3_ejes, autobus,
-- autocar). No se crean tipos nuevos (agrícola/OTR/industrial/
-- carretilla quedan para cuando haya vehículos reales de ese tipo).

insert into tc_cat_medidas_neumatico (valor) values
  ('315/80R22.5'),('315/70R22.5'),('315/60R22.5'),('295/80R22.5'),('385/65R22.5'),
  ('385/55R22.5'),('445/45R19.5'),('435/50R19.5'),('275/70R22.5'),('13R22.5'),
  ('305/70R22.5'),('12R22.5'),('245/70R19.5'),('265/70R19.5'),('285/70R19.5'),
  ('305/70R19.5'),('385/55R19.5')
on conflict (valor) do nothing;

-- backfill de ancho/perfil/diametro para las recién insertadas
update tc_cat_medidas_neumatico
set ancho = (regexp_match(valor, '^(\d+)\s*/'))[1]::numeric
where ancho is null and valor ~ '^\d+\s*/';
update tc_cat_medidas_neumatico
set perfil = (regexp_match(valor, '/\s*(\d+)'))[1]::numeric
where perfil is null and valor ~ '/\s*\d+';
update tc_cat_medidas_neumatico
set diametro = (regexp_match(valor, 'R\s*(\d+(\.\d+)?)', 'i'))[1]::numeric
where diametro is null and valor ~* 'R\s*\d';

do $$
declare
  v_tractora uuid; v_semi uuid; v_rigido2 uuid; v_rigido3 uuid; v_bus uuid; v_autocar uuid;
begin
  select id into v_tractora from tc_tipos_vehiculo where nombre = 'tractora';
  select id into v_semi     from tc_tipos_vehiculo where nombre = 'semirremolque';
  select id into v_rigido2  from tc_tipos_vehiculo where nombre = 'camion_2_ejes';
  select id into v_rigido3  from tc_tipos_vehiculo where nombre = 'camion_3_ejes';
  select id into v_bus      from tc_tipos_vehiculo where nombre = 'autobus';
  select id into v_autocar  from tc_tipos_vehiculo where nombre = 'autocar';

  -- Tractoras
  if v_tractora is not null then
    insert into tc_medidas_tipo_vehiculo (medida_id, tipo_vehiculo_id)
    select m.id, v_tractora from tc_cat_medidas_neumatico m
    where m.valor in ('315/80R22.5','315/70R22.5','315/60R22.5','295/80R22.5','385/65R22.5')
    on conflict do nothing;
  end if;

  -- Semirremolques
  if v_semi is not null then
    insert into tc_medidas_tipo_vehiculo (medida_id, tipo_vehiculo_id)
    select m.id, v_semi from tc_cat_medidas_neumatico m
    where m.valor in ('385/65R22.5','385/55R22.5','445/45R19.5','435/50R19.5')
    on conflict do nothing;
  end if;

  -- Camiones rígidos (2 y 3 ejes)
  if v_rigido2 is not null then
    insert into tc_medidas_tipo_vehiculo (medida_id, tipo_vehiculo_id)
    select m.id, v_rigido2 from tc_cat_medidas_neumatico m
    where m.valor in ('315/80R22.5','295/80R22.5','315/70R22.5','275/70R22.5','13R22.5')
    on conflict do nothing;
  end if;
  if v_rigido3 is not null then
    insert into tc_medidas_tipo_vehiculo (medida_id, tipo_vehiculo_id)
    select m.id, v_rigido3 from tc_cat_medidas_neumatico m
    where m.valor in ('315/80R22.5','295/80R22.5','315/70R22.5','275/70R22.5','13R22.5')
    on conflict do nothing;
  end if;

  -- Autobuses / autocares
  if v_bus is not null then
    insert into tc_medidas_tipo_vehiculo (medida_id, tipo_vehiculo_id)
    select m.id, v_bus from tc_cat_medidas_neumatico m
    where m.valor in ('295/80R22.5','275/70R22.5','315/80R22.5','305/70R22.5','12R22.5')
    on conflict do nothing;
  end if;
  if v_autocar is not null then
    insert into tc_medidas_tipo_vehiculo (medida_id, tipo_vehiculo_id)
    select m.id, v_autocar from tc_cat_medidas_neumatico m
    where m.valor in ('295/80R22.5','275/70R22.5','315/80R22.5','305/70R22.5','12R22.5')
    on conflict do nothing;
  end if;
end $$;

-- ── 4. Compatibilidad: función de consulta ────────────────────
-- Si el tipo de vehículo no tiene NINGUNA medida configurada todavía,
-- se considera "abierto" (compatible con todo) para no bloquear tipos
-- que aún no se han parametrizado (ej. furgoneta, turismo).
create or replace function tc_medida_compatible(p_tipo_vehiculo uuid, p_medida text)
returns boolean language sql stable security definer set search_path = public as $$
  select
    not exists (select 1 from tc_medidas_tipo_vehiculo where tipo_vehiculo_id = p_tipo_vehiculo)
    or exists (
      select 1 from tc_medidas_tipo_vehiculo mtv
      join tc_cat_medidas_neumatico m on m.id = mtv.medida_id
      where mtv.tipo_vehiculo_id = p_tipo_vehiculo and m.valor = p_medida
    )
$$;

-- ── 5. Autorización de medida incompatible ────────────────────
alter table autorizaciones_operaciones drop constraint if exists autorizaciones_operaciones_tipo_autorizacion_check;
alter table autorizaciones_operaciones add constraint autorizaciones_operaciones_tipo_autorizacion_check
  check (tipo_autorizacion in (
    'montaje_fuera_almacen','montaje_sin_dot','montaje_sin_rfid',
    'correccion_manual','anulacion_operacion','medida_incompatible'
  ));

-- ── 6. tc_montar_neumatico / tc_montar_desde_almacen: bloqueo ──
create or replace function tc_montar_neumatico(
  p_vehiculo uuid, p_neumatico uuid, p_posicion uuid,
  p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_neu record; v_veh record; v_montaje uuid; v_op_id uuid; v_compatible boolean;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;
  v_empresa := v_veh.empresa_id;

  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;
  if v_neu.empresa_id <> v_empresa then raise exception 'El neumático y el vehículo son de empresas distintas'; end if;
  if v_neu.estado = 'descartado' then raise exception 'No se puede montar un neumático descartado'; end if;
  if v_neu.estado = 'montado' then raise exception 'El neumático ya está montado'; end if;
  if v_neu.estado = 'reparacion' then raise exception 'No se puede montar un neumático en reparación'; end if;
  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and posicion_id = p_posicion) then
    raise exception 'La posición ya tiene un neumático montado';
  end if;

  v_compatible := v_neu.medida is null or tc_medida_compatible(v_veh.tipo_vehiculo_id, v_neu.medida);
  if not v_compatible then
    if not p_forzar_medida then
      raise exception 'MEDIDA_INCOMPATIBLE: % no está homologada para este tipo de vehículo', v_neu.medida;
    end if;
    if not (tc_is_superadmin() or tc_is_admin()) then
      raise exception 'Solo un administrador puede forzar el montaje de una medida no homologada';
    end if;
  end if;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, p_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  update tc_neumaticos set estado = 'montado', vehiculo_id = p_vehiculo, posicion_id = p_posicion, updated_at = now() where id = p_neumatico;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, p_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    v_neu.estado, 'montado', 'vehiculo', auth.uid(), p_obs)
  returning id into v_op_id;

  if not v_compatible then
    insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
    values (v_empresa, v_op_id, 'medida_incompatible', auth.uid(), auth.uid(),
      format('Medida %s forzada fuera de homologación para el tipo de vehículo', v_neu.medida), 'aprobada', now());
  end if;

  return v_montaje;
end $$;

create or replace function tc_montar_desde_almacen(
  p_vehiculo uuid, p_posicion uuid, p_producto_almacen uuid, p_control_individual boolean,
  p_datos jsonb default '{}'::jsonb, p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_prod record; v_empresa uuid; v_neumatico uuid; v_montaje uuid; v_numero text;
  v_compatible boolean; v_op_id uuid;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;

  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;

  select * into v_prod from productos_neumaticos where id = p_producto_almacen and activo = true;
  if not found then raise exception 'Producto de almacén no encontrado'; end if;

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

  v_numero := tc_generar_numero_interno();

  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno, almacen_producto_id,
    control_individual, creado_automaticamente, origen,
    marca, modelo, medida, indice_carga, indice_velocidad,
    dot, numero_serie, rfid_epc, proveedor,
    estado, vehiculo_id, posicion_id, activo
  ) values (
    v_empresa, v_numero, v_numero, p_producto_almacen,
    p_control_individual, not p_control_individual, 'almacen_generico',
    v_prod.marca, v_prod.modelo, v_prod.medida,
    case when p_control_individual then p_datos->>'indice_carga' else null end,
    case when p_control_individual then p_datos->>'indice_velocidad' else null end,
    coalesce(case when p_control_individual then p_datos->>'dot' else null end, v_prod.dot),
    case when p_control_individual then p_datos->>'numero_serie' else null end,
    case when p_control_individual then p_datos->>'rfid_epc' else null end,
    case when p_control_individual then p_datos->>'proveedor' else null end,
    'montado', p_vehiculo, p_posicion, true
  ) returning id into v_neumatico;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    'almacen', 'montado', 'vehiculo', auth.uid(), p_obs)
  returning id into v_op_id;

  if not v_compatible then
    insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
    values (v_empresa, v_op_id, 'medida_incompatible', auth.uid(), auth.uid(),
      format('Medida %s forzada fuera de homologación para el tipo de vehículo', v_prod.medida), 'aprobada', now());
  end if;

  return v_neumatico;
end $$;

-- ── 7. tc_sustituir_neumatico: propaga el forzado de medida ────
create or replace function tc_sustituir_neumatico(
  p_montaje_actual uuid, p_producto_almacen uuid, p_control_individual boolean, p_datos jsonb default '{}'::jsonb,
  p_motivo_desmontaje text default 'desgaste', p_destino_retirado text default 'almacen',
  p_km numeric default null, p_fecha date default current_date, p_obs text default null,
  p_forzar_medida boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m record; v_neumatico_nuevo uuid;
begin
  select * into m from tc_montajes_actuales where id = p_montaje_actual;
  if not found then raise exception 'Montaje actual no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(m.empresa_id)) then
    raise exception 'Sin permiso';
  end if;

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

  v_neumatico_nuevo := tc_montar_desde_almacen(m.vehiculo_id, m.posicion_id, p_producto_almacen, p_control_individual, p_datos, p_km, p_fecha, p_obs, p_forzar_medida);

  update operaciones_neumaticos set tipo_operacion = 'sustitucion'
    where neumatico_id = v_neumatico_nuevo and tipo_operacion = 'montaje' and vehiculo_id = m.vehiculo_id
      and created_at >= now() - interval '5 seconds';

  return v_neumatico_nuevo;
end $$;
