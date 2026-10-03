-- =============================================================================
-- Mobilink Self Storage · 0006 · Fase 2: tablas de facturación y cobro
-- =============================================================================

-- ── Catálogo de conceptos facturables ────────────────────────────────────────
-- El tratamiento fiscal es POR CONCEPTO y configurable: el código no decide si
-- una fianza lleva IVA. `default_price` es base imponible.
CREATE TABLE IF NOT EXISTS self_storage_billing_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  code                  text NOT NULL,
  name                  text NOT NULL,
  item_type             self_storage_invoice_item_type NOT NULL,
  default_price         numeric(12,2) NOT NULL DEFAULT 0,
  tax_rate              numeric(5,2)  NOT NULL,
  tax_exemption_reason  text NULL,       -- motivo legal si no lleva IVA
  is_recurring          boolean NOT NULL DEFAULT false,
  is_rental_component   boolean NOT NULL DEFAULT false,  -- forma parte de la cuota mensual
  active                boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_billing_items_code_uq UNIQUE (empresa_id, code),
  CONSTRAINT self_storage_billing_items_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_billing_items_code_chk CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
  CONSTRAINT self_storage_billing_items_tax_chk CHECK (tax_rate >= 0 AND tax_rate <= 100),
  -- Un descuento resta; el resto de conceptos, no.
  CONSTRAINT self_storage_billing_items_price_chk CHECK (
    (item_type = 'discount' AND default_price <= 0) OR (item_type <> 'discount' AND default_price >= 0)
  ),
  CONSTRAINT self_storage_billing_items_rental_chk CHECK (NOT is_rental_component OR is_recurring)
);

-- ── Conceptos adicionales de un contrato (seguro, candado, alta, descuento…) ──
-- El alquiler y la fianza van en el propio contrato (monthly_price,
-- deposit_amount); aquí sólo lo que se suma.
CREATE TABLE IF NOT EXISTS self_storage_contract_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  contract_id      uuid NOT NULL,
  billing_item_id  uuid NULL,
  item_type        self_storage_invoice_item_type NOT NULL,
  description      text NOT NULL,
  quantity         numeric(10,3) NOT NULL DEFAULT 1,
  unit_price       numeric(12,2) NOT NULL,     -- base
  tax_rate         numeric(5,2)  NOT NULL,
  is_recurring     boolean NOT NULL,
  stripe_product_id text NULL,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_contract_items_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_contract_items_billing_fk FOREIGN KEY (billing_item_id, empresa_id)
    REFERENCES self_storage_billing_items (id, empresa_id),
  CONSTRAINT self_storage_contract_items_qty_chk CHECK (quantity > 0),
  CONSTRAINT self_storage_contract_items_tax_chk CHECK (tax_rate >= 0 AND tax_rate <= 100),
  CONSTRAINT self_storage_contract_items_rental_chk CHECK (item_type NOT IN ('rental','deposit'))
);

-- ── Documentos del contrato ──────────────────────────────────────────────────
-- Cada versión es un PDF con la instantánea de lo que se acepta. Una vez
-- `final` (firmado/aceptado) no se toca: un cambio importante es otro
-- documento (anexo).
CREATE TABLE IF NOT EXISTS self_storage_contract_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  contract_id         uuid NOT NULL,
  customer_id         uuid NOT NULL,
  document_type       self_storage_document_type NOT NULL,
  version             integer NOT NULL,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','final','superseded')),
  terms_version       text NOT NULL,
  snapshot            jsonb NOT NULL,
  storage_path        text NOT NULL,
  file_name           text NOT NULL,
  size_bytes          integer NOT NULL CHECK (size_bytes > 0),
  sha256              text NOT NULL,
  accepted_at         timestamptz NULL,
  accepted_by_type    text NULL CHECK (accepted_by_type IS NULL OR accepted_by_type IN ('staff','customer')),
  accepted_by_id      uuid NULL,
  accepted_name       text NULL,
  accepted_ip         text NULL,
  accepted_user_agent text NULL,
  created_by          uuid NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_contract_documents_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_contract_documents_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id),
  CONSTRAINT self_storage_contract_documents_version_uq UNIQUE (contract_id, document_type, version),
  CONSTRAINT self_storage_contract_documents_final_chk CHECK (
    status <> 'final' OR (accepted_at IS NOT NULL AND accepted_by_type IS NOT NULL AND accepted_name IS NOT NULL)
  )
);

