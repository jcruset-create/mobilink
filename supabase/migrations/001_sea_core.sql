-- ============================================================
-- SEA PLATFORM — SEA CORE
-- Migración 001: Base común compartida por todos los módulos
-- ============================================================

-- -------------------------
-- EXTENSIONES
-- -------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -------------------------
-- EMPRESAS
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  cif         TEXT UNIQUE,
  direccion   TEXT,
  telefono    TEXT,
  email       TEXT,
  logo_url    TEXT,
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- MÓDULOS DISPONIBLES
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo      TEXT NOT NULL UNIQUE,  -- 'toolcontrol', 'safety', 'storemanager', 'attendance'
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO sea_modules (codigo, nombre, descripcion) VALUES
  ('toolcontrol',   'SEA ToolControl',    'Gestión de herramientas y maquinaria'),
  ('safety',        'SEA Safety Manager', 'EPIs, PRL y documentación preventiva'),
  ('storemanager',  'SEA StoreManager',   'Control de almacén y stock'),
  ('attendance',    'SEA Attendance',     'Control de asistencia y jornada')
ON CONFLICT (codigo) DO NOTHING;

-- -------------------------
-- MÓDULOS ACTIVOS POR EMPRESA
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_company_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES sea_companies(id) ON DELETE CASCADE,
  module_id   UUID NOT NULL REFERENCES sea_modules(id) ON DELETE CASCADE,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, module_id)
);

