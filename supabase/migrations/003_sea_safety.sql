-- ============================================================
-- SEA PLATFORM — SEA SAFETY MANAGER
-- Migración 003: EPIs, documentación, formación, reuniones
-- ============================================================

-- -------------------------
-- CATEGORÍAS DE EPIs
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_epi_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  icono       TEXT,
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sm_epi_categories (nombre, descripcion) VALUES
  ('Protección cabeza',     'Cascos, gorros, etc.'),
  ('Protección ocular',     'Gafas, pantallas faciales'),
  ('Protección auditiva',   'Tapones, orejeras'),
  ('Protección respiratoria', 'Mascarillas, equipos filtrantes'),
  ('Protección manos',      'Guantes de trabajo'),
  ('Protección pies',       'Calzado de seguridad'),
  ('Protección cuerpo',     'Monos, chalecos, arneses'),
  ('Protección altura',     'Arneses, líneas de vida'),
  ('Señalización',          'Chalecos reflectantes')
ON CONFLICT DO NOTHING;

-- -------------------------
-- EPIs
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_epis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  category_id     UUID REFERENCES sm_epi_categories(id) ON DELETE SET NULL,
  supplier_id     UUID REFERENCES sea_suppliers(id) ON DELETE SET NULL,

  codigo          TEXT NOT NULL,
  nombre          TEXT NOT NULL,
  descripcion     TEXT,
  fabricante      TEXT,
  modelo          TEXT,
  referencia      TEXT,
  talla           TEXT,
  foto_url        TEXT,
  qr_code         TEXT UNIQUE,

  -- Stock
  stock_actual    INTEGER NOT NULL DEFAULT 0,
  stock_minimo    INTEGER NOT NULL DEFAULT 0,
  ubicacion       TEXT,

  -- Económico
  coste_unitario  NUMERIC(10,2),

  -- Normativa
  norma_ce        TEXT,
  fecha_caducidad_lote DATE,
  vida_util_meses INTEGER,

  activo          BOOLEAN NOT NULL DEFAULT true,
  observaciones   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- MOVIMIENTOS DE STOCK EPIs
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_epi_stock_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epi_id          UUID NOT NULL REFERENCES sm_epis(id) ON DELETE CASCADE,
  company_id      UUID REFERENCES sea_companies(id) ON DELETE SET NULL,
  realizado_por   UUID REFERENCES sea_employees(id) ON DELETE SET NULL,

  tipo            TEXT NOT NULL,
  -- 'compra', 'entrega', 'reposicion', 'devolucion', 'perdida', 'baja', 'ajuste'

  cantidad        INTEGER NOT NULL,
  stock_antes     INTEGER NOT NULL,
  stock_despues   INTEGER NOT NULL,

  employee_dest_id UUID REFERENCES sea_employees(id) ON DELETE SET NULL,
  proveedor_id    UUID REFERENCES sea_suppliers(id) ON DELETE SET NULL,

  referencia      TEXT,
  coste_total     NUMERIC(10,2),
  observaciones   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- ENTREGAS DE EPIs
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_epi_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epi_id          UUID NOT NULL REFERENCES sm_epis(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  entregado_por   UUID REFERENCES sea_employees(id) ON DELETE SET NULL,

  tipo_entrega    TEXT NOT NULL DEFAULT 'directa',  -- 'directa', 'solicitud'
  cantidad        INTEGER NOT NULL DEFAULT 1,
  talla           TEXT,

  estado          TEXT NOT NULL DEFAULT 'entregado',
  -- 'pendiente', 'entregado', 'devuelto', 'perdido', 'dado_de_baja'

  fecha_entrega   TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_devolucion TIMESTAMPTZ,
  fecha_caducidad DATE,  -- caducidad del EPI entregado

  firma_url       TEXT,
  signature_id    UUID REFERENCES sea_signatures(id) ON DELETE SET NULL,
  observaciones   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- SOLICITUDES DE EPIs (operario solicita)
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_epi_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  epi_id          UUID NOT NULL REFERENCES sm_epis(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  company_id      UUID REFERENCES sea_companies(id) ON DELETE SET NULL,

  cantidad        INTEGER NOT NULL DEFAULT 1,
  talla           TEXT,
  motivo          TEXT,
  estado          TEXT NOT NULL DEFAULT 'pendiente',  -- 'pendiente', 'aprobada', 'rechazada', 'entregada'
  gestionado_por  UUID REFERENCES sea_employees(id) ON DELETE SET NULL,
  fecha_gestion   TIMESTAMPTZ,
  observaciones   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- DOCUMENTOS DE SEGURIDAD
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_safety_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  work_center_id  UUID REFERENCES sea_work_centers(id) ON DELETE SET NULL,
  creado_por      UUID REFERENCES sea_employees(id) ON DELETE SET NULL,

  titulo          TEXT NOT NULL,
  tipo            TEXT NOT NULL,
  -- 'procedimiento', 'instruccion', 'norma', 'comunicado', 'otro'

  descripcion     TEXT,
  contenido       TEXT,
  archivo_url     TEXT,
  version         TEXT NOT NULL DEFAULT '1.0',

  -- Audiencia
  aplica_empresa_id UUID REFERENCES sea_companies(id) ON DELETE SET NULL,
  aplica_centro_id  UUID REFERENCES sea_work_centers(id) ON DELETE SET NULL,
  aplica_rol        TEXT,  -- null = todos

  -- Control
  lectura_obligatoria BOOLEAN NOT NULL DEFAULT false,
  publicado       BOOLEAN NOT NULL DEFAULT false,
  fecha_publicacion TIMESTAMPTZ,
  fecha_caducidad DATE,

  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- LECTURAS / FIRMAS DE DOCUMENTOS
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_document_acknowledgements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES sm_safety_documents(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,

  leido           BOOLEAN NOT NULL DEFAULT false,
  firmado         BOOLEAN NOT NULL DEFAULT false,
  fecha_lectura   TIMESTAMPTZ,
  fecha_firma     TIMESTAMPTZ,

  pin_usado       TEXT,  -- hash del PIN de confirmación
  firma_url       TEXT,
  signature_id    UUID REFERENCES sea_signatures(id) ON DELETE SET NULL,

  dispositivo     TEXT,
  ip              TEXT,
  observaciones   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, employee_id)
);

-- -------------------------
-- REUNIONES DE SEGURIDAD
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_safety_meetings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  work_center_id  UUID REFERENCES sea_work_centers(id) ON DELETE SET NULL,
  organizado_por  UUID REFERENCES sea_employees(id) ON DELETE SET NULL,

  titulo          TEXT NOT NULL,
  descripcion     TEXT,
  fecha           TIMESTAMPTZ NOT NULL,
  duracion_minutos INTEGER,
  lugar           TEXT,
  acta_url        TEXT,
  estado          TEXT NOT NULL DEFAULT 'programada',
  -- 'programada', 'realizada', 'cancelada'

  lectura_obligatoria BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- ASISTENTES A REUNIONES
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_meeting_attendees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id      UUID NOT NULL REFERENCES sm_safety_meetings(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,

  asistio         BOOLEAN,
  firma_url       TEXT,
  signature_id    UUID REFERENCES sea_signatures(id) ON DELETE SET NULL,
  fecha_firma     TIMESTAMPTZ,
  observaciones   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, employee_id)
);

