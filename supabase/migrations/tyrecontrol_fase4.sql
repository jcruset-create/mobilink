-- ============================================================
-- SEA TyreControl — Fase 4: neumáticos, montajes actuales,
-- historial de montajes. Trazabilidad técnica.
-- Enlace a almacén PREPARADO (columnas nullable) — la sincronización
-- real de stock se activa en un paso posterior (ver notas al final).
-- Requiere Fases 1-3.
-- ============================================================

-- ── NEUMÁTICOS ───────────────────────────────────────────────
create table if not exists tc_neumaticos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references tc_empresas(id) on delete restrict,
  codigo_interno    text,
  numero_serie      text,
  dot               text,                     -- 4 dígitos, p.ej. 1425
  marca             text,
  modelo            text,
  medida            text,
  indice_carga      text,
  indice_velocidad  text,
  rfid_epc          text,
  estado            text not null default 'almacen'
                    check (estado in ('almacen','reservado','montado','reparacion','descartado')),
  fecha_compra      date,
  coste_compra      numeric,
  proveedor         text,
  -- ── Enlace con el módulo de almacén (fuente de verdad del stock) ──
  almacen_producto_id   uuid,
  almacen_lote_id       uuid,
  almacen_ubicacion_id  uuid,
  almacen_movimiento_id uuid,
  referencia_almacen    text,
  sincronizado_almacen  boolean not null default false,
  activo            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- número de serie único por empresa (si existe)
create unique index if not exists uq_tc_neu_serie on tc_neumaticos (empresa_id, numero_serie) where numero_serie is not null;
-- RFID único global (si existe)
create unique index if not exists uq_tc_neu_rfid on tc_neumaticos (rfid_epc) where rfid_epc is not null;
create index if not exists idx_tc_neu_empresa on tc_neumaticos (empresa_id);
create index if not exists idx_tc_neu_estado on tc_neumaticos (estado);

-- ── MONTAJES ACTUALES (solo montajes vigentes) ───────────────
create table if not exists tc_montajes_actuales (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id    uuid not null references tc_vehiculos(id) on delete cascade,
  neumatico_id   uuid not null references tc_neumaticos(id) on delete restrict,
  posicion_id    uuid not null references tc_posiciones_vehiculo(id) on delete restrict,
  fecha_montaje  date not null default current_date,
  km_montaje     numeric,
  tecnico_id     uuid,
  observaciones  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- un neumático solo puede estar montado una vez
  unique (neumatico_id),
  -- una posición de un vehículo solo puede tener un neumático activo
  unique (vehiculo_id, posicion_id)
);
create index if not exists idx_tc_mont_empresa on tc_montajes_actuales (empresa_id);
create index if not exists idx_tc_mont_vehiculo on tc_montajes_actuales (vehiculo_id);

-- ── HISTORIAL DE MONTAJES ────────────────────────────────────
create table if not exists tc_historial_montajes (
  id                     uuid primary key default gen_random_uuid(),
  empresa_id             uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id            uuid references tc_vehiculos(id) on delete set null,
  neumatico_id           uuid references tc_neumaticos(id) on delete set null,
  posicion_id            uuid references tc_posiciones_vehiculo(id) on delete set null,
  fecha_montaje          date,
  km_montaje             numeric,
  fecha_desmontaje       date,
  km_desmontaje          numeric,
  motivo_desmontaje      text,
  tecnico_montaje_id     uuid,
  tecnico_desmontaje_id  uuid,
  observaciones          text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_tc_hist_empresa on tc_historial_montajes (empresa_id);
create index if not exists idx_tc_hist_neumatico on tc_historial_montajes (neumatico_id);

-- ── RLS ──────────────────────────────────────────────────────
alter table tc_neumaticos          enable row level security;
alter table tc_montajes_actuales   enable row level security;
alter table tc_historial_montajes  enable row level security;

drop policy if exists tc_neu_select on tc_neumaticos;
create policy tc_neu_select on tc_neumaticos for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_neu_write on tc_neumaticos;
create policy tc_neu_write on tc_neumaticos for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

drop policy if exists tc_mont_select on tc_montajes_actuales;
create policy tc_mont_select on tc_montajes_actuales for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_mont_write on tc_montajes_actuales;
create policy tc_mont_write on tc_montajes_actuales for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

drop policy if exists tc_hist_select on tc_historial_montajes;
create policy tc_hist_select on tc_historial_montajes for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_hist_write on tc_historial_montajes;
create policy tc_hist_write on tc_historial_montajes for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) );