-- -------------------------
-- CENTROS DE TRABAJO
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_work_centers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES sea_companies(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  codigo      TEXT,
  direccion   TEXT,
  telefono    TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- PROVEEDORES
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_suppliers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES sea_companies(id) ON DELETE SET NULL,
  nombre      TEXT NOT NULL,
  cif         TEXT,
  contacto    TEXT,
  telefono    TEXT,
  email       TEXT,
  direccion   TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- ROLES
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  descripcion TEXT,
  permisos    JSONB NOT NULL DEFAULT '{}',
  es_sistema  BOOLEAN NOT NULL DEFAULT false,  -- roles predefinidos no editables
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sea_roles (nombre, descripcion, es_sistema, permisos) VALUES
  ('admin',        'Administrador de la plataforma', true, '{"*": true}'),
  ('responsable',  'Responsable de módulo',          true, '{"read": true, "write": true}'),
  ('operario',     'Operario base',                  true, '{"read": true}'),
  ('prl',          'Responsable PRL',                true, '{"safety": true}'),
  ('almacen',      'Encargado de almacén',           true, '{"store": true}')
ON CONFLICT DO NOTHING;

-- -------------------------
-- EMPLEADOS (ficha completa)
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_employees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE SET NULL,
  work_center_id  UUID REFERENCES sea_work_centers(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Datos personales
  nombre          TEXT NOT NULL,
  apellidos       TEXT,
  dni_nie         TEXT,
  telefono        TEXT,
  email           TEXT,
  cargo           TEXT,
  departamento    TEXT,
  fecha_alta      DATE,
  fecha_baja      DATE,

  -- Acceso
  rol             TEXT NOT NULL DEFAULT 'operario',
  pin_hash        TEXT,                          -- PIN 4 dígitos cifrado con pgcrypto
  codigo_operario TEXT UNIQUE,                   -- código interno corto
  activo          BOOLEAN NOT NULL DEFAULT true,
  ultimo_acceso   TIMESTAMPTZ,

  -- Foto
  foto_url        TEXT,

  -- Observaciones
  observaciones   TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- TALLAS VESTUARIO
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_employee_clothing (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  calzado       TEXT,
  pantalon      TEXT,
  camisa        TEXT,
  camiseta      TEXT,
  chaqueta      TEXT,
  sudadera      TEXT,
  chaleco       TEXT,
  observaciones TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- CONSENTIMIENTOS
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_consents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,  -- 'normativa_interna', 'whatsapp', 'firma_digital', 'app_inicial'
  version       TEXT NOT NULL DEFAULT '1.0',
  aceptado      BOOLEAN NOT NULL DEFAULT false,
  fecha         TIMESTAMPTZ,
  dispositivo   TEXT,
  ip            TEXT,
  firma_url     TEXT,
  datos_extra   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- FIRMAS DIGITALES
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_signatures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  modulo        TEXT NOT NULL,            -- 'toolcontrol', 'safety', 'core', etc.
  referencia_id UUID,                     -- id del objeto firmado
  tipo          TEXT NOT NULL,            -- 'entrega_epi', 'lectura_doc', 'devolucion', etc.
  firma_url     TEXT NOT NULL,
  hash          TEXT,                     -- hash del documento en el momento de firmar
  dispositivo   TEXT,
  ip            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- COMPETENCIAS (catálogo)
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_competencies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  descripcion   TEXT,
  categoria     TEXT,   -- 'tecnica', 'seguridad', 'herramienta', etc.
  es_sistema    BOOLEAN NOT NULL DEFAULT false,
  activa        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Competencias de sistema predefinidas
INSERT INTO sea_competencies (nombre, categoria, es_sistema) VALUES
  ('Mecánica general',          'tecnica',    true),
  ('Mecánica pesada',           'tecnica',    true),
  ('Electricidad',              'tecnica',    true),
  ('Electrónica',               'tecnica',    true),
  ('Hidráulica',                'tecnica',    true),
  ('Neumática',                 'tecnica',    true),
  ('Soldadura MIG',             'tecnica',    true),
  ('Soldadura TIG',             'tecnica',    true),
  ('Soldadura Electrodo',       'tecnica',    true),
  ('Torno',                     'tecnica',    true),
  ('Fresadora',                 'tecnica',    true),
  ('CNC',                       'tecnica',    true),
  ('Diagnóstico electrónico',   'tecnica',    true),
  ('Mantenimiento industrial',  'tecnica',    true),
  ('Montaje',                   'tecnica',    true),
  ('Ajuste mecánico',           'tecnica',    true),
  ('Instrumentación',           'tecnica',    true)
ON CONFLICT DO NOTHING;

-- -------------------------
-- COMPETENCIAS POR EMPLEADO
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_employee_competencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  competency_id   UUID NOT NULL REFERENCES sea_competencies(id) ON DELETE CASCADE,
  nivel           TEXT NOT NULL DEFAULT 'basico',  -- 'basico', 'medio', 'avanzado', 'experto'
  nivel_numerico  SMALLINT CHECK (nivel_numerico BETWEEN 1 AND 5),
  anos_experiencia SMALLINT,
  observaciones   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, competency_id)
);

-- -------------------------
-- CERTIFICACIONES (catálogo)
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_certifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  descripcion   TEXT,
  organismo     TEXT,
  categoria     TEXT,
  vigencia_meses INTEGER,  -- null = no caduca
  es_sistema    BOOLEAN NOT NULL DEFAULT false,
  activa        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- CERTIFICACIONES POR EMPLEADO
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_employee_certifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id       UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  certification_id  UUID NOT NULL REFERENCES sea_certifications(id) ON DELETE CASCADE,
  organismo_emisor  TEXT,
  fecha_obtencion   DATE NOT NULL,
  fecha_caducidad   DATE,
  numero            TEXT,
  documento_url     TEXT,
  estado            TEXT NOT NULL DEFAULT 'vigente',  -- 'vigente', 'caducado', 'proximo_caducidad'
  observaciones     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- AUTORIZACIONES INTERNAS (catálogo)
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_authorizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  descripcion   TEXT,
  categoria     TEXT,
  requiere_certificacion BOOLEAN NOT NULL DEFAULT false,
  es_sistema    BOOLEAN NOT NULL DEFAULT false,
  activa        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sea_authorizations (nombre, categoria, es_sistema) VALUES
  ('Manejo puente grúa',         'elevacion',  true),
  ('Manejo carretilla elevadora','elevacion',  true),
  ('Trabajos en altura',         'seguridad',  true),
  ('Espacios confinados',        'seguridad',  true),
  ('Trabajos eléctricos BT',     'electrico',  true),
  ('Trabajos eléctricos AT',     'electrico',  true),
  ('Trabajos riesgo ATEX',       'seguridad',  true),
  ('Manipulación de cargas',     'seguridad',  true),
  ('Operador maquinaria pesada', 'maquinaria', true)
ON CONFLICT DO NOTHING;

-- -------------------------
-- AUTORIZACIONES POR EMPLEADO
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_employee_authorizations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  authorization_id    UUID NOT NULL REFERENCES sea_authorizations(id) ON DELETE CASCADE,
  fecha_autorizacion  DATE NOT NULL,
  fecha_caducidad     DATE,
  autorizado_por      UUID REFERENCES sea_employees(id),
  documento_url       TEXT,
  estado              TEXT NOT NULL DEFAULT 'vigente',  -- 'vigente', 'caducado', 'revocado'
  observaciones       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, authorization_id)
);