-- -------------------------
-- FORMACIONES
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_trainings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  titulo          TEXT NOT NULL,
  tipo            TEXT NOT NULL,  -- 'prl', 'tecnica', 'maquinaria', 'otro'
  descripcion     TEXT,
  organismo       TEXT,
  duración_horas  NUMERIC(5,1),
  vigencia_meses  INTEGER,  -- null = no caduca
  obligatoria     BOOLEAN NOT NULL DEFAULT false,
  aplica_rol      TEXT,
  documento_url   TEXT,
  activa          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- REGISTROS FORMACIÓN POR EMPLEADO
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_training_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  training_id     UUID NOT NULL REFERENCES sm_trainings(id) ON DELETE CASCADE,
  employee_id     UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,

  fecha_inicio    DATE,
  fecha_fin       DATE,
  fecha_caducidad DATE,
  aprobado        BOOLEAN,
  nota            NUMERIC(4,2),
  certificado_url TEXT,
  estado          TEXT NOT NULL DEFAULT 'completado',
  -- 'pendiente', 'en_curso', 'completado', 'caducado', 'no_presentado'

  observaciones   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- INSPECCIONES DE SEGURIDAD
-- -------------------------
CREATE TABLE IF NOT EXISTS sm_inspections (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  work_center_id  UUID REFERENCES sea_work_centers(id) ON DELETE SET NULL,
  realizado_por   UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,

  titulo          TEXT NOT NULL,
  tipo            TEXT NOT NULL,  -- 'periodica', 'inicial', 'tras_accidente', 'auditoria'
  fecha           TIMESTAMPTZ NOT NULL DEFAULT now(),
  resultado       TEXT NOT NULL DEFAULT 'correcto',
  -- 'correcto', 'con_deficiencias', 'critico'

  checklist       JSONB,
  observaciones   TEXT,
  informe_url     TEXT,
  proxima_inspeccion DATE,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- ÍNDICES
-- -------------------------
CREATE INDEX IF NOT EXISTS idx_sm_epis_company        ON sm_epis(company_id);
CREATE INDEX IF NOT EXISTS idx_sm_epis_stock          ON sm_epis(stock_actual);
CREATE INDEX IF NOT EXISTS idx_sm_stock_mov_epi       ON sm_epi_stock_movements(epi_id);
CREATE INDEX IF NOT EXISTS idx_sm_assignments_emp     ON sm_epi_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_sm_assignments_epi     ON sm_epi_assignments(epi_id);
CREATE INDEX IF NOT EXISTS idx_sm_docs_company        ON sm_safety_documents(company_id);
CREATE INDEX IF NOT EXISTS idx_sm_docs_publicado      ON sm_safety_documents(publicado);
CREATE INDEX IF NOT EXISTS idx_sm_ack_doc             ON sm_document_acknowledgements(document_id);
CREATE INDEX IF NOT EXISTS idx_sm_ack_emp             ON sm_document_acknowledgements(employee_id);
CREATE INDEX IF NOT EXISTS idx_sm_training_emp        ON sm_training_records(employee_id);

-- -------------------------
-- TRIGGERS updated_at
-- -------------------------
CREATE OR REPLACE TRIGGER trg_sm_epis_updated_at
  BEFORE UPDATE ON sm_epis
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

CREATE OR REPLACE TRIGGER trg_sm_docs_updated_at
  BEFORE UPDATE ON sm_safety_documents
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

CREATE OR REPLACE TRIGGER trg_sm_meetings_updated_at
  BEFORE UPDATE ON sm_safety_meetings
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

-- -------------------------
-- TRIGGER: actualizar stock al registrar movimiento
-- -------------------------
CREATE OR REPLACE FUNCTION sm_update_epi_stock()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE sm_epis
  SET stock_actual = NEW.stock_despues,
      updated_at = now()
  WHERE id = NEW.epi_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_sm_stock_update
  AFTER INSERT ON sm_epi_stock_movements
  FOR EACH ROW EXECUTE FUNCTION sm_update_epi_stock();

-- -------------------------
-- RLS
-- -------------------------
ALTER TABLE sm_epi_categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_epis                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_epi_stock_movements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_epi_assignments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_epi_requests               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_safety_documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_document_acknowledgements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_safety_meetings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_meeting_attendees          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_trainings                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_training_records           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sm_inspections                ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sm_auth_all" ON sm_epi_categories             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_epis                       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_epi_stock_movements        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_epi_assignments            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_epi_requests               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_safety_documents           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_document_acknowledgements  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_safety_meetings            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_meeting_attendees          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_trainings                  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_training_records           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sm_auth_all" ON sm_inspections                FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Anon: lectura EPIs por QR
CREATE POLICY "sm_anon_epis_qr" ON sm_epis FOR SELECT TO anon USING (activo = true);
