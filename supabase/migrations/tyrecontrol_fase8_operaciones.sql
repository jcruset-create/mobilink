-- ============================================================
-- SEA TyreControl — Fase 8 (Fase 5 del enunciado del usuario):
-- Operaciones de neumáticos + revisión de vehículo + stock
-- genérico/individual + montaje fuera de almacén con auditoría.
-- Requiere Fases 1-7.
--
-- Principio: el almacén (productos_neumaticos / movimientos_stock)
-- sigue siendo la fuente de verdad del STOCK físico. Este módulo es
-- la fuente de verdad de la TRAZABILIDAD TÉCNICA (qué neumático
-- concreto, en qué posición, con qué historial).
-- ============================================================

-- ── 1. Ficha genérica de neumático (nivel almacén) ────────────
create table if not exists tc_fichas_genericas_neumaticos (
  id                 uuid primary key default gen_random_uuid(),
  almacen_producto_id uuid references productos_neumaticos(id) on delete set null,
  referencia_almacen text,
  marca              text not null,
  modelo             text,
  medida             text not null,
  indice_carga       text,
  codigo_velocidad   text,
  descripcion        text,
  activo             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_tc_fichas_genericas_producto on tc_fichas_genericas_neumaticos (almacen_producto_id);

-- ── 2. Numeración interna automática (NT-AAAA-NNNNNN) ─────────
create table if not exists tc_contadores_numero_interno (
  anio  int primary key,
  ultimo int not null default 0
);

create or replace function tc_generar_numero_interno()
returns text language plpgsql security definer set search_path = public as $$
declare v_anio int; v_siguiente int;
begin
  v_anio := extract(year from now())::int;
  insert into tc_contadores_numero_interno (anio, ultimo) values (v_anio, 1)
    on conflict (anio) do update set ultimo = tc_contadores_numero_interno.ultimo + 1
    returning ultimo into v_siguiente;
  return 'NT-' || v_anio || '-' || lpad(v_siguiente::text, 6, '0');
end $$;

-- ── 3. Neumáticos: control individual / genérico ──────────────
alter table tc_neumaticos
  add column if not exists numero_interno text,
  add column if not exists ficha_generica_id uuid references tc_fichas_genericas_neumaticos(id) on delete set null,
  add column if not exists control_individual boolean not null default false,
  add column if not exists creado_automaticamente boolean not null default false,
  add column if not exists origen text,
  add column if not exists vehiculo_id uuid references tc_vehiculos(id) on delete set null,
  add column if not exists posicion_id uuid references tc_posiciones_vehiculo(id) on delete set null;

alter table tc_neumaticos drop constraint if exists chk_tc_neu_origen;
alter table tc_neumaticos add constraint chk_tc_neu_origen check (
  origen is null or origen in ('almacen_generico','alta_individual','carga_inicial','montaje_directo_cliente','importacion_excel','manual')
);

-- backfill de neumáticos ya existentes antes de exigir NOT NULL/UNIQUE
do $$
declare r record;
begin
  for r in select id from tc_neumaticos where numero_interno is null order by created_at loop
    update tc_neumaticos set numero_interno = tc_generar_numero_interno() where id = r.id;
  end loop;
end $$;

alter table tc_neumaticos alter column numero_interno set not null;
create unique index if not exists uq_tc_neu_numero_interno on tc_neumaticos (numero_interno);

-- ── 4. tc_usuarios: permisos de montaje fuera de almacén ──────
alter table tc_usuarios
  add column if not exists puede_montar_fuera_almacen boolean not null default false,
  add column if not exists puede_autorizar_montaje_fuera_almacen boolean not null default false;

-- ── 5. Operaciones de neumáticos (trazabilidad completa) ──────
create table if not exists operaciones_neumaticos (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id           uuid references tc_vehiculos(id) on delete set null,
  neumatico_id          uuid references tc_neumaticos(id) on delete set null,
  tipo_operacion        text not null check (tipo_operacion in (
                          'montaje','desmontaje','sustitucion','rotacion','reparacion',
                          'descarte','entrada_almacen','salida_almacen','revision_vehiculo'
                        )),
  posicion_origen_id    uuid references tc_posiciones_vehiculo(id),
  posicion_destino_id   uuid references tc_posiciones_vehiculo(id),
  montaje_origen_id     uuid,
  montaje_destino_id    uuid,
  km_vehiculo           numeric,
  fecha_operacion       date not null default current_date,
  motivo                text check (motivo is null or motivo in (
                          'desgaste','pinchazo','rotura','preventivo','desgaste_irregular',
                          'cambio_estacional','reparacion','fin_vida','error_montaje','otro'
                        )),
  estado_anterior       text,
  estado_nuevo          text,
  destino               text check (destino is null or destino in ('vehiculo','almacen','reparacion','descarte')),
  almacen_movimiento_id uuid,
  tecnico_id            uuid references tc_usuarios(id),
  observaciones         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_op_neu_empresa on operaciones_neumaticos (empresa_id);
create index if not exists idx_op_neu_vehiculo on operaciones_neumaticos (vehiculo_id);
create index if not exists idx_op_neu_neumatico on operaciones_neumaticos (neumatico_id);
create index if not exists idx_op_neu_tipo on operaciones_neumaticos (tipo_operacion);
create index if not exists idx_op_neu_fecha on operaciones_neumaticos (fecha_operacion);

-- ── 6. Autorizaciones (montaje fuera de almacén, correcciones…) ─
create table if not exists autorizaciones_operaciones (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references tc_empresas(id) on delete restrict,
  operacion_id       uuid references operaciones_neumaticos(id) on delete set null,
  tipo_autorizacion  text not null check (tipo_autorizacion in (
                       'montaje_fuera_almacen','montaje_sin_dot','montaje_sin_rfid',
                       'correccion_manual','anulacion_operacion'
                     )),
  solicitado_por     uuid not null references tc_usuarios(id),
  autorizado_por     uuid references tc_usuarios(id),
  motivo             text not null,
  estado             text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada')),
  fecha_solicitud    timestamptz not null default now(),
  fecha_autorizacion timestamptz
);
create index if not exists idx_auth_op_empresa on autorizaciones_operaciones (empresa_id);

-- ── 7. Revisión de vehículo ────────────────────────────────────
create table if not exists revisiones_vehiculo (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id     uuid not null references tc_vehiculos(id) on delete restrict,
  km_vehiculo     numeric,
  origen_km       text default 'manual',
  fecha_revision  date not null default current_date,
  tecnico_id      uuid references tc_usuarios(id),
  estado_revision text not null default 'borrador' check (estado_revision in ('borrador','completada','enviada','anulada')),
  observaciones   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_rev_veh_vehiculo on revisiones_vehiculo (vehiculo_id);
create index if not exists idx_rev_veh_empresa on revisiones_vehiculo (empresa_id);

create table if not exists revisiones_neumaticos_detalle (
  id                 uuid primary key default gen_random_uuid(),
  revision_id        uuid not null references revisiones_vehiculo(id) on delete cascade,
  empresa_id         uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id        uuid not null references tc_vehiculos(id) on delete restrict,
  neumatico_id       uuid references tc_neumaticos(id) on delete set null,
  posicion_id        uuid not null references tc_posiciones_vehiculo(id),
  profundidad_mm     numeric,
  presion_bar        numeric,
  temperatura        numeric,
  metodo_profundidad text check (metodo_profundidad is null or metodo_profundidad in ('manual','bluetooth','importacion_excel')),
  metodo_presion     text check (metodo_presion is null or metodo_presion in ('manual','bluetooth','importacion_excel')),
  estado_visual      text,
  observaciones      text,
  foto_url           text,
  no_accesible       boolean not null default false,
  neumatico_ausente  boolean not null default false,
  alerta_generada    boolean not null default false,
  created_at         timestamptz not null default now(),
  unique (revision_id, posicion_id)
);
create index if not exists idx_rev_det_revision on revisiones_neumaticos_detalle (revision_id);
create index if not exists idx_rev_det_neumatico on revisiones_neumaticos_detalle (neumatico_id);

-- Umbrales de alerta configurables por empresa (null = usar defecto global)
create table if not exists tc_umbrales_revision (
  empresa_id           uuid primary key references tc_empresas(id) on delete cascade,
  profundidad_min_mm   numeric not null default 3,
  presion_min_bar      numeric not null default 7,
  presion_max_bar      numeric not null default 9.5,
  dot_antiguedad_anios int not null default 5
);

-- ============================================================
-- RLS
-- ============================================================
alter table tc_fichas_genericas_neumaticos enable row level security;
alter table operaciones_neumaticos          enable row level security;
alter table autorizaciones_operaciones      enable row level security;
alter table revisiones_vehiculo             enable row level security;
alter table revisiones_neumaticos_detalle   enable row level security;
alter table tc_umbrales_revision            enable row level security;

-- Fichas genéricas: catálogo, lectura para autenticados, escritura superadmin
drop policy if exists tc_fichas_genericas_select on tc_fichas_genericas_neumaticos;
create policy tc_fichas_genericas_select on tc_fichas_genericas_neumaticos for select using ( auth.uid() is not null );
drop policy if exists tc_fichas_genericas_write on tc_fichas_genericas_neumaticos;
create policy tc_fichas_genericas_write on tc_fichas_genericas_neumaticos for all
  using ( tc_is_superadmin() ) with check ( tc_is_superadmin() );

-- Operaciones: ver = quien puede ver la empresa; crear = admin/operador con permiso; NUNCA borrar (sin policy delete)
drop policy if exists op_neu_select on operaciones_neumaticos;
create policy op_neu_select on operaciones_neumaticos for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists op_neu_insert on operaciones_neumaticos;
create policy op_neu_insert on operaciones_neumaticos for insert
  with check (
    tc_is_superadmin()
    or (tc_is_admin() and empresa_id = tc_auth_empresa_id())
    or (tc_operador_ve_empresa(empresa_id))
  );
drop policy if exists op_neu_update on operaciones_neumaticos;
create policy op_neu_update on operaciones_neumaticos for update
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );
-- (sin policy de delete: nadie puede borrar operaciones, ni siquiera superadmin, por RLS)

-- Autorizaciones: solo admin/superadmin ven y gestionan; el solicitante ve las suyas
drop policy if exists auth_op_select on autorizaciones_operaciones;
create policy auth_op_select on autorizaciones_operaciones for select
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or solicitado_por = auth.uid() );
drop policy if exists auth_op_insert on autorizaciones_operaciones;
create policy auth_op_insert on autorizaciones_operaciones for insert
  with check ( solicitado_por = auth.uid() and tc_puede_ver_empresa(empresa_id) );
drop policy if exists auth_op_update on autorizaciones_operaciones;
create policy auth_op_update on autorizaciones_operaciones for update
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- Revisiones: mismo criterio que vehículos/montajes
drop policy if exists rev_veh_select on revisiones_vehiculo;
create policy rev_veh_select on revisiones_vehiculo for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists rev_veh_write on revisiones_vehiculo;
create policy rev_veh_write on revisiones_vehiculo for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id) );

