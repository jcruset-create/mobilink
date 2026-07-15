-- ============================================================
-- SEA TyreControl — Fase 34: incidencias de neumático (Fase 1)
--
-- Gestión de incidencias detectadas en la revisión. Ver el brief en
-- docs/PROMPT_incidencias_tyrecontrol.md. Esta migración cubre la Fase 1:
-- detección + pendientes. No incluye el flujo de "solucionar" (Fase 2),
-- pero deja preparado operaciones_neumaticos.incidencia_id.
--
-- Una incidencia = una posición de neumático de una revisión con uno o
-- más problemas detectados. El estado de la incidencia es INDEPENDIENTE
-- del estado de la revisión (la revisión se cierra; la incidencia sigue).
-- ============================================================

-- ── Estados nuevos de la revisión ────────────────────────────
-- Una revisión con incidencia NO debe constar como "completada" a secas.
alter table revisiones_vehiculo drop constraint if exists revisiones_vehiculo_estado_revision_check;
alter table revisiones_vehiculo add constraint revisiones_vehiculo_estado_revision_check
  check (estado_revision = any (array[
    'borrador','completada','enviada','anulada',
    'completada_con_incidencias','completada_incidencia_pendiente'
  ]));

-- ── tc_incidencias ───────────────────────────────────────────
create table if not exists tc_incidencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references tc_empresas(id),
  vehiculo_id uuid not null references tc_vehiculos(id),
  posicion_id uuid references tc_posiciones_vehiculo(id),
  neumatico_id uuid references tc_neumaticos(id),
  revision_id uuid references revisiones_vehiculo(id),
  revision_detalle_id uuid references revisiones_neumaticos_detalle(id),

  gravedad text not null default 'leve'
    check (gravedad = any (array['leve','importante','critica'])),
  gravedad_auto text
    check (gravedad_auto is null or gravedad_auto = any (array['leve','importante','critica'])),

  estado text not null default 'detectada'
    check (estado = any (array[
      'detectada','pendiente_autorizacion','autorizada','planificada',
      'pendiente_material','pendiente_vehiculo','en_curso',
      'solucionada','cancelada','no_procede'
    ])),

  detectada_por uuid,
  detectada_at timestamptz not null default now(),
  fecha_recomendada date,
  autoriza_persona text,

  -- Motivo por el que se deja pendiente (enum de motivos rápidos).
  motivo_pendiente text
    check (motivo_pendiente is null or motivo_pendiente = any (array[
      'falta_autorizacion','falta_neumatico','falta_material','no_hay_tiempo',
      'vehiculo_debe_salir','requiere_taller','pendiente_presupuesto',
      'pendiente_unidad_movil','no_accesible','otro'
    ])),
  motivo_observacion text,
  accion_recomendada text,

  medicion_inicial jsonb,   -- {profundidad_mm, presion_bar, estado_visual}
  medicion_final jsonb,     -- se rellena al solucionar (Fase 2)
  foto_url text,

  resuelta_at timestamptz,
  resuelta_por uuid,
  tiempo_intervencion_seg integer,
  seguimiento_revision_id uuid,  -- plan de seguimiento (Fase 3)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tc_incidencias_vehiculo on tc_incidencias (vehiculo_id);
create index if not exists idx_tc_incidencias_estado on tc_incidencias (estado);
create index if not exists idx_tc_incidencias_gravedad on tc_incidencias (gravedad);
create index if not exists idx_tc_incidencias_empresa on tc_incidencias (empresa_id);

-- ── tc_incidencia_problemas ──────────────────────────────────
-- Cada incidencia puede tener varios problemas (multi-selección); cada uno
-- se puede resolver por separado (solución parcial, Fase 2).
create table if not exists tc_incidencia_problemas (
  id uuid primary key default gen_random_uuid(),
  incidencia_id uuid not null references tc_incidencias(id) on delete cascade,
  tipo text not null
    check (tipo = any (array[
      'profundidad_baja','presion_baja','presion_alta','pinchazo','objeto_clavado',
      'desgaste_irregular','desgaste_interior','desgaste_exterior','diferencia_gemelos',
      'corte_grieta','dano_flanco','deformacion','valvula_danada','no_coincide_ficha',
      'cambiado_posicion','no_identificado','necesita_sustitucion','necesita_reparacion',
      'necesita_equilibrado','necesita_alineacion','otra'
    ])),
  estado text not null default 'abierto'
    check (estado = any (array['abierto','solucionado'])),
  operacion_id uuid references operaciones_neumaticos(id),  -- la que lo resolvió (Fase 2)
  resuelto_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_tc_incidencia_problemas_incidencia on tc_incidencia_problemas (incidencia_id);

-- ── Enlace operación → incidencia (se usa en Fase 2) ─────────
alter table operaciones_neumaticos add column if not exists incidencia_id uuid references tc_incidencias(id);
create index if not exists idx_operaciones_neumaticos_incidencia on operaciones_neumaticos (incidencia_id);

-- ── updated_at automático ────────────────────────────────────
create or replace function tc_incidencias_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists trg_tc_incidencias_touch on tc_incidencias;
create trigger trg_tc_incidencias_touch before update on tc_incidencias
  for each row execute function tc_incidencias_touch();

-- ── RLS (mismo patrón que revisiones: operario ve/escribe sus empresas) ──
alter table tc_incidencias enable row level security;
alter table tc_incidencia_problemas enable row level security;

drop policy if exists tc_incidencias_select on tc_incidencias;
create policy tc_incidencias_select on tc_incidencias for select
  using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists tc_incidencias_write on tc_incidencias;
create policy tc_incidencias_write on tc_incidencias for all
  using ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or (tc_is_admin() and empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(empresa_id) );

-- Los problemas heredan el permiso de su incidencia.
drop policy if exists tc_incidencia_problemas_select on tc_incidencia_problemas;
create policy tc_incidencia_problemas_select on tc_incidencia_problemas for select
  using ( exists (select 1 from tc_incidencias i where i.id = incidencia_id and tc_puede_ver_empresa(i.empresa_id)) );
drop policy if exists tc_incidencia_problemas_write on tc_incidencia_problemas;
create policy tc_incidencia_problemas_write on tc_incidencia_problemas for all
  using ( exists (select 1 from tc_incidencias i where i.id = incidencia_id and (tc_is_superadmin() or (tc_is_admin() and i.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(i.empresa_id))) )
  with check ( exists (select 1 from tc_incidencias i where i.id = incidencia_id and (tc_is_superadmin() or (tc_is_admin() and i.empresa_id = tc_auth_empresa_id()) or tc_operador_ve_empresa(i.empresa_id))) );