-- ── Numeradores (por empresa, serie y año) ───────────────────────────────────
-- Se incrementan con INSERT … ON CONFLICT DO UPDATE … RETURNING: la fila queda
-- bloqueada hasta el COMMIT, así que dos emisiones a la vez se ordenan y
-- ninguna repite número. Si la transacción hace ROLLBACK, el número vuelve.
CREATE TABLE IF NOT EXISTS self_storage_sequences (
  empresa_id  uuid NOT NULL,
  series      text NOT NULL,
  year        integer NOT NULL,
  last_value  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, series, year),
  CONSTRAINT self_storage_sequences_series_chk CHECK (series ~ '^[A-Z]{1,5}$')
);

-- ── Facturas ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  customer_id           uuid NOT NULL,
  contract_id           uuid NULL,
  kind                  text NOT NULL CHECK (kind IN ('rent','one_off','rectifying')),
  collection_method     self_storage_collection_method NOT NULL,
  series                text NULL,
  invoice_number        text NULL,
  issue_date            date NULL,
  due_date              date NULL,
  billing_period_start  date NULL,
  billing_period_end    date NULL,
  subtotal              numeric(12,2) NOT NULL DEFAULT 0,
  tax                   numeric(12,2) NOT NULL DEFAULT 0,
  total                 numeric(12,2) NOT NULL DEFAULT 0,
  currency              char(3) NOT NULL DEFAULT 'EUR',
  status                self_storage_invoice_status NOT NULL DEFAULT 'draft',
  -- Instantánea fiscal, congelada al emitir.
  customer_name         text NULL,
  customer_tax_id       text NULL,
  customer_address      text NULL,
  issuer_name           text NULL,
  issuer_tax_id         text NULL,
  issuer_address        text NULL,
  stripe_invoice_id     text NULL,
  stripe_hosted_url     text NULL,
  pdf_path              text NULL,
  pdf_sha256            text NULL,
  rectifies_invoice_id  uuid NULL REFERENCES self_storage_invoices(id),
  rectification_reason  text NULL,
  paid_at               timestamptz NULL,
  cancelled_at          timestamptz NULL,
  notes                 text NULL,
  created_by            uuid NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_invoices_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_invoices_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_invoices_number_uq UNIQUE (empresa_id, invoice_number),
  CONSTRAINT self_storage_invoices_stripe_uq UNIQUE (stripe_invoice_id),
  CONSTRAINT self_storage_invoices_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_invoices_totals_chk CHECK (total = subtotal + tax),
  CONSTRAINT self_storage_invoices_issued_chk CHECK (
    status = 'draft' OR (invoice_number IS NOT NULL AND issue_date IS NOT NULL AND series IS NOT NULL
                         AND customer_name IS NOT NULL AND customer_tax_id IS NOT NULL
                         AND issuer_name IS NOT NULL AND issuer_tax_id IS NOT NULL)
  ),
  CONSTRAINT self_storage_invoices_paid_chk CHECK (status <> 'paid' OR paid_at IS NOT NULL),
  CONSTRAINT self_storage_invoices_rent_chk CHECK (
    kind <> 'rent' OR (contract_id IS NOT NULL AND billing_period_start IS NOT NULL AND billing_period_end IS NOT NULL)
  ),
  CONSTRAINT self_storage_invoices_period_chk CHECK (
    billing_period_end IS NULL OR billing_period_start IS NULL OR billing_period_end >= billing_period_start
  ),
  CONSTRAINT self_storage_invoices_rect_chk CHECK ((kind = 'rectifying') = (rectifies_invoice_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS self_storage_invoice_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES self_storage_invoices(id) ON DELETE CASCADE,
  billing_item_id  uuid NULL REFERENCES self_storage_billing_items(id),
  item_type        self_storage_invoice_item_type NOT NULL,
  description      text NOT NULL,
  quantity         numeric(10,3) NOT NULL,
  unit_price       numeric(12,2) NOT NULL,
  tax_rate         numeric(5,2)  NOT NULL,
  subtotal         numeric(12,2) NOT NULL,
  tax_amount       numeric(12,2) NOT NULL,
  total            numeric(12,2) NOT NULL,
  period_start     date NULL,
  period_end       date NULL,
  sort_order       integer NOT NULL DEFAULT 0,
  CONSTRAINT self_storage_invoice_items_totals_chk CHECK (total = subtotal + tax_amount),
  CONSTRAINT self_storage_invoice_items_tax_chk CHECK (tax_rate >= 0 AND tax_rate <= 100),
  CONSTRAINT self_storage_invoice_items_qty_chk CHECK (quantity <> 0)
);

-- ── Pagos ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_payments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL,
  customer_id               uuid NOT NULL,
  contract_id               uuid NULL,
  invoice_id                uuid NULL,
  amount                    numeric(12,2) NOT NULL CHECK (amount > 0),
  refunded_amount           numeric(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  currency                  char(3) NOT NULL DEFAULT 'EUR',
  payment_method            self_storage_payment_method NOT NULL,
  stripe_payment_intent_id  text NULL,
  stripe_charge_id          text NULL,
  stripe_invoice_id         text NULL,
  status                    self_storage_payment_status NOT NULL DEFAULT 'pending',
  paid_at                   timestamptz NULL,
  failure_reason            text NULL,
  -- Pago manual: quién lo registró. Un cliente nunca registra un pago.
  recorded_by               uuid NULL,
  notes                     text NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_payments_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_payments_invoice_fk FOREIGN KEY (invoice_id, empresa_id)
    REFERENCES self_storage_invoices (id, empresa_id),
  CONSTRAINT self_storage_payments_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id),
  CONSTRAINT self_storage_payments_pi_uq UNIQUE (stripe_payment_intent_id),
  CONSTRAINT self_storage_payments_charge_uq UNIQUE (stripe_charge_id),
  CONSTRAINT self_storage_payments_paid_chk CHECK (status <> 'succeeded' OR paid_at IS NOT NULL),
  CONSTRAINT self_storage_payments_refund_chk CHECK (refunded_amount <= amount),
  -- Un pago con tarjeta o SEPA viene de Stripe; uno en efectivo o por
  -- transferencia lo registra un empleado. Nunca el frontend del cliente.
  CONSTRAINT self_storage_payments_origin_chk CHECK (
    (payment_method IN ('card','sepa') AND (stripe_payment_intent_id IS NOT NULL OR stripe_invoice_id IS NOT NULL))
    OR (payment_method IN ('bank_transfer','cash') AND recorded_by IS NOT NULL)
  )
);

