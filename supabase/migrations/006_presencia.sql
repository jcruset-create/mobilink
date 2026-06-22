-- ============================================================
-- SEA Presencia — Módulo de fichaje / control de presencia
-- Ejecutar en Supabase > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS pres_records (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   UUID        NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
  fecha         DATE        NOT NULL DEFAULT CURRENT_DATE,
  hora_entrada  TIMESTAMPTZ,
  hora_salida   TIMESTAMPTZ,
  tipo          TEXT        NOT NULL DEFAULT 'normal'
                              CHECK (tipo IN ('normal','turno','guardia','extra')),
  observaciones TEXT,
  validado      BOOLEAN     NOT NULL DEFAULT false,
  validado_por  UUID        REFERENCES sea_employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, fecha)
);

-- RLS
ALTER TABLE pres_records ENABLE ROW LEVEL SECURITY;

-- Usuarios autenticados (administradores/responsables): acceso total
CREATE POLICY "pres_auth_all"
  ON pres_records FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Portal del empleado (anon): puede leer, fichar entrada y salida
CREATE POLICY "pres_anon_select"
  ON pres_records FOR SELECT TO anon USING (true);

CREATE POLICY "pres_anon_insert"
  ON pres_records FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "pres_anon_update"
  ON pres_records FOR UPDATE TO anon
  USING (true) WITH CHECK (true);
