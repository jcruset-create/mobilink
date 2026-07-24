-- ============================================================
-- SEA Presencia — Login de empleado con PIN (APK de fichaje)
-- Ejecutar en Supabase > SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Verifica el PIN del empleado. Si aún no tiene PIN (pin_hash NULL),
-- el primer PIN introducido queda registrado como suyo.
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

  IF v_hash IS NULL OR v_hash = '' THEN
    UPDATE sea_employees
    SET pin_hash = crypt(trim(p_pin), gen_salt('bf')),
        ultimo_acceso = now()
    WHERE id = p_employee_id;
    RETURN TRUE;
  END IF;

  IF v_hash = crypt(trim(p_pin), v_hash) THEN
    UPDATE sea_employees SET ultimo_acceso = now() WHERE id = p_employee_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

-- Solo el backend (service_role) puede llamarla
REVOKE ALL ON FUNCTION pres_login(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pres_login(UUID, TEXT) TO service_role;