-- ── Eventos de Stripe (idempotencia) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_stripe_events (
  event_id           text PRIMARY KEY,
  event_type         text NOT NULL,
  livemode           boolean NOT NULL DEFAULT false,
  payload            jsonb NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz NULL,
  processing_status  self_storage_stripe_event_status NOT NULL DEFAULT 'received',
  error_message      text NULL,
  attempts           integer NOT NULL DEFAULT 0
);

-- ── Bloqueos de acceso, uno por motivo ───────────────────────────────────────
-- Varios a la vez. Un pago sólo levanta los de motivo `payment`; `security` y
-- `manual` sólo los levanta una persona.
CREATE TABLE IF NOT EXISTS self_storage_access_blocks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  customer_id      uuid NOT NULL,
  contract_id      uuid NULL,
  reason           self_storage_block_reason NOT NULL,
  source           text NOT NULL CHECK (source IN ('system','staff')),
  notes            text NULL,
  dunning_case_id  uuid NULL,
  created_by       uuid NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  lifted_at        timestamptz NULL,
  lifted_by        uuid NULL,
  lift_reason      text NULL,
  CONSTRAINT self_storage_access_blocks_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id),
  CONSTRAINT self_storage_access_blocks_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id),
  CONSTRAINT self_storage_access_blocks_lift_chk CHECK ((lifted_at IS NULL) = (lift_reason IS NULL))
);

