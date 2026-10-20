-- ============================================================
-- Horarios y turnos de los empleados (Core).
--
-- Las tablas las crea también el servidor al arrancar (server/db.ts). Esta
-- migración añade lo que allí no se puede: la clave foránea contra
-- sea_employees, que en la base de la CI no existe.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

CREATE TABLE IF NOT EXISTS sea_turnos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre      TEXT NOT NULL,
  tramos      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{"inicio":"06:00","fin":"14:00"}]
  dias        INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 1 = lunes … 7 = domingo
  activo      BOOLEAN NOT NULL DEFAULT true,
  orden       INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sea_horarios_empleado (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL,
  tipo           TEXT NOT NULL CHECK (tipo IN ('fijo','rotativo')),
  turno_ids      TEXT[] NOT NULL,     -- ids de sea_turnos, o 'taller' (horario de la agenda)
  semana_inicio  DATE,                -- lunes en que empieza por el primer turno (rotativo)
  vigente_desde  DATE NOT NULL,       -- la asignación anterior sigue valiendo para antes
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, vigente_desde)
);
CREATE INDEX IF NOT EXISTS idx_sea_horarios_empleado_emp ON sea_horarios_empleado (employee_id);

DO $$
BEGIN
  IF to_regclass('public.sea_employees') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sea_horarios_empleado_employee_fk') THEN
    ALTER TABLE sea_horarios_empleado
      ADD CONSTRAINT sea_horarios_empleado_employee_fk
      FOREIGN KEY (employee_id) REFERENCES sea_employees(id) ON DELETE CASCADE;
  END IF;
END $$;