drop policy if exists rev_det_select on revisiones_neumaticos_detalle;
create policy rev_det_select on revisiones_neumaticos_detalle for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists rev_det_write on revisiones_neumaticos_detalle;
create policy rev_det_write on revisiones_neumaticos_detalle for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id) );

drop policy if exists umbrales_select on tc_umbrales_revision;
create policy umbrales_select on tc_umbrales_revision for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists umbrales_write on tc_umbrales_revision;
create policy umbrales_write on tc_umbrales_revision for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- ============================================================
-- RPCs de negocio (todas SECURITY DEFINER, atómicas)
-- ============================================================

-- ── Montaje desde almacén: genérico o individual ──────────────
-- p_control_individual = false -> crea neumático técnico mínimo (número interno + datos heredados de la ficha)
-- p_control_individual = true  -> exige datos individuales (dot/serie/rfid/proveedor/lote) en p_datos (jsonb)
create or replace function tc_montar_desde_almacen(
  p_vehiculo uuid, p_posicion uuid, p_ficha_generica uuid, p_control_individual boolean,
  p_datos jsonb default '{}'::jsonb, p_km numeric default null, p_fecha date default current_date, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_ficha record; v_empresa uuid; v_neumatico uuid; v_montaje uuid; v_numero text;
begin
  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;

  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_empresa)) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;

  select * into v_ficha from tc_fichas_genericas_neumaticos where id = p_ficha_generica and activo = true;
  if not found then raise exception 'Ficha genérica de almacén no encontrada'; end if;

  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and posicion_id = p_posicion) then
    raise exception 'La posición ya tiene un neumático montado';
  end if;

  v_numero := tc_generar_numero_interno();

  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno, ficha_generica_id, almacen_producto_id,
    control_individual, creado_automaticamente, origen,
    marca, modelo, medida, indice_carga, indice_velocidad,
    dot, numero_serie, rfid_epc, proveedor, referencia_almacen,
    estado, vehiculo_id, posicion_id, activo
  ) values (
    v_empresa, v_numero, v_numero, p_ficha_generica, v_ficha.almacen_producto_id,
    p_control_individual, not p_control_individual, 'almacen_generico',
    v_ficha.marca, v_ficha.modelo, v_ficha.medida, v_ficha.indice_carga, v_ficha.codigo_velocidad,
    case when p_control_individual then p_datos->>'dot' else null end,
    case when p_control_individual then p_datos->>'numero_serie' else null end,
    case when p_control_individual then p_datos->>'rfid_epc' else null end,
    case when p_control_individual then p_datos->>'proveedor' else null end,
    v_ficha.referencia_almacen,
    'montado', p_vehiculo, p_posicion, true
  ) returning id into v_neumatico;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    'almacen', 'montado', 'vehiculo', auth.uid(), p_obs);

  -- NOTA: descuento real de stock (movimientos_stock, salida_montaje) pendiente
  -- de activar: falta resolver vehiculo_id del almacén y cliente_almacen_id
  -- por defecto para todas las empresas (ver notas de la Fase 4/5a).
  return v_neumatico;