-- ── Impagos ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_dunning_cases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  customer_id       uuid NOT NULL,
  contract_id       uuid NULL,
  invoice_id        uuid NOT NULL,
  status            self_storage_dunning_status NOT NULL DEFAULT 'open',
  opened_at         timestamptz NOT NULL DEFAULT now(),   -- día 0
  failure_reason    text NULL,
  first_notice_at   timestamptz NULL,
  second_notice_at  timestamptz NULL,
  suspended_at      timestamptz NULL,
  resolved_at       timestamptz NULL,
  resolution        text NULL,
  CONSTRAINT self_storage_dunning_cases_invoice_fk FOREIGN KEY (invoice_id, empresa_id)
    REFERENCES self_storage_invoices (id, empresa_id),
  CONSTRAINT self_storage_dunning_cases_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id),
  CONSTRAINT self_storage_dunning_cases_resolved_chk CHECK ((status = 'open') = (resolved_at IS NULL))
);

DO $$ BEGIN
  ALTER TABLE self_storage_access_blocks ADD CONSTRAINT self_storage_access_blocks_dunning_fk
    FOREIGN KEY (dunning_case_id) REFERENCES self_storage_dunning_cases(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Notificaciones (bandeja de salida) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  customer_id   uuid NULL,
  contract_id   uuid NULL,
  invoice_id    uuid NULL,
  template      text NOT NULL,
  channel       text NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  recipient     text NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  status        self_storage_notification_status NOT NULL DEFAULT 'pending',
  -- 'invoice.issued:<id>': la misma notificación no se crea dos veces.
  dedupe_key    text NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz NULL,
  CONSTRAINT self_storage_notifications_dedupe_uq UNIQUE (empresa_id, dedupe_key)
);


-- ── Índices ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS self_storage_contract_items_contract_idx ON self_storage_contract_items (contract_id);
CREATE INDEX IF NOT EXISTS self_storage_contract_documents_contract_idx ON self_storage_contract_documents (contract_id, created_at);

-- ⚑ Un periodo de alquiler se factura UNA vez por contrato (salvo anuladas).
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_invoices_rent_period_uq
  ON self_storage_invoices (contract_id, billing_period_start)
  WHERE kind = 'rent' AND status <> 'cancelled';
