-- =============================================================================
-- Mobilink Self Storage · 0004 · Row Level Security
-- =============================================================================
--
-- Modelo:
--   · El servidor Express entra con `pg` como PROPIETARIO de las tablas, y al
--     propietario no le aplica RLS. El aislamiento del día a día lo hace el
--     servidor: el id nunca viaja solo (siempre con empresa_id, y en el portal
--     con el customer_id de la sesión) y lo ajeno contesta 404.
--   · RLS es la SEGUNDA barrera, para cualquiera que llegue con la anon key o
--     con el JWT de un usuario a través de PostgREST:
--       - anon: nada, en ninguna tabla;
--       - authenticated: sólo LECTURA, y sólo de lo que pertenece al cliente
--         de Self Storage vinculado a ese usuario (auth_user_id). Un empleado
--         no tiene cliente vinculado, así que por aquí no ve nada: lo suyo va
--         por la API;
--       - nadie escribe por PostgREST.
--   · Tablas internas (settings, auditoría, importaciones, plano): RLS activado
--     y SIN políticas, es decir, cerradas para todo el que no sea propietario.
--
-- Fuera de Supabase (PostgreSQL de desarrollo o de la CI) no existen `auth.uid()`
-- ni los roles `anon`/`authenticated`: el RLS se activa igual, pero las
-- políticas y los REVOKE se saltan con un aviso. Las pruebas de RLS crean un
-- `auth.uid()` equivalente al de Supabase y vuelven a aplicar este fichero.
-- =============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'self_storage_settings','self_storage_centers','self_storage_zones','self_storage_unit_types',
    'self_storage_units','self_storage_floor_plans','self_storage_customers',
    'self_storage_customer_phones','self_storage_reservations','self_storage_contracts',
    'self_storage_contract_members','self_storage_audit_logs','self_storage_unit_imports',
    'self_storage_unit_import_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

DO $rls$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE NOTICE 'Self Storage: sin auth.uid() ni rol authenticated (no es Supabase); políticas RLS no creadas';
    RETURN;
  END IF;

  -- El cliente de Self Storage del usuario autenticado. SECURITY DEFINER para
  -- poder leer la tabla de clientes sin abrirle una política más amplia.
  EXECUTE $f$
    CREATE OR REPLACE FUNCTION self_storage_current_customer_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $body$
      SELECT id FROM self_storage_customers WHERE auth_user_id = auth.uid() LIMIT 1
    $body$
  $f$;
  EXECUTE 'REVOKE ALL ON FUNCTION self_storage_current_customer_id() FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION self_storage_current_customer_id() TO authenticated';

  EXECUTE 'DROP POLICY IF EXISTS ss_customers_own ON self_storage_customers';
  EXECUTE $p$ CREATE POLICY ss_customers_own ON self_storage_customers
    FOR SELECT TO authenticated USING (id = self_storage_current_customer_id()) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_customer_phones_own ON self_storage_customer_phones';
  EXECUTE $p$ CREATE POLICY ss_customer_phones_own ON self_storage_customer_phones
    FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id()) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_reservations_own ON self_storage_reservations';
  EXECUTE $p$ CREATE POLICY ss_reservations_own ON self_storage_reservations
    FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id()) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_contracts_own ON self_storage_contracts';
  EXECUTE $p$ CREATE POLICY ss_contracts_own ON self_storage_contracts
    FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id()) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_contract_members_own ON self_storage_contract_members';
  EXECUTE $p$ CREATE POLICY ss_contract_members_own ON self_storage_contract_members
    FOR SELECT TO authenticated USING (EXISTS (
      SELECT 1 FROM self_storage_contracts c
       WHERE c.id = self_storage_contract_members.contract_id
         AND c.customer_id = self_storage_current_customer_id())) $p$;

  -- El trastero, sólo si tiene (o tuvo) un contrato suyo.
  EXECUTE 'DROP POLICY IF EXISTS ss_units_own ON self_storage_units';
  EXECUTE $p$ CREATE POLICY ss_units_own ON self_storage_units
    FOR SELECT TO authenticated USING (EXISTS (
      SELECT 1 FROM self_storage_contracts c
       WHERE c.storage_unit_id = self_storage_units.id
         AND c.customer_id = self_storage_current_customer_id())) $p$;

  -- Centro y zona de sus trasteros (nombre y dirección para el portal).
  EXECUTE 'DROP POLICY IF EXISTS ss_centers_own ON self_storage_centers';
  EXECUTE $p$ CREATE POLICY ss_centers_own ON self_storage_centers
    FOR SELECT TO authenticated USING (EXISTS (
      SELECT 1 FROM self_storage_contracts c
       WHERE c.center_id = self_storage_centers.id
         AND c.customer_id = self_storage_current_customer_id())) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_zones_own ON self_storage_zones';
  EXECUTE $p$ CREATE POLICY ss_zones_own ON self_storage_zones
    FOR SELECT TO authenticated USING (EXISTS (
      SELECT 1 FROM self_storage_contracts c
        JOIN self_storage_units u ON u.id = c.storage_unit_id
       WHERE u.zone_id = self_storage_zones.id
         AND c.customer_id = self_storage_current_customer_id())) $p$;
END
$rls$;
