-- ============================================================
-- SEA TyreControl — Módulo "Operaciones de neumáticos" (Fase 1).
-- Modelo de datos: EXTIENDE el motor existente (operaciones_neumaticos),
-- no lo duplica. Añade ciclo de vida, movimientos, adjuntos, auditoría,
-- reservas, catálogos configurables y estados de neumático ampliados.
-- Reutiliza tc_empresas, tc_delegaciones, tc_vehiculos, tc_usuarios,
-- tc_neumaticos, tc_posiciones_vehiculo, tc_montajes_actuales, tc_incidencias.
-- No borra nada. Todas las columnas nuevas con IF NOT EXISTS.
-- ============================================================

-- ── 1. Ciclo de vida en operaciones_neumaticos (el motor) ───────────────────
create sequence if not exists tc_operaciones_numero_seq;

alter table operaciones_neumaticos add column if not exists numero_operacion    bigint;
alter table operaciones_neumaticos add column if not exists status              text not null default 'completada';
alter table operaciones_neumaticos add column if not exists prioridad           text not null default 'normal';
alter table operaciones_neumaticos add column if not exists fecha_prevista      date;
alter table operaciones_neumaticos add column if not exists started_at          timestamptz;
alter table operaciones_neumaticos add column if not exists completed_at        timestamptz;
alter table operaciones_neumaticos add column if not exists cancelled_at        timestamptz;
alter table operaciones_neumaticos add column if not exists source              text not null default 'desktop_web';
alter table operaciones_neumaticos add column if not exists is_correccion       boolean not null default false;
alter table operaciones_neumaticos add column if not exists is_anulada          boolean not null default false;
alter table operaciones_neumaticos add column if not exists operacion_anulada_id uuid references operaciones_neumaticos(id) on delete set null;
alter table operaciones_neumaticos add column if not exists delegacion_id       uuid references tc_delegaciones(id) on delete set null;
alter table operaciones_neumaticos add column if not exists incidencia_id       uuid;
alter table operaciones_neumaticos add column if not exists proveedor           text;
alter table operaciones_neumaticos add column if not exists coste               numeric;
alter table operaciones_neumaticos add column if not exists created_by          uuid default auth.uid();
alter table operaciones_neumaticos add column if not exists assigned_by         uuid references tc_usuarios(id) on delete set null;

-- Numeración legible para las filas existentes y futuras.
update operaciones_neumaticos set numero_operacion = nextval('tc_operaciones_numero_seq') where numero_operacion is null;
alter table operaciones_neumaticos alter column numero_operacion set default nextval('tc_operaciones_numero_seq');

-- Ampliar tipos de operación (intercambio + correcciones). Se relajan los CHECK
-- de tipo/motivo/destino: los valores válidos pasan a los catálogos configurables.
alter table operaciones_neumaticos drop constraint if exists operaciones_neumaticos_tipo_operacion_check;
alter table operaciones_neumaticos drop constraint if exists operaciones_neumaticos_motivo_check;
alter table operaciones_neumaticos drop constraint if exists operaciones_neumaticos_destino_check;

-- Estados/prioridad/source sí se validan por CHECK (estructurales).
alter table operaciones_neumaticos drop constraint if exists ck_op_status;
alter table operaciones_neumaticos add constraint ck_op_status check (status in
  ('borrador','pendiente','planificada','asignada','en_proceso','pausada','completada','cancelada','no_realizada','anulada'));
alter table operaciones_neumaticos drop constraint if exists ck_op_prioridad;
alter table operaciones_neumaticos add constraint ck_op_prioridad check (prioridad in ('baja','normal','alta','urgente'));
alter table operaciones_neumaticos drop constraint if exists ck_op_source;
alter table operaciones_neumaticos add constraint ck_op_source check (source in ('desktop_web','mobile_app','import','api','system'));

