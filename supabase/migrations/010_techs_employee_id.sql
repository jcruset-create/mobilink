-- ============================================================
-- Paso 2 de la unificacion de usuarios: vincular techs con Core
-- Ejecutar en Supabase > SQL Editor
-- ============================================================
--
-- QUE HACE
-- La columna `techs.employee_id` la crea sola el backend al arrancar (initDb).
-- Aqui se le pone la clave foranea y el indice, que no pueden ir en initDb
-- porque `sea_employees` la crean las migraciones de Supabase y en una base
-- recien creada (la de la CI) todavia no existe.
--
-- QUE **NO** HACE
-- No toca el historico. Partes, pausas, cobros y asistencias siguen apuntando
-- al tecnico POR NOMBRE en siete tablas, y asi se quedan: esta columna solo
-- sirve para las lecturas nuevas y para dejar de dar de alta a la misma
-- persona dos veces.
--
-- No empareja a nadie automaticamente. El emparejado se revisa desde el panel
-- (GET /api/techs/vinculo-core propone, PUT /api/techs/:name/vinculo-core
-- confirma), porque "Jose" puede ser Jose Garcia o Jose Martin y equivocarse
-- aqui significa atribuirle a alguien el trabajo de otro.
--
-- ORDEN: ejecutar DESPUES de desplegar el backend que crea la columna.
-- ============================================================

-- ── 1. Clave foranea e indice ───────────────────────────────────────────────
-- ON DELETE SET NULL: dar de baja a una persona en Core no puede borrar al
-- tecnico ni su historico; solo deshace el vinculo.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'techs_employee_id_fkey'
  ) THEN
    ALTER TABLE techs
      ADD CONSTRAINT techs_employee_id_fkey
      FOREIGN KEY (employee_id) REFERENCES sea_employees(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Una persona no puede ser dos tecnicos: seria el duplicado que se quiere
-- eliminar, pero con vinculo. El indice es parcial porque los no vinculados
-- (NULL) son muchos y no deben chocar entre si.
CREATE UNIQUE INDEX IF NOT EXISTS techs_employee_id_uniq
  ON techs (employee_id) WHERE employee_id IS NOT NULL;

-- ── 2. Informe: como esta el emparejado ─────────────────────────────────────
-- Mismo criterio que usa el panel. Sirve para hacerse una idea antes de entrar
-- a confirmarlos uno a uno.
--
-- Nota: la comparacion quita tildes con unaccent si esta disponible; si no,
-- compara en minusculas tal cual. El emparejado bueno lo hace el panel.
--
--   SELECT t.name                                   AS tecnico,
--          t.employee_id                            AS ya_vinculado,
--          count(e.id)                              AS candidatos,
--          min(coalesce(e.nombre,'') || ' ' || coalesce(e.apellidos,'')) AS candidato
--     FROM techs t
--     LEFT JOIN sea_employees e
--       ON e.activo = true
--      AND lower(e.nombre) = lower(t.name)
--    GROUP BY t.name, t.employee_id
--    ORDER BY count(e.id), t.name;
--
-- Lectura del resultado:
--   candidatos = 1  -> emparejado claro
--   candidatos > 1  -> dos personas con el mismo nombre de pila: elegir a mano
--   candidatos = 0  -> ese tecnico no esta en Core (o se llama distinto)