end $$;

-- ── Montaje fuera de almacén (con auditoría/autorización) ─────
create or replace function tc_montar_fuera_almacen(
  p_vehiculo uuid, p_posicion uuid, p_control_individual boolean, p_datos jsonb default '{}'::jsonb,
  p_motivo text default null, p_km numeric default null, p_fecha date default current_date, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_veh record; v_empresa uuid; v_usuario record; v_neumatico uuid; v_montaje uuid; v_numero text;
  v_autorizado boolean; v_operacion uuid;
begin
  if p_motivo is null or trim(p_motivo) = '' then
    raise exception 'El motivo es obligatorio para montar un neumático fuera de almacén';
  end if;

  select * into v_veh from tc_vehiculos where id = p_vehiculo;
  if not found then raise exception 'Vehículo no encontrado'; end if;
  v_empresa := v_veh.empresa_id;
  select * into v_usuario from tc_usuarios where id = auth.uid();

  if v_usuario.rol = 'cliente' then raise exception 'Un cliente no puede montar neumáticos fuera de almacén'; end if;
  if not tc_puede_ver_empresa(v_empresa) then raise exception 'Sin permiso sobre esta empresa'; end if;

  v_autorizado := tc_is_superadmin() or tc_is_admin() or coalesce(v_usuario.puede_montar_fuera_almacen, false);
  if not v_autorizado then
    raise exception 'No tienes permiso para montar fuera de almacén; solicita autorización a un administrador (ver Autorizaciones)';
  end if;

  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;
  if exists (select 1 from tc_montajes_actuales where vehiculo_id = p_vehiculo and posicion_id = p_posicion) then
    raise exception 'La posición ya tiene un neumático montado';
  end if;

  v_numero := tc_generar_numero_interno();

  insert into tc_neumaticos (
    empresa_id, numero_interno, codigo_interno, control_individual, creado_automaticamente, origen,
    marca, modelo, medida, indice_carga, indice_velocidad, dot, numero_serie, rfid_epc,
    estado, vehiculo_id, posicion_id, activo
  ) values (
    v_empresa, v_numero, v_numero, p_control_individual, not p_control_individual, 'montaje_directo_cliente',
    p_datos->>'marca', p_datos->>'modelo', p_datos->>'medida', p_datos->>'indice_carga', p_datos->>'indice_velocidad',
    p_datos->>'dot', p_datos->>'numero_serie', p_datos->>'rfid_epc',
    'montado', p_vehiculo, p_posicion, true
  ) returning id into v_neumatico;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, v_neumatico, 'montaje', p_posicion, v_montaje, p_km, coalesce(p_fecha, current_date),
    'otro', null, 'montado', 'vehiculo', auth.uid(), coalesce(p_obs, '') || ' [FUERA DE ALMACÉN] ' || p_motivo)
  returning id into v_operacion;

  insert into autorizaciones_operaciones (empresa_id, operacion_id, tipo_autorizacion, solicitado_por, autorizado_por, motivo, estado, fecha_autorizacion)
  values (v_empresa, v_operacion, 'montaje_fuera_almacen', auth.uid(),
    case when tc_is_superadmin() or tc_is_admin() then auth.uid() else null end,
    p_motivo,
    case when tc_is_superadmin() or tc_is_admin() then 'aprobada' else 'pendiente' end,
    case when tc_is_superadmin() or tc_is_admin() then now() else null end);

  return v_neumatico;
