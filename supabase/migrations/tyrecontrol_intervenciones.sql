-- ============================================================
-- SEA TyreControl — Intervenciones (sesiones de cambio de neumático)
--
-- Una "intervención" agrupa las operaciones hechas en una sesión de cambio
-- (hasta pulsar Finalizar). Guarda un informe: resumen determinista +
-- redacción con IA. Cada operación puede enlazarse a su intervención.
-- ============================================================

create table if not exists tc_intervenciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references tc_empresas(id) on delete restrict,
  vehiculo_id   uuid references tc_vehiculos(id) on delete set null,
  fecha         date not null default current_date,
  tecnico_id    uuid references tc_usuarios(id),
  resumen       text,        -- resumen determinista (líneas)
  resumen_ia    text,        -- redacción con IA
  n_operaciones int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_interv_vehiculo on tc_intervenciones (vehiculo_id);
create index if not exists idx_interv_empresa on tc_intervenciones (empresa_id);

alter table operaciones_neumaticos add column if not exists intervencion_id uuid references tc_intervenciones(id) on delete set null;
create index if not exists idx_op_intervencion on operaciones_neumaticos (intervencion_id);

alter table tc_intervenciones enable row level security;
drop policy if exists interv_sel on tc_intervenciones;
create policy interv_sel on tc_intervenciones for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists interv_wr on tc_intervenciones;
create policy interv_wr on tc_intervenciones for all
  using ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );
