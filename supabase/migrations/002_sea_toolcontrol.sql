-- ============================================================
-- SEA PLATFORM — SEA TOOLCONTROL
-- Migración 002: Herramientas, máquinas, movimientos, mantenimiento
-- ============================================================

-- -------------------------
-- CATEGORÍAS DE HERRAMIENTAS
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  icono       TEXT,
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- UBICACIONES
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  work_center_id  UUID REFERENCES sea_work_centers(id) ON DELETE SET NULL,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  codigo          TEXT,
  foto_url        TEXT,
  activa          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- HERRAMIENTAS
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_tools (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  category_id         UUID REFERENCES tc_categories(id) ON DELETE SET NULL,
  supplier_id         UUID REFERENCES sea_suppliers(id) ON DELETE SET NULL,
  responsable_id      UUID REFERENCES sea_employees(id) ON DELETE SET NULL,
  ubicacion_habitual_id UUID REFERENCES tc_locations(id) ON DELETE SET NULL,
  ubicacion_actual_id   UUID REFERENCES tc_locations(id) ON DELETE SET NULL,

  -- Identificación
  codigo              TEXT NOT NULL,
  numero_asignado     TEXT,
  nombre              TEXT NOT NULL,
  descripcion         TEXT,
  marca               TEXT,
  modelo              TEXT,
  numero_serie        TEXT UNIQUE,

  -- QR
  qr_code             TEXT UNIQUE,

  -- Estado
  estado              TEXT NOT NULL DEFAULT 'disponible',
  -- 'disponible', 'en_uso', 'compartida', 'pendiente_devolucion',
  -- 'danada', 'mantenimiento', 'perdida', 'fuera_servicio',
  -- 'pendiente_revision', 'desactualizada'

  -- Fotografías
  foto_url            TEXT,
  foto_ubicacion_url  TEXT,

  -- Económico
  fecha_compra        DATE,
  coste               NUMERIC(10,2),

  -- Mantenimiento
  frecuencia_revision_dias INTEGER,
  ultima_revision     DATE,
  proxima_revision    DATE,
  ultima_actualizacion DATE,
  proxima_actualizacion DATE,

  -- Control
  activa              BOOLEAN NOT NULL DEFAULT true,
  es_compartida       BOOLEAN NOT NULL DEFAULT false,
  observaciones       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- MÁQUINAS
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_machines (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  category_id         UUID REFERENCES tc_categories(id) ON DELETE SET NULL,
  supplier_id         UUID REFERENCES sea_suppliers(id) ON DELETE SET NULL,
  responsable_id      UUID REFERENCES sea_employees(id) ON DELETE SET NULL,
  ubicacion_id        UUID REFERENCES tc_locations(id) ON DELETE SET NULL,

  codigo              TEXT NOT NULL,
  nombre              TEXT NOT NULL,
  descripcion         TEXT,
  marca               TEXT,
  modelo              TEXT,
  numero_serie        TEXT,
  qr_code             TEXT UNIQUE,
  foto_url            TEXT,

  estado              TEXT NOT NULL DEFAULT 'disponible',
  fecha_compra        DATE,
  coste               NUMERIC(10,2),

  -- Restricción de uso (requiere autorización)
  requiere_autorizacion_id UUID REFERENCES sea_authorizations(id) ON DELETE SET NULL,

  activa              BOOLEAN NOT NULL DEFAULT true,
  observaciones       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- MOVIMIENTOS DE HERRAMIENTAS
-- (uso individual — 1 operario)
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_tool_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id         UUID NOT NULL REFERENCES tc_tools(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  company_id      UUID REFERENCES sea_companies(id) ON DELETE SET NULL,

  tipo            TEXT NOT NULL,  -- 'salida', 'devolucion'
  orden_trabajo   TEXT,

  ubicacion_desde_id UUID REFERENCES tc_locations(id) ON DELETE SET NULL,
  ubicacion_hasta_id UUID REFERENCES tc_locations(id) ON DELETE SET NULL,

  fecha_salida    TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_devolucion TIMESTAMPTZ,
  fecha_devolucion_prevista TIMESTAMPTZ,

  estado_inicial  TEXT,
  estado_final    TEXT,
  incidencia      BOOLEAN NOT NULL DEFAULT false,

  pin_confirmacion TEXT,  -- hash del PIN usado para confirmar
  observaciones   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- USO COMPARTIDO (varios operarios simultáneos)
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_tool_shared_usage (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_id     UUID NOT NULL REFERENCES tc_tools(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  hora_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
  hora_fin    TIMESTAMPTZ,
  activo      BOOLEAN NOT NULL DEFAULT true,
  observaciones TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tool_id, employee_id, hora_inicio)
);

-- -------------------------
-- INVENTARIOS
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_inventory_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  work_center_id  UUID REFERENCES sea_work_centers(id) ON DELETE SET NULL,
  responsable_id  UUID REFERENCES sea_employees(id) ON DELETE SET NULL,
  tipo            TEXT NOT NULL DEFAULT 'semanal',  -- 'diario', 'semanal', 'mensual', 'manual'
  estado          TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente', 'en_curso', 'completado'
  fecha_inicio    TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_fin       TIMESTAMPTZ,
  observaciones   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tc_inventory_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id    UUID NOT NULL REFERENCES tc_inventory_checks(id) ON DELETE CASCADE,
  tool_id         UUID REFERENCES tc_tools(id) ON DELETE SET NULL,
  machine_id      UUID REFERENCES tc_machines(id) ON DELETE SET NULL,
  estado_verificado TEXT NOT NULL,  -- 'localizada', 'no_localizada', 'danada', 'en_uso', 'en_reparacion'
  ubicacion_encontrada_id UUID REFERENCES tc_locations(id) ON DELETE SET NULL,
  verificado_por  UUID REFERENCES sea_employees(id) ON DELETE SET NULL,
  observaciones   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- PLANES DE MANTENIMIENTO
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_maintenance_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  tool_id         UUID REFERENCES tc_tools(id) ON DELETE CASCADE,
  machine_id      UUID REFERENCES tc_machines(id) ON DELETE CASCADE,
  nombre          TEXT NOT NULL,
  frecuencia      TEXT NOT NULL,  -- 'diario', 'semanal', 'mensual', 'anual', 'personalizado'
  frecuencia_dias INTEGER,        -- si personalizado
  descripcion     TEXT,
  checklist       JSONB,          -- array de items a verificar
  responsable_id  UUID REFERENCES sea_employees(id) ON DELETE SET NULL,
  activo          BOOLEAN NOT NULL DEFAULT true,
  proxima_revision DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- REGISTROS DE MANTENIMIENTO
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_maintenance_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id         UUID REFERENCES tc_maintenance_plans(id) ON DELETE SET NULL,
  tool_id         UUID REFERENCES tc_tools(id) ON DELETE SET NULL,
  machine_id      UUID REFERENCES tc_machines(id) ON DELETE SET NULL,
  realizado_por   UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL,  -- 'preventivo', 'correctivo', 'revision'
  fecha           TIMESTAMPTZ NOT NULL DEFAULT now(),
  checklist_resultado JSONB,
  descripcion     TEXT,
  coste           NUMERIC(10,2),
  proveedor_id    UUID REFERENCES sea_suppliers(id) ON DELETE SET NULL,
  proxima_revision DATE,
  estado          TEXT NOT NULL DEFAULT 'completado',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- INCIDENCIAS
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_incidents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  tool_id         UUID REFERENCES tc_tools(id) ON DELETE SET NULL,
  machine_id      UUID REFERENCES tc_machines(id) ON DELETE SET NULL,
  reportado_por   UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  asignado_a      UUID REFERENCES sea_employees(id) ON DELETE SET NULL,

  titulo          TEXT NOT NULL,
  descripcion     TEXT,
  tipo            TEXT NOT NULL DEFAULT 'averia',  -- 'averia', 'perdida', 'danio', 'fuera_sitio', 'otro'
  estado          TEXT NOT NULL DEFAULT 'abierta',
  -- 'abierta', 'avisada', 'justificada', 'revisada', 'cerrada', 'reincidente'

  foto_url        TEXT,
  fecha_incidencia TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_cierre    TIMESTAMPTZ,
  resolucion      TEXT,
  coste_reparacion NUMERIC(10,2),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- CIERRE DE JORNADA (log)
-- -------------------------
CREATE TABLE IF NOT EXISTS tc_end_of_day_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  herramientas_fuera INTEGER NOT NULL DEFAULT 0,
  herramientas_justificadas INTEGER NOT NULL DEFAULT 0,
  incidencias_creadas INTEGER NOT NULL DEFAULT 0,
  whatsapp_enviados INTEGER NOT NULL DEFAULT 0,
  detalle         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- ÍNDICES
-- -------------------------
CREATE INDEX IF NOT EXISTS idx_tc_tools_company    ON tc_tools(company_id);
CREATE INDEX IF NOT EXISTS idx_tc_tools_estado     ON tc_tools(estado);
CREATE INDEX IF NOT EXISTS idx_tc_tools_qr         ON tc_tools(qr_code);
CREATE INDEX IF NOT EXISTS idx_tc_machines_company ON tc_machines(company_id);
CREATE INDEX IF NOT EXISTS idx_tc_movements_tool   ON tc_tool_movements(tool_id);
CREATE INDEX IF NOT EXISTS idx_tc_movements_emp    ON tc_tool_movements(employee_id);
CREATE INDEX IF NOT EXISTS idx_tc_incidents_tool   ON tc_incidents(tool_id);
CREATE INDEX IF NOT EXISTS idx_tc_incidents_estado ON tc_incidents(estado);
CREATE INDEX IF NOT EXISTS idx_tc_maint_logs_tool  ON tc_maintenance_logs(tool_id);

-- -------------------------
-- TRIGGERS updated_at
-- -------------------------
CREATE OR REPLACE TRIGGER trg_tc_tools_updated_at
  BEFORE UPDATE ON tc_tools
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

CREATE OR REPLACE TRIGGER trg_tc_machines_updated_at
  BEFORE UPDATE ON tc_machines
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

CREATE OR REPLACE TRIGGER trg_tc_incidents_updated_at
  BEFORE UPDATE ON tc_incidents
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

-- -------------------------
-- RLS
-- -------------------------
ALTER TABLE tc_categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_locations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_tools                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_machines             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_tool_movements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_tool_shared_usage    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_inventory_checks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_inventory_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_maintenance_plans    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_maintenance_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_incidents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tc_end_of_day_logs      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tc_auth_all" ON tc_categories        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_locations         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_tools             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_machines          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_tool_movements    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_tool_shared_usage FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_inventory_checks  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_inventory_items   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_maintenance_plans FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_maintenance_logs  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_incidents         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "tc_auth_all" ON tc_end_of_day_logs   FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon: lectura de herramientas por QR (para scan sin login)
CREATE POLICY "tc_anon_tools_qr" ON tc_tools FOR SELECT TO anon USING (activa = true);
CREATE POLICY "tc_anon_machines_qr" ON tc_machines FOR SELECT TO anon USING (activa = true);
CREATE POLICY "tc_anon_locations" ON tc_locations FOR SELECT TO anon USING (activa = true);
