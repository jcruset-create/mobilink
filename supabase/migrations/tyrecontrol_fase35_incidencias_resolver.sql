-- ============================================================
-- SEA TyreControl — Fase 35: resolver incidencias (Fase 2a)
--
-- Añade:
--  1) tc_presiones_objetivo: presión objetivo por tipo de vehículo + eje,
--     con override por vehículo (decisión (a) del usuario).
--  2) tc_incidencia_operaciones: registro de cada operación de resolución
--     (medición inicial/final, material, resultado, foto, tiempo…).
--  3) RPC tc_presion_objetivo(vehiculo, eje): resuelve el objetivo con
--     precedencia (vehículo+eje > vehículo > tipo+eje > tipo).
--  4) RPC tc_resolver_incidencia_parcial(...): en una transacción marca
--     problemas como solucionados, registra la operación y cascada el
--     estado de la incidencia y de la revisión (completada_con_incidencias).
--
-- No cambia la creación de incidencias ni la revisión rápida.
-- ============================================================

-- ── 1. Presión objetivo ──────────────────────────────────────
create table if not exists tc_presiones_objetivo (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references tc_empresas(id),      -- null = global
  tipo_vehiculo_id uuid references tc_tipos_vehiculo(id),
  vehiculo_id uuid references tc_vehiculos(id),     -- override por vehículo
  eje integer,                                      -- null = todos los ejes
  presion_objetivo_bar numeric not null,
  margen_bar numeric not null default 0.5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (tipo_vehiculo_id is not null or vehiculo_id is not null)
);
create index if not exists idx_tc_presiones_tipo on tc_presiones_objetivo (tipo_vehiculo_id, eje);
create index if not exists idx_tc_presiones_vehiculo on tc_presiones_objetivo (vehiculo_id, eje);

-- Resuelve la presión objetivo (bar) y su margen para una posición.
-- Precedencia (más específico gana): vehículo+eje, vehículo, tipo+eje, tipo.
create or replace function tc_presion_objetivo(p_vehiculo uuid, p_eje integer)
returns table(presion numeric, margen numeric)
language sql stable security definer set search_path = public as $$
  with v as (select tipo_vehiculo_id from tc_vehiculos where id = p_vehiculo)
  select po.presion_objetivo_bar, po.margen_bar
  from tc_presiones_objetivo po, v
  where (po.vehiculo_id = p_vehiculo or po.tipo_vehiculo_id = v.tipo_vehiculo_id)
    and (po.eje is null or po.eje = p_eje)
  -- coalesce evita que el NULL de la comparación (filas de tipo) gane el DESC
  order by coalesce(po.vehiculo_id = p_vehiculo, false) desc,  -- override de vehículo primero
           (po.eje is not null) desc                            -- eje concreto antes que "todos"
  limit 1;
$$;

-- ── 2. Operaciones de resolución ─────────────────────────────
create table if not exists tc_incidencia_operaciones (
  id uuid primary key default gen_random_uuid(),
  incidencia_id uuid not null references tc_incidencias(id) on delete cascade,
  empresa_id uuid not null references tc_empresas(id),
  tipo text not null
    check (tipo = any (array[
      'corregir_presion','reparar_pinchazo','cambiar_valvula','equilibrar',
      'solicitar_alineacion','reapretar','actualizar_neumatico',
      'sustituir_neumatico','cambiar_posicion','intercambiar','otra'
    ])),
  medicion_inicial jsonb,
  medicion_final jsonb,          -- {profundidad_mm, presion_bar}
  material text,
  resultado text,
  observaciones text,
  foto_url text,
  tecnico_id uuid,
  tiempo_seg integer,
  operacion_neumatico_id uuid references operaciones_neumaticos(id), -- sustitución (futuro)
  created_at timestamptz not null default now()
);
create index if not exists idx_tc_inc_oper_incidencia on tc_incidencia_operaciones (incidencia_id);