-- -------------------------
-- REGISTROS DE FORMACIÓN
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_training_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     UUID NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  titulo          TEXT NOT NULL,
  tipo            TEXT NOT NULL,  -- 'prl', 'tecnica', 'maquinaria', 'otro'
  organismo       TEXT,
  fecha_inicio    DATE,
  fecha_fin       DATE,
  horas           NUMERIC(6,1),
  fecha_caducidad DATE,
  certificado_url TEXT,
  estado          TEXT NOT NULL DEFAULT 'completado',  -- 'pendiente', 'en_curso', 'completado', 'caducado'
  observaciones   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- NOTIFICACIONES
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID REFERENCES sea_companies(id) ON DELETE CASCADE,
  employee_id   UUID REFERENCES sea_employees(id) ON DELETE CASCADE,
  tipo          TEXT NOT NULL,       -- 'push', 'whatsapp', 'email', 'interna'
  modulo        TEXT,
  titulo        TEXT NOT NULL,
  mensaje       TEXT NOT NULL,
  leida         BOOLEAN NOT NULL DEFAULT false,
  enviada       BOOLEAN NOT NULL DEFAULT false,
  error         TEXT,
  referencia_id UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- AUDITORÍA (universal)
-- -------------------------
CREATE TABLE IF NOT EXISTS sea_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID REFERENCES sea_companies(id) ON DELETE SET NULL,
  employee_id     UUID REFERENCES sea_employees(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  modulo          TEXT NOT NULL,   -- 'core', 'toolcontrol', 'safety', 'storemanager', 'attendance'
  accion          TEXT NOT NULL,
  tabla_afectada  TEXT,
  registro_id     UUID,
  descripcion     TEXT,
  datos_antes     JSONB,
  datos_despues   JSONB,
  ip              TEXT,
  dispositivo     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -------------------------
-- ÍNDICES
-- -------------------------
CREATE INDEX IF NOT EXISTS idx_employees_company      ON sea_employees(company_id);
CREATE INDEX IF NOT EXISTS idx_employees_work_center  ON sea_employees(work_center_id);
CREATE INDEX IF NOT EXISTS idx_employees_user_id      ON sea_employees(user_id);
CREATE INDEX IF NOT EXISTS idx_employees_activo       ON sea_employees(activo);
CREATE INDEX IF NOT EXISTS idx_emp_competencies_emp   ON sea_employee_competencies(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_certifications_emp ON sea_employee_certifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_auth_emp           ON sea_employee_authorizations(employee_id);
CREATE INDEX IF NOT EXISTS idx_training_emp           ON sea_training_records(employee_id);
CREATE INDEX IF NOT EXISTS idx_audit_company          ON sea_audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_modulo           ON sea_audit_logs(modulo);
CREATE INDEX IF NOT EXISTS idx_audit_created          ON sea_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_emp      ON sea_notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_leida    ON sea_notifications(leida);

-- -------------------------
-- UPDATED_AT TRIGGER
-- -------------------------
CREATE OR REPLACE FUNCTION sea_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON sea_companies
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

CREATE OR REPLACE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON sea_employees
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

CREATE OR REPLACE TRIGGER trg_work_centers_updated_at
  BEFORE UPDATE ON sea_work_centers
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

CREATE OR REPLACE TRIGGER trg_suppliers_updated_at
  BEFORE UPDATE ON sea_suppliers
  FOR EACH ROW EXECUTE FUNCTION sea_set_updated_at();

-- -------------------------
-- RLS POLICIES (base)
-- -------------------------
ALTER TABLE sea_companies                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_modules                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_company_modules            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_work_centers               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_suppliers                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_roles                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_employees                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_employee_clothing          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_consents                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_signatures                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_competencies               ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_employee_competencies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_certifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_employee_certifications    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_authorizations             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_employee_authorizations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_training_records           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_notifications              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sea_audit_logs                 ENABLE ROW LEVEL SECURITY;

-- Acceso autenticado completo (ajustar por roles en siguientes migraciones)
CREATE POLICY "sea_auth_all" ON sea_companies            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_modules              FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_company_modules      FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_work_centers         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_suppliers            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_roles                FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_employees            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_employee_clothing    FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_consents             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_signatures           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_competencies         FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_employee_competencies   FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_certifications          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_employee_certifications FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_authorizations          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_employee_authorizations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_training_records     FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_notifications        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "sea_auth_all" ON sea_audit_logs           FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Acceso anon para lectura de módulos (APK sin sesión)
CREATE POLICY "sea_anon_modules_read" ON sea_modules FOR SELECT TO anon USING (true);