create index if not exists idx_op_status on operaciones_neumaticos (status);
create index if not exists idx_op_empresa on operaciones_neumaticos (empresa_id);
create index if not exists idx_op_vehiculo on operaciones_neumaticos (vehiculo_id);
create index if not exists idx_op_numero on operaciones_neumaticos (numero_operacion);

-- ── 2. Estados de neumático ampliados (sin romper los existentes) ───────────
alter table tc_neumaticos drop constraint if exists tc_neumaticos_estado_check;
alter table tc_neumaticos add constraint tc_neumaticos_estado_check check (estado in (
  -- existentes (compatibilidad)
  'almacen','reservado','montado','reparacion','descartado',
  -- nuevos
  'stock_nuevo','stock_usado','stock_recauchutado','pendiente_desmontaje',
  'pendiente_reparacion','en_reparacion','pendiente_recauchutado','en_recauchutado',
  'cuarentena','pendiente_clasificacion','pendiente_validar','no_localizado','vendido','extraviado'
));

-- ── 3. Movimientos (operaciones multi-movimiento: sustitución/intercambio) ──
create table if not exists tc_operacion_movimientos (
  id                    uuid primary key default gen_random_uuid(),
  operacion_id          uuid not null references operaciones_neumaticos(id) on delete cascade,
  neumatico_id          uuid references tc_neumaticos(id) on delete set null,
  movimiento_tipo       text not null,   -- montaje | desmontaje | cambio_posicion | reparacion | correccion
  origen_vehiculo_id    uuid references tc_vehiculos(id) on delete set null,
  origen_posicion_id    uuid references tc_posiciones_vehiculo(id) on delete set null,
  destino_vehiculo_id   uuid references tc_vehiculos(id) on delete set null,
  destino_posicion_id   uuid references tc_posiciones_vehiculo(id) on delete set null,
  origen_ubicacion      text,
  destino_ubicacion     text,
  estado_anterior       text,
  estado_nuevo          text,
  profundidad_anterior  numeric,
  profundidad_final     numeric,
  orden                 int not null default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_op_mov_operacion on tc_operacion_movimientos (operacion_id);
create index if not exists idx_op_mov_neumatico on tc_operacion_movimientos (neumatico_id);

-- ── 4. Adjuntos (fotos/documentos) ──────────────────────────────────────────
create table if not exists tc_operacion_adjuntos (
  id            uuid primary key default gen_random_uuid(),
  operacion_id  uuid not null references operaciones_neumaticos(id) on delete cascade,
  file_url      text not null,
  storage_path  text,
  file_type     text,               -- antes | despues | documento | otro
  descripcion   text,
  subido_por    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_op_adj_operacion on tc_operacion_adjuntos (operacion_id);

-- ── 5. Historial de estados de la operación ─────────────────────────────────
create table if not exists tc_operacion_estado_historial (
  id              uuid primary key default gen_random_uuid(),
  operacion_id    uuid not null references operaciones_neumaticos(id) on delete cascade,
  estado_anterior text,
  estado_nuevo    text not null,
  cambiado_por    uuid default auth.uid(),
  motivo          text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_op_est_operacion on tc_operacion_estado_historial (operacion_id);

-- ── 6. Reservas de neumático ────────────────────────────────────────────────
create table if not exists tc_reservas_neumatico (
  id              uuid primary key default gen_random_uuid(),
  neumatico_id    uuid not null references tc_neumaticos(id) on delete cascade,
  operacion_id    uuid references operaciones_neumaticos(id) on delete set null,
  vehiculo_id     uuid references tc_vehiculos(id) on delete set null,
  posicion_id     uuid references tc_posiciones_vehiculo(id) on delete set null,
  empresa_id      uuid not null references tc_empresas(id) on delete cascade,
  delegacion_id   uuid references tc_delegaciones(id) on delete set null,
  reservado_por   uuid default auth.uid(),
  reservado_at    timestamptz not null default now(),
  fecha_prevista  date,
  status          text not null default 'activa' check (status in ('activa','liberada','consumida')),
  liberado_at     timestamptz,
  liberado_por    uuid,
  motivo_liberacion text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists uq_reserva_neumatico_activa on tc_reservas_neumatico (neumatico_id) where status = 'activa';
create index if not exists idx_reserva_empresa on tc_reservas_neumatico (empresa_id);

-- ── 7. Auditoría de operaciones ─────────────────────────────────────────────
create table if not exists tc_operacion_auditoria (
  id             uuid primary key default gen_random_uuid(),
  operacion_id   uuid references operaciones_neumaticos(id) on delete set null,
  accion         text not null,      -- crear | actualizar | ejecutar | anular | corregir …
  datos_anteriores jsonb,
  datos_nuevos   jsonb,
  realizado_por  uuid default auth.uid(),
  motivo         text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_op_audit_operacion on tc_operacion_auditoria (operacion_id);

-- ── 8. Catálogos configurables ──────────────────────────────────────────────
create table if not exists tc_cat_tipos_operacion (
  codigo      text primary key,
  nombre      text not null,
  orden       int not null default 100,
  es_fisica   boolean not null default true,   -- false = corrección de información
  activo      boolean not null default true
);
create table if not exists tc_cat_motivos (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null,
  nombre         text not null,
  tipo_operacion text,                          -- null = común a todos
  orden          int not null default 100,
  activo         boolean not null default true,
  unique (codigo, tipo_operacion)
);
create table if not exists tc_cat_destinos (
  codigo            text primary key,
  nombre            text not null,
  estado_resultante text,                       -- estado del neumático al aplicar el destino
  orden             int not null default 100,
  activo            boolean not null default true
);
create table if not exists tc_cat_tipos_reparacion (
  codigo text primary key, nombre text not null, orden int not null default 100, activo boolean not null default true
);
create table if not exists tc_cat_resultados_reparacion (
  codigo text primary key, nombre text not null, orden int not null default 100, activo boolean not null default true
);

-- Seeds (idempotentes)
insert into tc_cat_tipos_operacion (codigo, nombre, orden, es_fisica) values
  ('sustitucion','Sustitución',10,true),('montaje','Montaje',20,true),('desmontaje','Desmontaje',30,true),
  ('cambio_posicion','Cambio de posición',40,true),('intercambio','Intercambio',50,true),
  ('reparacion','Reparación',60,true),('retirada_stock','Retirada a stock',70,true),
  ('retirada_definitiva','Retirada definitiva',80,true),
  ('correccion_posicion','Corrección de posición',90,false),('correccion_montado','Corrección de neumático montado',100,false)
on conflict (codigo) do nothing;

insert into tc_cat_motivos (codigo, nombre, tipo_operacion, orden) values
  ('desgaste','Desgaste',null,10),('profundidad_minima','Profundidad mínima',null,20),('pinchazo','Pinchazo',null,30),
  ('dano_lateral','Daño lateral',null,40),('reventon','Reventón',null,50),('desgaste_irregular','Desgaste irregular',null,60),
  ('preventivo','Cambio preventivo',null,70),('medida_incorrecta','Medida incorrecta',null,80),
  ('no_compatible','Neumático no compatible',null,90),
  ('error_inventario','Error de inventario','correccion_posicion',10),('cambio_no_registrado','Cambio anterior no registrado','correccion_posicion',20),
  ('detectado_revision','Detectado durante revisión','correccion_posicion',30),('importacion_incorrecta','Importación incorrecta','correccion_posicion',40),
  ('error_administrativo','Error administrativo','correccion_posicion',50),
  ('otro','Otro',null,999)
on conflict (codigo, tipo_operacion) do nothing;

insert into tc_cat_destinos (codigo, nombre, estado_resultante, orden) values
  ('stock_usado','Stock usado','stock_usado',10),('pendiente_reparacion','Pendiente de reparación','pendiente_reparacion',20),
  ('en_reparacion','En reparación','en_reparacion',30),('pendiente_recauchutado','Pendiente de recauchutado','pendiente_recauchutado',40),
  ('en_recauchutado','En recauchutado','en_recauchutado',50),('cuarentena','Cuarentena','cuarentena',60),
  ('desechado','Desechado','descartado',70),('pendiente_clasificacion','Pendiente de clasificación','pendiente_clasificacion',80)
on conflict (codigo) do nothing;

insert into tc_cat_tipos_reparacion (codigo, nombre, orden) values
  ('pinchazo','Reparación de pinchazo',10),('valvula','Sustitución de válvula',20),('presion','Ajuste de presión',30),
  ('equilibrado','Equilibrado',40),('llanta','Reparación de llanta',50),('interior','Reparación interior',60),
  ('objeto','Eliminación de objeto clavado',70),('otra','Otra reparación',999)
on conflict (codigo) do nothing;

insert into tc_cat_resultados_reparacion (codigo, nombre, orden) values
  ('reparado','Reparado y operativo',10),('provisional','Reparación provisional',20),('seguimiento','Pendiente de seguimiento',30),
  ('no_reparable','No reparable',40),('proveedor','Enviado a proveedor',50),('sustituido','Sustituido',60)
on conflict (codigo) do nothing;

-- ── 9. RLS ──────────────────────────────────────────────────────────────────
alter table tc_operacion_movimientos       enable row level security;
alter table tc_operacion_adjuntos          enable row level security;
alter table tc_operacion_estado_historial  enable row level security;
alter table tc_reservas_neumatico          enable row level security;
alter table tc_operacion_auditoria         enable row level security;
alter table tc_cat_tipos_operacion         enable row level security;
alter table tc_cat_motivos                 enable row level security;
alter table tc_cat_destinos                enable row level security;
alter table tc_cat_tipos_reparacion        enable row level security;
alter table tc_cat_resultados_reparacion   enable row level security;

-- Hijas de una operación: se ven si se puede ver la operación (misma empresa).
do $$
declare t text;
begin
  foreach t in array array['tc_operacion_movimientos','tc_operacion_adjuntos','tc_operacion_estado_historial','tc_operacion_auditoria'] loop
    execute format('drop policy if exists %I_sel on %I', t, t);
    execute format($f$create policy %I_sel on %I for select using (
       exists (select 1 from operaciones_neumaticos o where o.id = operacion_id and tc_puede_ver_empresa(o.empresa_id)))$f$, t, t);
    execute format('drop policy if exists %I_wr on %I', t, t);
    execute format($f$create policy %I_wr on %I for all
       using (tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(
         (select empresa_id from operaciones_neumaticos o where o.id = operacion_id)))
       with check (tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(
         (select empresa_id from operaciones_neumaticos o where o.id = operacion_id)))$f$, t, t);
  end loop;
end $$;

drop policy if exists reservas_sel on tc_reservas_neumatico;
create policy reservas_sel on tc_reservas_neumatico for select using ( tc_puede_ver_empresa(empresa_id) );
drop policy if exists reservas_wr on tc_reservas_neumatico;
create policy reservas_wr on tc_reservas_neumatico for all
  using ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) )
  with check ( tc_is_superadmin() or tc_is_admin() or tc_operador_ve_empresa(empresa_id) );

-- Catálogos: lectura para todos; escritura admin/superadmin.
do $$
declare t text;
begin
  foreach t in array array['tc_cat_tipos_operacion','tc_cat_motivos','tc_cat_destinos','tc_cat_tipos_reparacion','tc_cat_resultados_reparacion'] loop
    execute format('drop policy if exists %I_sel on %I', t, t);
    execute format('create policy %I_sel on %I for select using (true)', t, t);
    execute format('drop policy if exists %I_wr on %I', t, t);
    execute format('create policy %I_wr on %I for all using (tc_is_superadmin() or tc_is_admin()) with check (tc_is_superadmin() or tc_is_admin())', t, t);
  end loop;
end $$;