-- ── 3. RPC de resolución (transaccional) ─────────────────────
-- Marca los problemas indicados como solucionados, registra la operación y
-- cascada el estado de la incidencia y de la revisión. Devuelve el nuevo
-- estado de la incidencia.
create or replace function tc_resolver_incidencia_parcial(
  p_incidencia_id uuid,
  p_problema_ids uuid[],
  p_tipo text,
  p_medicion_final jsonb default null,
  p_material text default null,
  p_resultado text default null,
  p_observaciones text default null,
  p_foto_url text default null,
  p_tiempo_seg integer default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_inc tc_incidencias%rowtype;
  v_abiertos integer;
  v_uid uuid := auth.uid();
  v_rev_id uuid;
  v_rev_pend integer;
begin
  select * into v_inc from tc_incidencias where id = p_incidencia_id;
  if not found then raise exception 'Incidencia no encontrada'; end if;
  if not tc_puede_ver_empresa(v_inc.empresa_id) then
    raise exception 'Sin permiso sobre esta incidencia';
  end if;

  -- Registrar la operación de resolución.
  insert into tc_incidencia_operaciones (
    incidencia_id, empresa_id, tipo, medicion_inicial, medicion_final,
    material, resultado, observaciones, foto_url, tecnico_id, tiempo_seg
  ) values (
    p_incidencia_id, v_inc.empresa_id, p_tipo, v_inc.medicion_inicial, p_medicion_final,
    p_material, p_resultado, p_observaciones, p_foto_url, v_uid, p_tiempo_seg
  );

  -- Marcar los problemas indicados como solucionados.
  update tc_incidencia_problemas
     set estado = 'solucionado', resuelto_at = now()
   where incidencia_id = p_incidencia_id
     and id = any(p_problema_ids)
     and estado <> 'solucionado';

  -- ¿Quedan problemas abiertos en la incidencia?
  select count(*) into v_abiertos
    from tc_incidencia_problemas
   where incidencia_id = p_incidencia_id and estado <> 'solucionado';

  if v_abiertos = 0 then
    update tc_incidencias
       set estado = 'solucionada', resuelta_at = now(), resuelta_por = v_uid,
           medicion_final = coalesce(p_medicion_final, medicion_final)
     where id = p_incidencia_id;

    -- ¿Todas las incidencias de la revisión cerradas? → revisión con
    -- incidencias solucionadas (no queda "pendiente").
    v_rev_id := v_inc.revision_id;
    if v_rev_id is not null then
      select count(*) into v_rev_pend
        from tc_incidencias
       where revision_id = v_rev_id
         and estado not in ('solucionada','cancelada','no_procede');
      if v_rev_pend = 0 then
        update revisiones_vehiculo
           set estado_revision = 'completada_con_incidencias'
         where id = v_rev_id
           and estado_revision = 'completada_incidencia_pendiente';
      end if;
    end if;

    return 'solucionada';
  end if;

  return v_inc.estado; -- sigue abierta (resolución parcial)
end $$;

-- ── RLS ──────────────────────────────────────────────────────
alter table tc_presiones_objetivo enable row level security;
alter table tc_incidencia_operaciones enable row level security;

drop policy if exists tc_presiones_select on tc_presiones_objetivo;
create policy tc_presiones_select on tc_presiones_objetivo for select
  using ( empresa_id is null or tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_presiones_write on tc_presiones_objetivo;
create policy tc_presiones_write on tc_presiones_objetivo for all
  using ( tc_is_superadmin() or (empresa_id is not null and empresa_id = tc_auth_empresa_id()) )
  with check ( tc_is_superadmin() or (empresa_id is not null and empresa_id = tc_auth_empresa_id()) );

drop policy if exists tc_inc_oper_select on tc_incidencia_operaciones;
create policy tc_inc_oper_select on tc_incidencia_operaciones for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_inc_oper_write on tc_incidencia_operaciones;
create policy tc_inc_oper_write on tc_incidencia_operaciones for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id) );
