-- =============================================================================
-- Mobilink Self Storage · 0005 · Fase 2: enums y columnas de contrato
-- =============================================================================
--
-- Contratos + facturación + pagos + Stripe. Las tablas nuevas van en 0006 y su
-- RLS en 0007. Todo idempotente: se aplica en cada arranque.
-- =============================================================================

-- ── Motivos de bloqueo con los nombres confirmados ──────────────────────────
-- La fase 1 creó el tipo con 'non_payment' y 'contract_ended' sin que ninguna
-- tabla lo usara. Se renombran a 'payment' y 'terminated' (RENAME VALUE
-- conserva el tipo; condicionado para que sea idempotente).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = 'self_storage_block_reason' AND e.enumlabel = 'non_payment') THEN
    ALTER TYPE self_storage_block_reason RENAME VALUE 'non_payment' TO 'payment';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
              WHERE t.typname = 'self_storage_block_reason' AND e.enumlabel = 'contract_ended') THEN
    ALTER TYPE self_storage_block_reason RENAME VALUE 'contract_ended' TO 'terminated';
  END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_invoice_status AS ENUM ('draft','pending','paid','overdue','cancelled','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_invoice_item_type AS ENUM
    ('rental','deposit','insurance','lock','penalty','discount','setup_fee','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_payment_method AS ENUM ('card','sepa','bank_transfer','cash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_payment_status AS ENUM ('pending','processing','succeeded','failed','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Quién cobra: Stripe (tarjeta / SEPA, con suscripción) o la oficina
-- (transferencia / efectivo, con facturas que emite Mobilink).
DO $$ BEGIN
  CREATE TYPE self_storage_collection_method AS ENUM ('stripe','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_stripe_event_status AS ENUM ('received','processed','failed','ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_document_type AS ENUM ('contract','annex','termination');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_dunning_status AS ENUM ('open','resolved','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE self_storage_notification_status AS ENUM ('pending','sent','failed','skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── Contratos: lo que la fase 2 necesita ─────────────────────────────────────
-- En producción la tabla existe vacía (la fase 1 no tenía endpoints de
-- contratos), pero las columnas nuevas van con defecto o NULL igualmente.
ALTER TABLE self_storage_contracts
  -- Precio estándar del trastero en el momento de crear el contrato. El
  -- contratado (monthly_price) puede ser distinto: precio comercial.
  ADD COLUMN IF NOT EXISTS list_monthly_price         numeric(12,2) NULL,
  ADD COLUMN IF NOT EXISTS monthly_price_gross        numeric(12,2) NULL,
  -- IVA de la fianza, copiado del concepto «fianza» del catálogo al crear.
  ADD COLUMN IF NOT EXISTS deposit_tax_rate           numeric(5,2)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billing_period             text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS payment_method             self_storage_payment_method NULL,
  ADD COLUMN IF NOT EXISTS collection_method          self_storage_collection_method NOT NULL DEFAULT 'manual',
  -- Firma / aceptación simple
  ADD COLUMN IF NOT EXISTS terms_version              text NULL,
  ADD COLUMN IF NOT EXISTS signature_name             text NULL,
  ADD COLUMN IF NOT EXISTS signature_ip               text NULL,
  ADD COLUMN IF NOT EXISTS signature_user_agent       text NULL,
  ADD COLUMN IF NOT EXISTS signed_by_type             text NULL,
  ADD COLUMN IF NOT EXISTS signed_by_id               uuid NULL,
  ADD COLUMN IF NOT EXISTS signed_document_id         uuid NULL,
  -- Stripe
  ADD COLUMN IF NOT EXISTS stripe_subscription_status text NULL,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text NULL,
  ADD COLUMN IF NOT EXISTS subscription_cancel_requested_at timestamptz NULL,
  -- Productos de Stripe creados para este contrato → qué concepto y qué IVA
  -- son. Con esto, una línea de una factura de Stripe se traduce a una línea
  -- de nuestra factura sin preguntar a Stripe.
  ADD COLUMN IF NOT EXISTS stripe_products            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Primer cobro SEPA: la política se COPIA al contrato al crearlo, para que
  -- cambiar el ajuste no cambie las reglas de un contrato ya en marcha.
  ADD COLUMN IF NOT EXISTS first_sepa_payment_access_policy text NOT NULL DEFAULT 'wait_for_success',
  ADD COLUMN IF NOT EXISTS first_payment_status       self_storage_payment_status NULL,
  -- Activación administrativa (excepción a la política), siempre auditada.
  ADD COLUMN IF NOT EXISTS activation_override_at     timestamptz NULL,
  ADD COLUMN IF NOT EXISTS activation_override_by     uuid NULL,
  ADD COLUMN IF NOT EXISTS activation_override_reason text NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at               timestamptz NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason        text NULL,
  -- Facturación manual: siguiente periodo por facturar.
  ADD COLUMN IF NOT EXISTS next_invoice_date          date NULL;

DO $$ BEGIN
  ALTER TABLE self_storage_contracts ADD CONSTRAINT self_storage_contracts_period_chk CHECK (billing_period = 'monthly') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE self_storage_contracts ADD CONSTRAINT self_storage_contracts_sepa_policy_chk
    CHECK (first_sepa_payment_access_policy IN ('wait_for_success','allow_while_processing')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE self_storage_contracts ADD CONSTRAINT self_storage_contracts_collection_chk CHECK (
    payment_method IS NULL
    OR (collection_method = 'stripe' AND payment_method IN ('card','sepa'))
    OR (collection_method = 'manual' AND payment_method IN ('bank_transfer','cash'))
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE self_storage_contracts ADD CONSTRAINT self_storage_contracts_gross_chk CHECK (
    monthly_price_gross IS NULL OR abs(monthly_price_gross - monthly_price * (1 + tax_rate / 100)) <= 0.01
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE self_storage_contracts ADD CONSTRAINT self_storage_contracts_cancelled_chk CHECK (
    status <> 'cancelled' OR cancelled_at IS NOT NULL
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Las restricciones van NOT VALID: se exigen a toda escritura nueva sin
-- revalidar filas anteriores a la fase 2 (en producción no hay ninguna; en
-- una base de desarrollo puede haberlas).
--
-- Un contrato activo tiene cliente y trastero (NOT NULL ya lo garantiza) y,
-- además, fecha de activación.
DO $$ BEGIN
  ALTER TABLE self_storage_contracts ADD CONSTRAINT self_storage_contracts_active_chk CHECK (
    status NOT IN ('active','suspended','terminated') OR activated_at IS NOT NULL
  ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
