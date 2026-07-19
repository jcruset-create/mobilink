-- ============================================================================
-- RENOMBRADO PROFUNDO MOBILINK — FASE 1 (datos visibles)
-- Ejecución MANUAL en el SQL Editor de Supabase (pauta del proyecto).
--
-- Seguro de ejecutar YA: el backend acepta ambos nombres desde el commit
-- "prepara renombrado profundo" (lookup .in(["Mobilink Tarragona","SEA Tarragona"])).
-- Idempotente: re-ejecutarlo no hace nada si ya está aplicado.
-- ============================================================================

-- 1) Empresa de referencia de TyreControl (visible en selectores de empresa).
UPDATE tc_empresas
   SET nombre = 'Mobilink Tarragona'
 WHERE nombre = 'SEA Tarragona';

-- 2) Empresas del monolito (tabla companies de asistencias/backoffice), si existiera
--    la fila con la marca antigua como dato.
UPDATE companies
   SET nombre = 'Mobilink Tarragona'
 WHERE nombre = 'SEA Tarragona';

-- Verificación:
--   SELECT id, nombre FROM tc_empresas ORDER BY created_at;
--   SELECT id, nombre FROM companies WHERE nombre ILIKE '%tarragona%';
