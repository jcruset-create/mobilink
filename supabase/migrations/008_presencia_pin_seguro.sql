-- ============================================================
-- Presencia — PIN de empleado: fin del auto-registro
-- Ejecutar en Supabase > SQL Editor
-- ============================================================
--
-- PROBLEMA QUE CORRIGE
-- La versión anterior de `pres_login` (007_presencia_pin.sql) registraba como
-- válido el PRIMER PIN que se tecleara para un empleado que aún no tuviera uno
-- (`pin_hash IS NULL`). Como la lista de empleados del selector de login es
-- pública, cualquiera podía apropiarse de la identidad de un compañero sin PIN
-- asignado y fichar por él. Los fichajes son registro de jornada laboral, así
-- que ese dato no sostiene una discusión ni una inspección.
--
-- QUÉ CAMBIA
-- 1. `pres_login` ya NO registra PINs: si el empleado no tiene `pin_hash`,
--    devuelve FALSE. Solo verifica.
-- 2. Se añade `sea_set_employee_pin`, la vía única para asignar un PIN, que
--    solo puede llamar el backend (service_role) desde un endpoint de
--    administración autenticado.
--
-- ORDEN DE EJECUCIÓN (importante)
-- Ejecuta este script DESPUÉS de desplegar el backend que expone
-- `PUT /api/sea-core/employees/:id/pin`. Si lo ejecutas antes, los empleados
-- que todavía no tengan PIN no podrán entrar hasta que un responsable se lo
-- asigne, y no habrá pantalla para hacerlo.
--
-- TRAS EJECUTARLO: revisa qué empleados activos se quedan sin acceso con la
-- consulta del final y asígnales el PIN desde la ficha de empleado.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. pres_login: solo verifica, nunca registra ────────────────────────────
CREATE OR REPLACE FUNCTION pres_login(p_employee_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) < 4 THEN
    RETURN FALSE;
  END IF;

  SELECT pin_hash INTO v_hash
  FROM sea_employees
  WHERE id = p_employee_id AND activo = true;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Sin PIN asignado = sin acceso. Debe asignarlo un responsable.
  IF v_hash IS NULL OR v_hash = '' THEN
    RETURN FALSE;
  END IF;

  IF v_hash = crypt(trim(p_pin), v_hash) THEN
    UPDATE sea_employees SET ultimo_acceso = now() WHERE id = p_employee_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION pres_login(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pres_login(UUID, TEXT) TO service_role;

-- ── 2. Asignación de PIN (única vía) ────────────────────────────────────────
-- p_pin NULL o vacío revoca el acceso del empleado.
CREATE OR REPLACE FUNCTION sea_set_employee_pin(p_employee_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_pin IS NULL OR length(trim(p_pin)) = 0 THEN
    UPDATE sea_employees SET pin_hash = NULL WHERE id = p_employee_id;
    RETURN FOUND;
  END IF;

  IF length(trim(p_pin)) < 4 THEN
    RAISE EXCEPTION 'El PIN debe tener al menos 4 dígitos';
  END IF;

  UPDATE sea_employees
  SET pin_hash = crypt(trim(p_pin), gen_salt('bf'))
  WHERE id = p_employee_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION sea_set_employee_pin(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sea_set_employee_pin(UUID, TEXT) TO service_role;

-- ── 3. Comprobación: empleados activos que se quedan sin acceso ─────────────
-- Ejecuta esto tras la migración y asigna PIN a los que aparezcan.
--
--   SELECT id, nombre, apellidos, codigo_operario
--   FROM sea_employees
--   WHERE activo = true AND (pin_hash IS NULL OR pin_hash = '')
--   ORDER BY nombre;