end $$;

-- ── Sustitución: desmonta el actual + monta uno nuevo de almacén ─
create or replace function tc_sustituir_neumatico(
  p_montaje_actual uuid, p_ficha_generica uuid, p_control_individual boolean, p_datos jsonb default '{}'::jsonb,
  p_motivo_desmontaje text default 'desgaste', p_destino_retirado text default 'almacen',
  p_km numeric default null, p_fecha date default current_date, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  m record; v_neumatico_nuevo uuid; v_operacion uuid;
begin
  select * into m from tc_montajes_actuales where id = p_montaje_actual;
  if not found then raise exception 'Montaje actual no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(m.empresa_id)) then
    raise exception 'Sin permiso';
  end if;

  -- 1) desmontar el actual (misma lógica que tc_desmontar_neumatico, inline para poder ligarlo a la sustitución)
  insert into tc_historial_montajes (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje,
    fecha_desmontaje, km_desmontaje, motivo_desmontaje, tecnico_montaje_id, tecnico_desmontaje_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, m.posicion_id, m.fecha_montaje, m.km_montaje,
    coalesce(p_fecha, current_date), p_km, p_motivo_desmontaje, m.tecnico_id, auth.uid(), coalesce(p_obs, m.observaciones));

  update tc_neumaticos set estado = p_destino_retirado, vehiculo_id = null, posicion_id = null, updated_at = now() where id = m.neumatico_id;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, 'sustitucion', m.posicion_id, m.id, p_km, coalesce(p_fecha, current_date),
    p_motivo_desmontaje, 'montado', p_destino_retirado, p_destino_retirado, auth.uid(), p_obs)
  returning id into v_operacion;

  delete from tc_montajes_actuales where id = p_montaje_actual;

  -- 2) montar el nuevo en la misma posición
  v_neumatico_nuevo := tc_montar_desde_almacen(m.vehiculo_id, m.posicion_id, p_ficha_generica, p_control_individual, p_datos, p_km, p_fecha, p_obs);

  -- re-etiqueta la operación de montaje del nuevo como parte de la sustitución
  update operaciones_neumaticos set tipo_operacion = 'sustitucion'
    where neumatico_id = v_neumatico_nuevo and tipo_operacion = 'montaje' and vehiculo_id = m.vehiculo_id
      and created_at >= now() - interval '5 seconds';

  return v_neumatico_nuevo;
