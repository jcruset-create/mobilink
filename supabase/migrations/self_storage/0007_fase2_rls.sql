-- =============================================================================
-- Mobilink Self Storage · 0007 · Fase 2: RLS de las tablas nuevas
-- =============================================================================
--
-- Mismo modelo que 0004: el servidor entra como propietario; por PostgREST,
-- `anon` nada y un cliente sólo LEE lo suyo. Catálogo, numeradores, eventos
-- de Stripe, impagos y notificaciones: cerrados (RLS sin políticas).
-- =============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'self_storage_billing_items','self_storage_contract_items','self_storage_contract_documents',
    'self_storage_sequences','self_storage_invoices','self_storage_invoice_items','self_storage_payments',
    'self_storage_stripe_events','self_storage_access_blocks','self_storage_dunning_cases',
    'self_storage_notifications'
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
  -- La función la crea 0004 sólo en Supabase; sin ella no hay políticas.
  IF to_regprocedure('self_storage_current_customer_id()') IS NULL THEN
    RAISE NOTICE 'Self Storage: sin self_storage_current_customer_id(); políticas de la fase 2 no creadas';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS ss_contract_items_own ON self_storage_contract_items';
  EXECUTE $p$ CREATE POLICY ss_contract_items_own ON self_storage_contract_items
    FOR SELECT TO authenticated USING (EXISTS (
      SELECT 1 FROM self_storage_contracts c
       WHERE c.id = self_storage_contract_items.contract_id
         AND c.customer_id = self_storage_current_customer_id())) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_contract_documents_own ON self_storage_contract_documents';
  EXECUTE $p$ CREATE POLICY ss_contract_documents_own ON self_storage_contract_documents
    FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id()) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_invoices_own ON self_storage_invoices';
  EXECUTE $p$ CREATE POLICY ss_invoices_own ON self_storage_invoices
    FOR SELECT TO authenticated
    USING (customer_id = self_storage_current_customer_id() AND status <> 'draft') $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_invoice_items_own ON self_storage_invoice_items';
  EXECUTE $p$ CREATE POLICY ss_invoice_items_own ON self_storage_invoice_items
    FOR SELECT TO authenticated USING (EXISTS (
      SELECT 1 FROM self_storage_invoices i
       WHERE i.id = self_storage_invoice_items.invoice_id
         AND i.customer_id = self_storage_current_customer_id()
         AND i.status <> 'draft')) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_payments_own ON self_storage_payments';
  EXECUTE $p$ CREATE POLICY ss_payments_own ON self_storage_payments
    FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id()) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_access_blocks_own ON self_storage_access_blocks';
  EXECUTE $p$ CREATE POLICY ss_access_blocks_own ON self_storage_access_blocks
    FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id()) $p$;
END
$rls$;
