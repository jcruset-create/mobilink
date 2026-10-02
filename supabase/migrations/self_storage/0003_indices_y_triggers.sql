-- =============================================================================
-- Mobilink Self Storage · 0003 · Índices, unicidades parciales y triggers
-- =============================================================================

-- Configuración: una clave por (empresa, centro | empresa)
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_settings_key_uq
  ON self_storage_settings (empresa_id, COALESCE(center_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- Tipos: código único por (empresa, centro | común)
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_unit_types_code_uq
  ON self_storage_unit_types (empresa_id, COALESCE(center_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

-- Trasteros
CREATE INDEX IF NOT EXISTS self_storage_units_center_status_idx ON self_storage_units (center_id, status);
CREATE INDEX IF NOT EXISTS self_storage_units_zone_idx ON self_storage_units (zone_id);
CREATE INDEX IF NOT EXISTS self_storage_units_type_idx ON self_storage_units (unit_type_id) WHERE unit_type_id IS NOT NULL;
-- Un elemento del SVG identifica a UN solo trastero del centro
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_units_shape_uq
  ON self_storage_units (center_id, floor_plan_shape_id) WHERE floor_plan_shape_id IS NOT NULL;

-- Clientes
CREATE INDEX IF NOT EXISTS self_storage_customers_email_idx ON self_storage_customers (empresa_id, lower(email));
CREATE INDEX IF NOT EXISTS self_storage_customers_status_idx ON self_storage_customers (empresa_id, status);
-- Un teléfono autorizado para abrir identifica a UN cliente por empresa
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_customer_phones_access_uq
  ON self_storage_customer_phones (empresa_id, phone_e164) WHERE allow_door_access;

-- ⚑ ANTI DOBLE CONTRATACIÓN (1/2): como mucho una reserva ACTIVA por trastero.
-- La caducidad no puede ir en el índice (now() no es inmutable): el servicio de
-- reservas marca `expired` las caducadas DENTRO de la misma transacción, con el
-- trastero bloqueado con FOR UPDATE, antes de insertar la nueva.
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_reservations_active_unit_uq
  ON self_storage_reservations (storage_unit_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS self_storage_reservations_expiry_idx
  ON self_storage_reservations (expires_at) WHERE status = 'active';

-- ⚑ ANTI DOBLE CONTRATACIÓN (2/2): como mucho un contrato VIVO por trastero.
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_contracts_live_unit_uq
  ON self_storage_contracts (storage_unit_id)
  WHERE status IN ('pending_signature','pending_payment','active','suspended');
CREATE INDEX IF NOT EXISTS self_storage_contracts_customer_idx ON self_storage_contracts (customer_id, status);
CREATE INDEX IF NOT EXISTS self_storage_contracts_status_idx ON self_storage_contracts (empresa_id, status);

-- Personas autorizadas: un teléfono no se repite en el mismo contrato
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_contract_members_phone_uq
  ON self_storage_contract_members (contract_id, phone_e164)
  WHERE phone_e164 IS NOT NULL AND status <> 'revoked';
CREATE INDEX IF NOT EXISTS self_storage_contract_members_contract_idx ON self_storage_contract_members (contract_id);

-- Plano
CREATE INDEX IF NOT EXISTS self_storage_floor_plans_center_idx ON self_storage_floor_plans (center_id, version DESC);

-- Auditoría
CREATE INDEX IF NOT EXISTS self_storage_audit_logs_entity_idx ON self_storage_audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_audit_logs_ts_idx ON self_storage_audit_logs (empresa_id, occurred_at DESC);

-- Importación
CREATE INDEX IF NOT EXISTS self_storage_unit_imports_center_idx ON self_storage_unit_imports (center_id, created_at DESC);


-- ── Triggers ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'self_storage_centers','self_storage_zones','self_storage_unit_types','self_storage_units',
    'self_storage_customers','self_storage_reservations','self_storage_contracts',
    'self_storage_contract_members'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION self_storage_touch_updated_at()',
      t || '_touch', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS self_storage_units_type_center ON self_storage_units;
CREATE TRIGGER self_storage_units_type_center
  BEFORE INSERT OR UPDATE OF unit_type_id, center_id ON self_storage_units
  FOR EACH ROW EXECUTE FUNCTION self_storage_units_check_type();

-- Sólo inserción: auditoría y versiones del plano
DROP TRIGGER IF EXISTS self_storage_audit_logs_immutable ON self_storage_audit_logs;
CREATE TRIGGER self_storage_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON self_storage_audit_logs
  FOR EACH ROW EXECUTE FUNCTION self_storage_forbid_mutation();

DROP TRIGGER IF EXISTS self_storage_floor_plans_immutable ON self_storage_floor_plans;
CREATE TRIGGER self_storage_floor_plans_immutable
  BEFORE UPDATE OR DELETE ON self_storage_floor_plans
  FOR EACH ROW EXECUTE FUNCTION self_storage_forbid_mutation();