end $$;

-- ── Reparación (neumático no montado) ──────────────────────────
create or replace function tc_reparar_neumatico(p_neumatico uuid, p_motivo text default 'reparacion', p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_neu record;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_neu.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_neu.empresa_id)) then
    raise exception 'Sin permiso';
  end if;
  if v_neu.estado = 'montado' then raise exception 'El neumático está montado; desmóntalo primero'; end if;

  update tc_neumaticos set estado = 'reparacion', updated_at = now() where id = p_neumatico;

  insert into operaciones_neumaticos (empresa_id, neumatico_id, tipo_operacion, fecha_operacion, motivo,
    estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_neu.empresa_id, p_neumatico, 'reparacion', current_date, p_motivo, v_neu.estado, 'reparacion', 'reparacion', auth.uid(), p_obs);
end $$;

-- ── Descarte (neumático no montado) ────────────────────────────
create or replace function tc_descartar_neumatico(p_neumatico uuid, p_motivo text default 'fin_vida', p_obs text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_neu record;
begin
  select * into v_neu from tc_neumaticos where id = p_neumatico;
  if not found then raise exception 'Neumático no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and v_neu.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(v_neu.empresa_id)) then
    raise exception 'Sin permiso';
  end if;
  if v_neu.estado = 'montado' then raise exception 'El neumático está montado; desmóntalo primero'; end if;

  update tc_neumaticos set estado = 'descartado', activo = false, updated_at = now() where id = p_neumatico;

  insert into operaciones_neumaticos (empresa_id, neumatico_id, tipo_operacion, fecha_operacion, motivo,
    estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_neu.empresa_id, p_neumatico, 'descarte', current_date, p_motivo, v_neu.estado, 'descartado', 'descarte', auth.uid(), p_obs);
end $$;

-- ── tc_montar_neumatico / tc_desmontar_neumatico (Fase 4): ─────
-- se extienden para registrar también la operación correspondiente.
create or replace function tc_montar_neumatico(
  p_vehiculo uuid, p_neumatico uuid, p_posicion uuid,
  p_km numeric default null, p_fecha date default current_date, p_obs text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_empresa uuid; v_neu record; v_veh record; v_id uuid;
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

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, p_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_id;

  update tc_neumaticos set estado = 'montado', vehiculo_id = p_vehiculo, posicion_id = p_posicion, updated_at = now() where id = p_neumatico;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_destino_id,
    montaje_destino_id, km_vehiculo, fecha_operacion, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, p_neumatico, 'montaje', p_posicion, v_id, p_km, coalesce(p_fecha, current_date),
    v_neu.estado, 'montado', 'vehiculo', auth.uid(), p_obs);

  return v_id;
end $$;

create or replace function tc_desmontar_neumatico(
  p_montaje uuid, p_km numeric default null, p_motivo text default null,
  p_nuevo_estado text default 'almacen', p_obs text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare m record; v_estado_anterior text;
begin
  select * into m from tc_montajes_actuales where id = p_montaje;
  if not found then raise exception 'Montaje no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(m.empresa_id)) then
    raise exception 'Sin permiso';
  end if;
  if p_nuevo_estado not in ('almacen','reparacion','descartado') then
    raise exception 'Estado destino no válido';
  end if;

  select estado into v_estado_anterior from tc_neumaticos where id = m.neumatico_id;

  insert into tc_historial_montajes (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje,
    fecha_desmontaje, km_desmontaje, motivo_desmontaje, tecnico_montaje_id, tecnico_desmontaje_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, m.posicion_id, m.fecha_montaje, m.km_montaje,
    current_date, p_km, p_motivo, m.tecnico_id, auth.uid(), coalesce(p_obs, m.observaciones));

  update tc_neumaticos set estado = p_nuevo_estado, vehiculo_id = null, posicion_id = null,
    activo = case when p_nuevo_estado = 'descartado' then false else activo end, updated_at = now()
    where id = m.neumatico_id;
  delete from tc_montajes_actuales where id = p_montaje;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    montaje_origen_id, km_vehiculo, fecha_operacion, motivo, estado_anterior, estado_nuevo, destino, tecnico_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, 'desmontaje', m.posicion_id, m.id, p_km, current_date,
    p_motivo, v_estado_anterior, p_nuevo_estado,
    case p_nuevo_estado when 'almacen' then 'almacen' when 'reparacion' then 'reparacion' else 'descarte' end,
    auth.uid(), p_obs);
end $$;

-- ── tc_rotar_neumatico (Fase 6b): añade registro de operación ──
create or replace function tc_rotar_neumatico(
  p_montaje_origen uuid, p_posicion_destino uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare m_origen record; m_destino record; v_veh record; v_posicion_origen uuid;
begin
  select * into m_origen from tc_montajes_actuales where id = p_montaje_origen;
  if not found then raise exception 'Montaje de origen no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m_origen.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(m_origen.empresa_id)) then
    raise exception 'Sin permiso para rotar neumáticos en esta empresa';
  end if;

  select * into v_veh from tc_vehiculos where id = m_origen.vehiculo_id;
  if not exists (
    select 1 from tc_posiciones_vehiculo where id = p_posicion_destino and tipo_vehiculo_id = v_veh.tipo_vehiculo_id
  ) then
    raise exception 'La posición destino no corresponde al tipo del vehículo';
  end if;

  if p_posicion_destino = m_origen.posicion_id then return; end if;
  v_posicion_origen := m_origen.posicion_id;

  select * into m_destino from tc_montajes_actuales
    where vehiculo_id = m_origen.vehiculo_id and posicion_id = p_posicion_destino;

  if not found then
    update tc_montajes_actuales set posicion_id = p_posicion_destino where id = m_origen.id;
    update tc_neumaticos set posicion_id = p_posicion_destino, updated_at = now() where id = m_origen.neumatico_id;
  else
    update tc_montajes_actuales set posicion_id = null where id = m_origen.id;
    update tc_montajes_actuales set posicion_id = v_posicion_origen where id = m_destino.id;
    update tc_montajes_actuales set posicion_id = p_posicion_destino where id = m_origen.id;
    update tc_neumaticos set posicion_id = v_posicion_origen, updated_at = now() where id = m_destino.neumatico_id;
    update tc_neumaticos set posicion_id = p_posicion_destino, updated_at = now() where id = m_origen.neumatico_id;
  end if;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, neumatico_id, tipo_operacion, posicion_origen_id,
    posicion_destino_id, montaje_origen_id, fecha_operacion, estado_nuevo, destino, tecnico_id)
  values (m_origen.empresa_id, m_origen.vehiculo_id, m_origen.neumatico_id, 'rotacion', v_posicion_origen,
    p_posicion_destino, m_origen.id, current_date, 'montado', 'vehiculo', auth.uid());
end $$;

alter table tc_montajes_actuales alter column posicion_id drop not null;

-- ── Revisión de vehículo: completar (valida + genera alertas) ──
create or replace function tc_completar_revision(p_revision uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; d record; u record; alerta boolean;
begin
  select * into r from revisiones_vehiculo where id = p_revision;
  if not found then raise exception 'Revisión no encontrada'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and r.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(r.empresa_id)) then
    raise exception 'Sin permiso';
  end if;

  select * into u from tc_umbrales_revision where empresa_id = r.empresa_id;
  if not found then u := row(r.empresa_id, 3, 7, 9.5, 5)::tc_umbrales_revision; end if;

  for d in select * from revisiones_neumaticos_detalle where revision_id = p_revision loop
    alerta := false;
    if not d.no_accesible and not d.neumatico_ausente then
      if d.profundidad_mm is not null and d.profundidad_mm < u.profundidad_min_mm then alerta := true; end if;
      if d.presion_bar is not null and (d.presion_bar < u.presion_min_bar or d.presion_bar > u.presion_max_bar) then alerta := true; end if;
    end if;
    if d.neumatico_ausente then alerta := true; end if;
    update revisiones_neumaticos_detalle set alerta_generada = alerta where id = d.id;
  end loop;

  update revisiones_vehiculo set estado_revision = 'completada', updated_at = now() where id = p_revision;

  insert into operaciones_neumaticos (empresa_id, vehiculo_id, tipo_operacion, km_vehiculo, fecha_operacion, tecnico_id, observaciones)
  values (r.empresa_id, r.vehiculo_id, 'revision_vehiculo', r.km_vehiculo, r.fecha_revision, coalesce(r.tecnico_id, auth.uid()), r.observaciones);
end $$;
