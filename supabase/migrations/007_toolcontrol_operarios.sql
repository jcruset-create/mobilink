-- ============================================================
-- SEA PLATFORM — MOBILINK TOOLCONTROL
-- Migración 007: RPCs para la app de técnicos (toolcontrol_app)
-- Ejecutar a mano en el SQL Editor de Supabase.
-- ============================================================
-- Todas las funciones son SECURITY DEFINER con GRANT a anon:
-- la app móvil trabaja con la anon key y valida al operario por
-- codigo_operario + PIN (pin_hash con pgcrypto en sea_employees).

-- -------------------------
-- LOGIN DE OPERARIO
-- -------------------------
CREATE OR REPLACE FUNCTION tc_operator_login(p_codigo text, p_pin text)
RETURNS TABLE (id uuid, nombre text, rol text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT e.id,
         trim(e.nombre || ' ' || coalesce(e.apellidos, '')) AS nombre,
         e.rol
  FROM sea_employees e
  WHERE e.activo = true
    AND e.codigo_operario = p_codigo
    AND e.pin_hash IS NOT NULL
    AND e.pin_hash = crypt(p_pin, e.pin_hash);
$$;

-- -------------------------
-- UTILIZAR HERRAMIENTA (disponible -> en_uso, movimiento 'salida')
-- -------------------------
CREATE OR REPLACE FUNCTION tc_op_usar_tool(p_tool uuid, p_employee uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tool tc_tools%ROWTYPE;
BEGIN
  SELECT * INTO v_tool FROM tc_tools WHERE id = p_tool FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Herramienta no encontrada');
  END IF;
  IF v_tool.estado <> 'disponible' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La herramienta no está disponible (estado: ' || v_tool.estado || ')');
  END IF;

  UPDATE tc_tools SET estado = 'en_uso' WHERE id = p_tool;

  INSERT INTO tc_tool_movements
    (tool_id, employee_id, company_id, tipo, ubicacion_desde_id, fecha_salida, estado_inicial)
  VALUES
    (p_tool, p_employee, v_tool.company_id, 'salida', v_tool.ubicacion_actual_id, now(), v_tool.estado);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -------------------------
-- DEVOLVER HERRAMIENTA (en_uso -> disponible, movimiento 'devolucion')
-- Cierra además el movimiento de salida abierto del operario.
-- -------------------------
CREATE OR REPLACE FUNCTION tc_op_devolver_tool(p_tool uuid, p_employee uuid, p_ubicacion uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tool tc_tools%ROWTYPE;
BEGIN
  SELECT * INTO v_tool FROM tc_tools WHERE id = p_tool FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Herramienta no encontrada');
  END IF;
  IF v_tool.estado <> 'en_uso' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La herramienta no está en uso (estado: ' || v_tool.estado || ')');
  END IF;

  UPDATE tc_tools
  SET estado = 'disponible',
      ubicacion_actual_id = COALESCE(p_ubicacion, ubicacion_actual_id)
  WHERE id = p_tool;

  -- Cierra la salida abierta (si existe)
  UPDATE tc_tool_movements
  SET fecha_devolucion = now(),
      estado_final = 'disponible',
      ubicacion_hasta_id = COALESCE(p_ubicacion, ubicacion_hasta_id)
  WHERE id = (
    SELECT m.id FROM tc_tool_movements m
    WHERE m.tool_id = p_tool AND m.tipo = 'salida' AND m.fecha_devolucion IS NULL
    ORDER BY m.fecha_salida DESC LIMIT 1
  );

  INSERT INTO tc_tool_movements
    (tool_id, employee_id, company_id, tipo, ubicacion_desde_id, ubicacion_hasta_id,
     fecha_salida, fecha_devolucion, estado_inicial, estado_final)
  VALUES
    (p_tool, p_employee, v_tool.company_id, 'devolucion', v_tool.ubicacion_actual_id,
     COALESCE(p_ubicacion, v_tool.ubicacion_actual_id), now(), now(), 'en_uso', 'disponible');

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -------------------------
-- MOVER HERRAMIENTA DE UBICACIÓN (movimiento 'movimiento')
-- -------------------------
CREATE OR REPLACE FUNCTION tc_op_mover_tool(p_tool uuid, p_employee uuid, p_ubicacion uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tool tc_tools%ROWTYPE;
BEGIN
  SELECT * INTO v_tool FROM tc_tools WHERE id = p_tool FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Herramienta no encontrada');
  END IF;
  IF p_ubicacion IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ubicación obligatoria');
  END IF;

  UPDATE tc_tools SET ubicacion_actual_id = p_ubicacion WHERE id = p_tool;

  INSERT INTO tc_tool_movements
    (tool_id, employee_id, company_id, tipo, ubicacion_desde_id, ubicacion_hasta_id,
     fecha_salida, estado_inicial, estado_final)
  VALUES
    (p_tool, p_employee, v_tool.company_id, 'movimiento', v_tool.ubicacion_actual_id,
     p_ubicacion, now(), v_tool.estado, v_tool.estado);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -------------------------
-- REPORTAR INCIDENCIA (herramienta o máquina)
-- tc_incidents no tiene columna de gravedad: se refleja en el título.
-- -------------------------
CREATE OR REPLACE FUNCTION tc_op_reportar_incidencia(
  p_tool uuid,
  p_employee uuid,
  p_descripcion text,
  p_gravedad text,
  p_machine uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company uuid;
BEGIN
  IF p_tool IS NULL AND p_machine IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Falta herramienta o máquina');
  END IF;

  IF p_tool IS NOT NULL THEN
    SELECT company_id INTO v_company FROM tc_tools WHERE id = p_tool;
  ELSE
    SELECT company_id INTO v_company FROM tc_machines WHERE id = p_machine;
  END IF;

  INSERT INTO tc_incidents
    (company_id, tool_id, machine_id, reportado_por, titulo, descripcion, tipo, estado, fecha_incidencia)
  VALUES
    (v_company, p_tool, p_machine, p_employee,
     'Incidencia app técnicos (gravedad ' || COALESCE(p_gravedad, 'media') || ')',
     p_descripcion, 'averia', 'abierta', now());

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- -------------------------
-- MIS HERRAMIENTAS EN USO
-- (tc_tool_movements no es legible por anon; esta RPC lo resuelve)
-- -------------------------
CREATE OR REPLACE FUNCTION tc_op_mis_herramientas(p_employee uuid)
RETURNS TABLE (id uuid, codigo text, nombre text, marca text, modelo text,
               estado text, foto_url text, fecha_salida timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.codigo, t.nombre, t.marca, t.modelo, t.estado, t.foto_url, m.fecha_salida
  FROM tc_tool_movements m
  JOIN tc_tools t ON t.id = m.tool_id
  WHERE m.employee_id = p_employee
    AND m.tipo = 'salida'
    AND m.fecha_devolucion IS NULL
    AND t.estado = 'en_uso'
  ORDER BY m.fecha_salida DESC;
$$;

-- -------------------------
-- PERMISOS
-- -------------------------
GRANT EXECUTE ON FUNCTION tc_operator_login(text, text) TO anon;
GRANT EXECUTE ON FUNCTION tc_op_usar_tool(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION tc_op_devolver_tool(uuid, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION tc_op_mover_tool(uuid, uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION tc_op_reportar_incidencia(uuid, uuid, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION tc_op_mis_herramientas(uuid) TO anon;

-- Índice para localizar rápido la salida abierta de una herramienta
CREATE INDEX IF NOT EXISTS idx_tc_movements_open_salida
  ON tc_tool_movements(tool_id, fecha_salida DESC)
  WHERE tipo = 'salida' AND fecha_devolucion IS NULL;