CREATE INDEX IF NOT EXISTS self_storage_invoices_customer_idx ON self_storage_invoices (empresa_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_invoices_contract_idx ON self_storage_invoices (contract_id, billing_period_start);
CREATE INDEX IF NOT EXISTS self_storage_invoices_open_idx
  ON self_storage_invoices (empresa_id, due_date) WHERE status IN ('pending','overdue');
CREATE INDEX IF NOT EXISTS self_storage_invoice_items_invoice_idx ON self_storage_invoice_items (invoice_id);

-- Una factura de Stripe = un registro de pago (los reintentos lo actualizan).
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_payments_stripe_invoice_uq
  ON self_storage_payments (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_payments_customer_idx ON self_storage_payments (empresa_id, customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_payments_invoice_idx ON self_storage_payments (invoice_id);

CREATE INDEX IF NOT EXISTS self_storage_stripe_events_pending_idx
  ON self_storage_stripe_events (received_at) WHERE processing_status IN ('received','failed');

-- Un bloqueo ABIERTO por (cliente, contrato, motivo): el motor es reentrante.
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_access_blocks_open_uq
  ON self_storage_access_blocks (customer_id, COALESCE(contract_id, '00000000-0000-0000-0000-000000000000'::uuid), reason)
  WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS self_storage_access_blocks_contract_idx ON self_storage_access_blocks (contract_id) WHERE lifted_at IS NULL;

-- Un caso de impago ABIERTO por factura.
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_dunning_cases_open_uq
  ON self_storage_dunning_cases (invoice_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS self_storage_dunning_cases_contract_idx ON self_storage_dunning_cases (contract_id, status);

CREATE INDEX IF NOT EXISTS self_storage_notifications_pending_idx
  ON self_storage_notifications (created_at) WHERE status = 'pending';


-- ── Triggers ─────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['self_storage_billing_items','self_storage_invoices','self_storage_payments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION self_storage_touch_updated_at()',
      t || '_touch', t);
  END LOOP;
END $$;

-- Eventos de Stripe: el CONTENIDO no cambia; sólo su estado de proceso.
CREATE OR REPLACE FUNCTION self_storage_stripe_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'self_storage_stripe_events es de sólo inserción' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.event_id <> OLD.event_id OR NEW.event_type <> OLD.event_type OR NEW.payload <> OLD.payload
     OR NEW.received_at <> OLD.received_at THEN
    RAISE EXCEPTION 'Un evento de Stripe no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS self_storage_stripe_events_guard ON self_storage_stripe_events;
CREATE TRIGGER self_storage_stripe_events_guard BEFORE UPDATE OR DELETE ON self_storage_stripe_events
  FOR EACH ROW EXECUTE FUNCTION self_storage_stripe_events_guard();

-- Documento final: inmutable. Un borrador sólo puede pasar a final (una vez) o
-- quedar sustituido.
CREATE OR REPLACE FUNCTION self_storage_contract_documents_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los documentos de contrato no se borran' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'final' THEN
    RAISE EXCEPTION 'Un documento firmado no se modifica: se genera un anexo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.sha256 <> OLD.sha256 OR NEW.storage_path <> OLD.storage_path OR NEW.snapshot <> OLD.snapshot
     OR NEW.version <> OLD.version OR NEW.contract_id <> OLD.contract_id THEN
    RAISE EXCEPTION 'El contenido de un documento no cambia' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS self_storage_contract_documents_guard ON self_storage_contract_documents;
CREATE TRIGGER self_storage_contract_documents_guard BEFORE UPDATE OR DELETE ON self_storage_contract_documents
  FOR EACH ROW EXECUTE FUNCTION self_storage_contract_documents_guard();

-- Factura emitida: no se borra, no se renumera y su contenido fiscal no cambia.
-- Sólo pueden cambiar su estado, el cobro, el PDF y los datos de Stripe.
CREATE OR REPLACE FUNCTION self_storage_invoices_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Factura % emitida: no se borra', OLD.invoice_number USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status <> 'draft' AND (
       NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.series IS DISTINCT FROM OLD.series
    OR NEW.issue_date IS DISTINCT FROM OLD.issue_date OR NEW.customer_id <> OLD.customer_id
    OR NEW.subtotal <> OLD.subtotal OR NEW.tax <> OLD.tax OR NEW.total <> OLD.total
    OR NEW.customer_name IS DISTINCT FROM OLD.customer_name OR NEW.customer_tax_id IS DISTINCT FROM OLD.customer_tax_id
    OR NEW.customer_address IS DISTINCT FROM OLD.customer_address OR NEW.issuer_name IS DISTINCT FROM OLD.issuer_name
    OR NEW.issuer_tax_id IS DISTINCT FROM OLD.issuer_tax_id OR NEW.issuer_address IS DISTINCT FROM OLD.issuer_address
    OR NEW.billing_period_start IS DISTINCT FROM OLD.billing_period_start
    OR NEW.billing_period_end IS DISTINCT FROM OLD.billing_period_end) THEN
    RAISE EXCEPTION 'Factura % emitida: se corrige con una rectificativa', OLD.invoice_number
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Una factura emitida no vuelve a borrador' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS self_storage_invoices_guard ON self_storage_invoices;
CREATE TRIGGER self_storage_invoices_guard BEFORE UPDATE OR DELETE ON self_storage_invoices
  FOR EACH ROW EXECUTE FUNCTION self_storage_invoices_guard();

-- Las líneas de una factura emitida tampoco cambian.
CREATE OR REPLACE FUNCTION self_storage_invoice_items_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st self_storage_invoice_status;
BEGIN
  SELECT status INTO st FROM self_storage_invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF st IS NOT NULL AND st <> 'draft' THEN
    RAISE EXCEPTION 'Las líneas de una factura emitida no cambian' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS self_storage_invoice_items_guard ON self_storage_invoice_items;
CREATE TRIGGER self_storage_invoice_items_guard BEFORE INSERT OR UPDATE OR DELETE ON self_storage_invoice_items
  FOR EACH ROW EXECUTE FUNCTION self_storage_invoice_items_guard();