-- ── RPC: montar neumático (atómico) ──────────────────────────
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

  -- permisos
  if not (tc_is_superadmin() or (tc_is_admin() and v_empresa = tc_auth_empresa_id())) then
    raise exception 'Sin permiso para montar en esta empresa';
  end if;
  -- misma empresa
  if v_neu.empresa_id <> v_empresa then raise exception 'El neumático y el vehículo son de empresas distintas'; end if;
  -- estados válidos
  if v_neu.estado = 'descartado' then raise exception 'No se puede montar un neumático descartado'; end if;
  if v_neu.estado = 'montado' then raise exception 'El neumático ya está montado'; end if;
  -- posición pertenece al tipo del vehículo
  if v_veh.tipo_vehiculo_id is null or not exists (
     select 1 from tc_posiciones_vehiculo where id = p_posicion and tipo_vehiculo_id = v_veh.tipo_vehiculo_id) then
     raise exception 'La posición no corresponde al tipo del vehículo';
  end if;

  insert into tc_montajes_actuales (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje, tecnico_id, observaciones)
  values (v_empresa, p_vehiculo, p_neumatico, p_posicion, coalesce(p_fecha, current_date), p_km, auth.uid(), p_obs)
  returning id into v_id;

  update tc_neumaticos set estado = 'montado', updated_at = now() where id = p_neumatico;
  -- NOTA: aquí iría el movimiento de almacén (salida_montaje) cuando se active la integración.
  return v_id;
end $$;

-- ── RPC: desmontar neumático (atómico) ───────────────────────
create or replace function tc_desmontar_neumatico(
  p_montaje uuid, p_km numeric default null, p_motivo text default null,
  p_nuevo_estado text default 'almacen', p_obs text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from tc_montajes_actuales where id = p_montaje;
  if not found then raise exception 'Montaje no encontrado'; end if;
  if not (tc_is_superadmin() or (tc_is_admin() and m.empresa_id = tc_auth_empresa_id())) then
    raise exception 'Sin permiso';
  end if;
  if p_nuevo_estado not in ('almacen','reparacion','descartado') then
    raise exception 'Estado destino no válido';
  end if;

  insert into tc_historial_montajes (empresa_id, vehiculo_id, neumatico_id, posicion_id, fecha_montaje, km_montaje,
    fecha_desmontaje, km_desmontaje, motivo_desmontaje, tecnico_montaje_id, tecnico_desmontaje_id, observaciones)
  values (m.empresa_id, m.vehiculo_id, m.neumatico_id, m.posicion_id, m.fecha_montaje, m.km_montaje,
    current_date, p_km, p_motivo, m.tecnico_id, auth.uid(), coalesce(p_obs, m.observaciones));

  update tc_neumaticos set estado = p_nuevo_estado, updated_at = now() where id = m.neumatico_id;
  delete from tc_montajes_actuales where id = p_montaje;
  -- NOTA: aquí iría el movimiento de almacén (entrada_devolucion / envio_reparacion / baja_descarte).
end $$;

-- ============================================================
-- INTEGRACIÓN CON ALMACÉN (pendiente de activar):
-- El almacén real gestiona stock por MOVIMIENTOS (movimientos_stock:
--   empresa_id, cliente_id, producto_id, vehiculo_id, tipo ENTRADA/SALIDA,
--   cantidad, ubicacion, origen_movimiento, ...). No hay 'estado_stock'.
-- Para sincronizar hay que definir el mapeo tc_empresas -> clientes y el
-- producto de almacén del neumático. Cuando se confirme, se añade dentro
-- de las RPC un insert en movimientos_stock (origen_movimiento='montaje' /
-- 'entrada_devolucion' ...) y se marca tc_neumaticos.sincronizado_almacen.
-- ============================================================
