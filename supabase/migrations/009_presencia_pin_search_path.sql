-- ============================================================
-- Presencia — el PIN volvía "Error guardando el PIN"
--
-- `sea_set_employee_pin` y `pres_login` llaman a `crypt()` y `gen_salt()`,
-- que son de pgcrypto. En Supabase esa extensión NO vive en `public`: vive
-- en el esquema `extensions`. Y las dos funciones declaran
-- `SET search_path = public`, así que dentro de ellas esas llamadas no
-- encuentran a nadie:
--
--   ERROR: function gen_salt(unknown) does not exist
--
-- El `CREATE EXTENSION IF NOT EXISTS pgcrypto` de la 008 no lo arregla:
-- como ya existe en `extensions`, no hace nada.
--
-- Lo que se rompía:
--   · asignar o revocar el PIN desde la ficha del empleado (error 500);
--   · entrar en las apps de operario, porque `pres_login` compara con
--     `crypt()` y devolvía error en vez de FALSE.
--
-- Ya había precedente en el repositorio: `tc_operator_login`, de
-- ToolControl, lleva `search_path = public, extensions` desde el principio.
-- Estas dos se quedaron atrás.
--
-- El cuerpo de las funciones no se toca; solo se añade `extensions` al
-- search_path. Sirve igual si pgcrypto está en `public`.
--
-- Pegar en Supabase (SQL Editor). Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION pres_login(p_employee_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

CREATE OR REPLACE FUNCTION sea_set_employee_pin(p_employee_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
