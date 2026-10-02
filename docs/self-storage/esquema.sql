-- =============================================================================
-- Mobilink Self Storage — PROPUESTA de esquema PostgreSQL (fase de diseño)
-- =============================================================================
--
-- Estado: BORRADOR PARA REVISIÓN. Todavía no lo ejecuta nada.
--
-- Cuando se confirme, este contenido pasa a `server/self-storage/schema/*.sql`
-- y se aplica al arrancar con `prepararEsquema("Self Storage", ...)`, como el
-- resto de módulos (ver ARCHITECTURE.md §14). Por eso todo es idempotente:
-- `IF NOT EXISTS`, tipos creados dentro de bloques DO, políticas con DROP+CREATE.
--
-- Convenciones:
--   · prefijo `self_storage_` en tablas, tipos, funciones y triggers;
--   · snake_case (igual que `rcp_*` de Recepciones);
--   · importes en EUR con numeric(12,2); a Stripe se le pasan céntimos en la
--     frontera (`toCents`/`fromCents`), nunca se guardan céntimos aquí;
--   · timestamptz para instantes, date para fechas de calendario;
--   · `empresa_id` = tenant de plataforma (`app_empresas`). NO es un cliente:
--     los clientes de este módulo viven SOLO en `self_storage_customers`.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest()

-- -----------------------------------------------------------------------------
-- 1. ENUMS
-- -----------------------------------------------------------------------------
-- Tipos ENUM de PostgreSQL (pedidos explícitamente). Añadir un valor:
--   ALTER TYPE self_storage_x ADD VALUE IF NOT EXISTS 'nuevo';
-- Quitar un valor no es posible sin recrear el tipo: se acepta ese coste.

DO $$ BEGIN
  CREATE TYPE self_storage_staff_role       AS ENUM ('superadmin','admin','employee','maintenance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_record_status    AS ENUM ('active','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_unit_status      AS ENUM ('available','reserved','occupied','maintenance','blocked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_customer_type    AS ENUM ('individual','company');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_customer_status  AS ENUM ('active','blocked','inactive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_reservation_status AS ENUM ('active','converted','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_contract_status  AS ENUM ('draft','pending_signature','pending_payment','active','suspended','terminated','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_document_type    AS ENUM ('contract_draft','contract_signed','annex','termination','id_document','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_invoice_status   AS ENUM ('draft','pending','paid','overdue','cancelled','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_invoice_item_type AS ENUM ('rent','deposit','fee','discount','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_payment_method   AS ENUM ('card','sepa','bank_transfer','cash');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_payment_status   AS ENUM ('pending','processing','succeeded','failed','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_door_type        AS ENUM ('main','zone','internal','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_door_status      AS ENUM ('active','disabled','maintenance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_device_driver    AS ENUM ('rut_http','rms','mock');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_device_status    AS ENUM ('online','offline','unknown','disabled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_permission_status AS ENUM ('enabled','blocked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_block_reason     AS ENUM ('non_payment','security','incident','contract_ended','manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_access_method    AS ENUM ('app','phone','admin','temporary');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_access_result    AS ENUM ('granted','denied');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_temp_access_status AS ENUM ('active','suspended','expired','revoked','exhausted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_incident_status  AS ENUM ('open','in_progress','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_incident_type    AS ENUM ('maintenance','security','damage','access','billing','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_priority         AS ENUM ('low','normal','high','urgent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_notification_channel AS ENUM ('email','sms','whatsapp','internal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_notification_status  AS ENUM ('pending','sent','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_actor_type       AS ENUM ('staff','customer','guest','system','stripe','device');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_stripe_event_status AS ENUM ('received','processing','processed','failed','ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE self_storage_import_status    AS ENUM ('uploaded','validated','applied','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- -----------------------------------------------------------------------------
-- 2. FUNCIONES AUXILIARES
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION self_storage_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Tablas de sólo-inserción (eventos de acceso, auditoría): igual que
-- `assistance_events` y `rcp_eventos`, la inmutabilidad la impone la base.
CREATE OR REPLACE FUNCTION self_storage_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% es de sólo inserción', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;


-- -----------------------------------------------------------------------------
-- 3. TABLAS
-- -----------------------------------------------------------------------------

-- 3.1 Configuración ----------------------------------------------------------
-- Clave/valor tipado por código (`server/self-storage/modules/settings/schema.ts`
-- valida cada clave con zod). center_id NULL = valor por defecto de la empresa;
-- una fila con center_id lo sobreescribe para ese centro.
CREATE TABLE IF NOT EXISTS self_storage_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  center_id   uuid NULL,                     -- FK añadida tras crear centers
  key         text NOT NULL,
  value       jsonb NOT NULL,
  updated_by  uuid NULL,                     -- auth.users.id del empleado
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_settings_key_chk CHECK (key ~ '^[a-z0-9_.]+$')
);

-- 3.2 Centros, zonas, trasteros ---------------------------------------------
CREATE TABLE IF NOT EXISTS self_storage_centers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  code             text NOT NULL,            -- 'REUS'
  name             text NOT NULL,
  address          text NULL,
  postal_code      text NULL,
  city             text NULL,
  province         text NULL,
  country          char(2) NOT NULL DEFAULT 'ES',
  timezone         text NOT NULL DEFAULT 'Europe/Madrid',
  phone            text NULL,
  email            text NULL,
  -- Horario de acceso por defecto: {"mon":[["06:00","23:00"]], ...}. Vacío = 24h.
  access_schedule  jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- SVG del plano en Storage privado (se sirve sanitizado por la API).
  floor_plan_path  text NULL,
  floor_plan_version integer NOT NULL DEFAULT 0,
  public_visible   boolean NOT NULL DEFAULT false,
  status           self_storage_record_status NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_centers_code_uq UNIQUE (empresa_id, code),
  CONSTRAINT self_storage_centers_id_empresa_uq UNIQUE (id, empresa_id)
);

CREATE TABLE IF NOT EXISTS self_storage_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid NOT NULL REFERENCES self_storage_centers(id) ON DELETE RESTRICT,
  code        text NOT NULL,                 -- 'Z2'
  name        text NOT NULL,                 -- 'Zona 2'
  floor       text NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  status      self_storage_record_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_zones_code_uq UNIQUE (center_id, code),
  -- Permite FKs compuestas (zone_id, center_id): una zona de otro centro
  -- no puede colarse en un trastero o una puerta.
  CONSTRAINT self_storage_zones_id_center_uq UNIQUE (id, center_id)
);

CREATE TABLE IF NOT EXISTS self_storage_units (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id           uuid NOT NULL REFERENCES self_storage_centers(id) ON DELETE RESTRICT,
  zone_id             uuid NOT NULL,
  code                text NOT NULL,         -- número de trastero: '2-014'
  name                text NULL,
  size_category       text NULL,             -- 'S','M','L','XL' (agrupa en la web)
  width_cm            integer NOT NULL,
  length_cm           integer NOT NULL,
  height_cm           integer NOT NULL,
  -- m² y m³ se GUARDAN (no columnas generadas): el CSV de Reus trae los
  -- comerciales, que pueden no coincidir con ancho×largo en trasteros
  -- irregulares. Si no vienen, el servicio los calcula.
  area_m2             numeric(8,2) NOT NULL,
  volume_m3           numeric(8,2) NOT NULL,
  monthly_price       numeric(12,2) NOT NULL,   -- BASE IMPONIBLE mensual (sin IVA)
  tax_rate            numeric(5,2)  NOT NULL DEFAULT 21.00,
  monthly_price_gross numeric(12,2) GENERATED ALWAYS AS
                        (round(monthly_price * (1 + tax_rate / 100), 2)) STORED,  -- PVP
  deposit_amount      numeric(12,2) NOT NULL DEFAULT 0,   -- fianza (sin IVA)
  status              self_storage_unit_status NOT NULL DEFAULT 'available',
  image_3d_url        text NULL,
  floor_plan_shape_id text NULL,             -- id del elemento SVG
  public_visible      boolean NOT NULL DEFAULT true,
  notes               text NULL,             -- interno, NUNCA en la API pública
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_units_zone_fk FOREIGN KEY (zone_id, center_id)
    REFERENCES self_storage_zones (id, center_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_units_code_uq UNIQUE (center_id, code),
  CONSTRAINT self_storage_units_dims_chk CHECK (width_cm > 0 AND length_cm > 0 AND height_cm > 0),
  CONSTRAINT self_storage_units_measures_chk CHECK (area_m2 > 0 AND volume_m3 > 0),
  CONSTRAINT self_storage_units_price_chk CHECK (monthly_price >= 0 AND deposit_amount >= 0),
  CONSTRAINT self_storage_units_tax_chk CHECK (tax_rate >= 0 AND tax_rate <= 100)
);

-- 3.3 Clientes (dominio PROPIO, sin relación con ninguna otra tabla de clientes)
CREATE TABLE IF NOT EXISTS self_storage_customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  customer_type       self_storage_customer_type NOT NULL,
  first_name          text NULL,             -- individual: obligatorio
  last_name           text NULL,             -- individual: obligatorio
  company_name        text NULL,             -- company: obligatorio (razón social)
  tax_id              text NOT NULL,         -- DNI/NIE/CIF normalizado (mayúsculas, sin guiones)
  phone               text NOT NULL,         -- teléfono de contacto principal (E.164)
  email               text NOT NULL,
  address             text NULL,
  postal_code         text NULL,
  city                text NULL,
  province            text NULL,
  country             char(2) NOT NULL DEFAULT 'ES',
  status              self_storage_customer_status NOT NULL DEFAULT 'inactive',
  stripe_customer_id  text NULL,
  -- Cuenta del portal: usuario de Supabase Auth. NO es un usuario interno:
  -- nunca aparece en app_usuarios ni en app_usuario_modulos.
  auth_user_id        uuid NULL,
  notes               text NULL,
  created_by          uuid NULL,             -- empleado (NULL = alta online)
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_customers_tax_id_uq UNIQUE (empresa_id, tax_id),
  CONSTRAINT self_storage_customers_stripe_uq UNIQUE (stripe_customer_id),
  CONSTRAINT self_storage_customers_auth_uq UNIQUE (auth_user_id),
  CONSTRAINT self_storage_customers_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_customers_names_chk CHECK (
    (customer_type = 'individual' AND first_name IS NOT NULL AND last_name IS NOT NULL)
    OR (customer_type = 'company' AND company_name IS NOT NULL)
  ),
  CONSTRAINT self_storage_customers_email_chk CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

-- Teléfonos adicionales y, sobre todo, los AUTORIZADOS para abrir por llamada.
CREATE TABLE IF NOT EXISTS self_storage_customer_phones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  customer_id        uuid NOT NULL,
  phone_e164         text NOT NULL,
  label              text NULL,              -- 'móvil', 'empleado almacén'...
  allow_door_access  boolean NOT NULL DEFAULT false,
  verified_at        timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_customer_phones_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_customer_phones_uq UNIQUE (customer_id, phone_e164),
  CONSTRAINT self_storage_customer_phones_e164_chk CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

-- 3.4 Reservas temporales (web de contratación) -------------------------------
CREATE TABLE IF NOT EXISTS self_storage_reservations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id          uuid NOT NULL REFERENCES self_storage_centers(id),
  storage_unit_id    uuid NOT NULL REFERENCES self_storage_units(id),
  customer_id        uuid NULL REFERENCES self_storage_customers(id),
  contract_id        uuid NULL,              -- FK tras crear contracts
  -- El navegador que reservó guarda el token; aquí sólo su hash.
  session_token_hash text NOT NULL,
  source             text NOT NULL DEFAULT 'online' CHECK (source IN ('online','admin')),
  status             self_storage_reservation_status NOT NULL DEFAULT 'active',
  expires_at         timestamptz NOT NULL,
  created_by         uuid NULL,              -- empleado si source='admin'
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_reservations_expiry_chk CHECK (expires_at > created_at)
);

-- 3.5 Contratos ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS self_storage_contracts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL,
  center_id                uuid NOT NULL REFERENCES self_storage_centers(id),
  contract_number          text NOT NULL,    -- 'SSC-REUS-2026-000123'
  customer_id              uuid NOT NULL,
  storage_unit_id          uuid NOT NULL REFERENCES self_storage_units(id),
  reservation_id           uuid NULL REFERENCES self_storage_reservations(id),
  start_date               date NOT NULL,
  end_date                 date NULL,        -- NULL = indefinido (renovación mensual)
  monthly_price            numeric(12,2) NOT NULL,  -- base, CONGELADA al firmar
  tax_rate                 numeric(5,2)  NOT NULL,
  deposit_amount           numeric(12,2) NOT NULL DEFAULT 0,
  billing_day              smallint NOT NULL,
  payment_method           self_storage_payment_method NULL,  -- preferido
  stripe_subscription_id   text NULL,
  stripe_checkout_session_id text NULL,
  status                   self_storage_contract_status NOT NULL DEFAULT 'draft',
  terms_version            text NULL,        -- versión de condiciones aceptada
  signed_at                timestamptz NULL,
  signature_name           text NULL,        -- nombre tecleado (firma simple)
  signature_ip             inet NULL,
  signature_user_agent     text NULL,
  signed_document_sha256   text NULL,        -- huella del PDF aceptado
  activated_at             timestamptz NULL,
  suspended_at             timestamptz NULL,
  suspension_reason        self_storage_block_reason NULL,
  terminated_at            timestamptz NULL,
  termination_reason       text NULL,
  notes                    text NULL,
  created_by               uuid NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_contracts_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_contracts_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id),
  CONSTRAINT self_storage_contracts_number_uq UNIQUE (empresa_id, contract_number),
  CONSTRAINT self_storage_contracts_subscription_uq UNIQUE (stripe_subscription_id),
  CONSTRAINT self_storage_contracts_dates_chk CHECK (end_date IS NULL OR end_date >= start_date),
  -- 1..28: Stripe no ancla ciclos en 29-31 de forma estable en febrero.
  CONSTRAINT self_storage_contracts_billing_day_chk CHECK (billing_day BETWEEN 1 AND 28),
  CONSTRAINT self_storage_contracts_price_chk CHECK (monthly_price >= 0 AND deposit_amount >= 0),
  CONSTRAINT self_storage_contracts_signed_chk CHECK (
    status IN ('draft','pending_signature','cancelled') OR signed_at IS NOT NULL
  ),
  CONSTRAINT self_storage_contracts_terminated_chk CHECK (
    status <> 'terminated' OR terminated_at IS NOT NULL
  ),
  CONSTRAINT self_storage_contracts_suspended_chk CHECK (
    status <> 'suspended' OR (suspended_at IS NOT NULL AND suspension_reason IS NOT NULL)
  )
);

DO $$ BEGIN
  ALTER TABLE self_storage_reservations
    ADD CONSTRAINT self_storage_reservations_contract_fk
    FOREIGN KEY (contract_id) REFERENCES self_storage_contracts(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS self_storage_contract_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id    uuid NOT NULL REFERENCES self_storage_contracts(id) ON DELETE RESTRICT,
  customer_id    uuid NOT NULL REFERENCES self_storage_customers(id),
  document_type  self_storage_document_type NOT NULL,
  storage_path   text NOT NULL,              -- contracts/{customer_id}/{contract_number}/...
  file_name      text NOT NULL,
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0),
  sha256         text NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  visible_to_customer boolean NOT NULL DEFAULT true,
  created_by     uuid NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_contract_documents_path_uq UNIQUE (storage_path)
);

-- 3.6 Facturación -------------------------------------------------------------
-- Numeradores correlativos sin huecos por serie y año (requisito fiscal).
CREATE TABLE IF NOT EXISTS self_storage_sequences (
  empresa_id  uuid NOT NULL,
  series      text NOT NULL,                 -- 'INV', 'RECT', 'CONTRACT'
  year        integer NOT NULL,
  last_value  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, series, year)
);

CREATE TABLE IF NOT EXISTS self_storage_invoices (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  invoice_number        text NULL,           -- se asigna al EMITIR (draft no tiene)
  series                text NOT NULL DEFAULT 'INV',
  customer_id           uuid NOT NULL,
  contract_id           uuid NULL REFERENCES self_storage_contracts(id),
  rectifies_invoice_id  uuid NULL REFERENCES self_storage_invoices(id),
  issue_date            date NULL,
  billing_period_start  date NULL,
  billing_period_end    date NULL,
  subtotal              numeric(12,2) NOT NULL DEFAULT 0,
  tax                   numeric(12,2) NOT NULL DEFAULT 0,
  total                 numeric(12,2) NOT NULL DEFAULT 0,
  amount_paid           numeric(12,2) NOT NULL DEFAULT 0,
  currency              char(3) NOT NULL DEFAULT 'EUR',
  due_date              date NULL,
  status                self_storage_invoice_status NOT NULL DEFAULT 'draft',
  stripe_invoice_id     text NULL,
  -- Ruta en el bucket privado (no una URL pública). Se sirve con URL firmada.
  pdf_url               text NULL,
  pdf_sha256            text NULL,
  -- Datos fiscales del cliente y del emisor CONGELADOS al emitir: si el
  -- cliente cambia de domicilio, la factura emitida no cambia.
  customer_snapshot     jsonb NULL,
  issuer_snapshot       jsonb NULL,
  paid_at               timestamptz NULL,
  overdue_since         date NULL,           -- motor de impagos
  notes                 text NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_invoices_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_invoices_number_uq UNIQUE (empresa_id, invoice_number),
  CONSTRAINT self_storage_invoices_stripe_uq UNIQUE (stripe_invoice_id),
  CONSTRAINT self_storage_invoices_totals_chk CHECK (total = subtotal + tax),
  CONSTRAINT self_storage_invoices_period_chk CHECK (
    billing_period_end IS NULL OR billing_period_start IS NULL OR billing_period_end >= billing_period_start
  ),
  CONSTRAINT self_storage_invoices_issued_chk CHECK (
    status IN ('draft','cancelled') OR (invoice_number IS NOT NULL AND issue_date IS NOT NULL)
  ),
  CONSTRAINT self_storage_invoices_paid_chk CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS self_storage_invoice_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id       uuid NOT NULL REFERENCES self_storage_invoices(id) ON DELETE CASCADE,
  item_type        self_storage_invoice_item_type NOT NULL,
  description      text NOT NULL,
  storage_unit_id  uuid NULL REFERENCES self_storage_units(id),
  period_start     date NULL,
  period_end       date NULL,
  quantity         numeric(10,3) NOT NULL DEFAULT 1,
  unit_price       numeric(12,2) NOT NULL,
  tax_rate         numeric(5,2)  NOT NULL,   -- la fianza va a 0 (no sujeta)
  subtotal         numeric(12,2) NOT NULL,
  tax              numeric(12,2) NOT NULL,
  total            numeric(12,2) NOT NULL,
  sort_order       integer NOT NULL DEFAULT 0,
  CONSTRAINT self_storage_invoice_items_totals_chk CHECK (total = subtotal + tax)
);

CREATE TABLE IF NOT EXISTS self_storage_payments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL,
  customer_id               uuid NOT NULL,
  invoice_id                uuid NULL REFERENCES self_storage_invoices(id),
  contract_id               uuid NULL REFERENCES self_storage_contracts(id),
  amount                    numeric(12,2) NOT NULL CHECK (amount > 0),
  refunded_amount           numeric(12,2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  currency                  char(3) NOT NULL DEFAULT 'EUR',
  payment_method            self_storage_payment_method NOT NULL,
  stripe_payment_intent_id  text NULL,
  stripe_charge_id          text NULL,
  status                    self_storage_payment_status NOT NULL DEFAULT 'pending',
  paid_at                   timestamptz NULL,
  failure_reason            text NULL,
  -- Pagos manuales (efectivo/transferencia): quién lo registró. Nunca el cliente.
  recorded_by               uuid NULL,
  notes                     text NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_payments_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_payments_pi_uq UNIQUE (stripe_payment_intent_id),
  CONSTRAINT self_storage_payments_charge_uq UNIQUE (stripe_charge_id),
  CONSTRAINT self_storage_payments_paid_chk CHECK (status <> 'succeeded' OR paid_at IS NOT NULL),
  CONSTRAINT self_storage_payments_refund_chk CHECK (refunded_amount <= amount),
  -- Un pago Stripe tiene que venir de Stripe; uno manual, de un empleado.
  CONSTRAINT self_storage_payments_origin_chk CHECK (
    (payment_method IN ('card','sepa') AND stripe_payment_intent_id IS NOT NULL)
    OR (payment_method IN ('bank_transfer','cash') AND recorded_by IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS self_storage_stripe_events (
  id            text PRIMARY KEY,            -- evt_... (idempotencia por PK)
  type          text NOT NULL,
  livemode      boolean NOT NULL,
  api_version   text NULL,
  stripe_created_at timestamptz NOT NULL,
  payload       jsonb NOT NULL,
  status        self_storage_stripe_event_status NOT NULL DEFAULT 'received',
  attempts      integer NOT NULL DEFAULT 0,
  error         text NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz NULL
);

-- 3.7 Hardware: dispositivos y puertas --------------------------------------
CREATE TABLE IF NOT EXISTS self_storage_devices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id                uuid NOT NULL REFERENCES self_storage_centers(id),
  name                     text NOT NULL,
  model                    text NOT NULL DEFAULT 'RUT241',
  serial_number            text NULL,
  imei                     text NULL,
  driver                   self_storage_device_driver NOT NULL DEFAULT 'mock',
  endpoint                 text NULL,        -- URL base (rut_http) o id de RMS
  -- NOMBRE de la variable de entorno con la credencial, nunca la credencial
  -- (misma regla que external_destinations.secretName, ARCHITECTURE.md §10).
  credentials_secret_name  text NULL,
  status                   self_storage_device_status NOT NULL DEFAULT 'unknown',
  last_seen_at             timestamptz NULL,
  last_error               text NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_devices_serial_uq UNIQUE (serial_number),
  CONSTRAINT self_storage_devices_secret_name_chk CHECK (
    credentials_secret_name IS NULL OR credentials_secret_name ~ '^SELF_STORAGE_[A-Z0-9_]+$'
  ),
  CONSTRAINT self_storage_devices_id_center_uq UNIQUE (id, center_id)
);

CREATE TABLE IF NOT EXISTS self_storage_doors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id          uuid NOT NULL REFERENCES self_storage_centers(id),
  zone_id            uuid NULL,
  code               text NOT NULL,          -- 'MAIN', 'Z2'
  name               text NOT NULL,
  type               self_storage_door_type NOT NULL,
  device_id          uuid NULL,
  output_channel     text NULL,              -- p.ej. 'dout1' / 'relay0' según firmware
  pulse_duration_ms  integer NOT NULL DEFAULT 1500,
  status             self_storage_door_status NOT NULL DEFAULT 'active',
  allow_app          boolean NOT NULL DEFAULT true,
  allow_phone        boolean NOT NULL DEFAULT true,
  access_schedule    jsonb NULL,             -- NULL = el del centro
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_doors_zone_fk FOREIGN KEY (zone_id, center_id)
    REFERENCES self_storage_zones (id, center_id),
  CONSTRAINT self_storage_doors_device_fk FOREIGN KEY (device_id, center_id)
    REFERENCES self_storage_devices (id, center_id),
  CONSTRAINT self_storage_doors_code_uq UNIQUE (center_id, code),
  CONSTRAINT self_storage_doors_pulse_chk CHECK (pulse_duration_ms BETWEEN 100 AND 30000),
  -- Una puerta de zona tiene zona; la principal no.
  CONSTRAINT self_storage_doors_type_zone_chk CHECK (
    (type = 'zone' AND zone_id IS NOT NULL) OR (type = 'main' AND zone_id IS NULL) OR type IN ('internal','other')
  ),
  CONSTRAINT self_storage_doors_channel_chk CHECK (device_id IS NULL OR output_channel IS NOT NULL)
);

-- 3.8 Accesos -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS self_storage_access_permissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  customer_id  uuid NOT NULL,
  contract_id  uuid NOT NULL REFERENCES self_storage_contracts(id) ON DELETE RESTRICT,
  door_id      uuid NOT NULL REFERENCES self_storage_doors(id),
  valid_from   timestamptz NOT NULL,
  valid_until  timestamptz NULL,
  status       self_storage_permission_status NOT NULL DEFAULT 'enabled',
  reason       text NULL,                   -- 'contrato', 'añadido por admin', ...
  created_by   uuid NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_access_permissions_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id),
  CONSTRAINT self_storage_access_permissions_dates_chk CHECK (valid_until IS NULL OR valid_until > valid_from)
);

-- Bloqueos (tabla NUEVA, no estaba en la lista; ver ARQUITECTURA §1, punto 8).
-- Un bloqueo por motivo: levantar el de impago no levanta el de seguridad.
CREATE TABLE IF NOT EXISTS self_storage_access_blocks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  customer_id  uuid NOT NULL,
  contract_id  uuid NULL REFERENCES self_storage_contracts(id),   -- NULL = todo el cliente
  door_id      uuid NULL REFERENCES self_storage_doors(id),       -- NULL = todas sus puertas
  reason       self_storage_block_reason NOT NULL,
  notes        text NULL,
  created_by   uuid NULL,                   -- NULL = sistema (motor de impagos)
  created_at   timestamptz NOT NULL DEFAULT now(),
  lifted_at    timestamptz NULL,
  lifted_by    uuid NULL,
  lift_notes   text NULL,
  CONSTRAINT self_storage_access_blocks_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id)
);

CREATE TABLE IF NOT EXISTS self_storage_temporary_accesses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL,
  customer_id             uuid NOT NULL,     -- titular que lo concede
  contract_id             uuid NOT NULL REFERENCES self_storage_contracts(id),
  guest_name              text NOT NULL,
  guest_phone             text NULL,         -- E.164: abre por llamada si se informa
  access_token_hash       text NOT NULL,     -- enlace mágico: sólo el hash
  valid_from              timestamptz NOT NULL,
  valid_until             timestamptz NOT NULL,
  max_uses                integer NULL,      -- NULL = ilimitado dentro de fechas
  uses_count              integer NOT NULL DEFAULT 0,
  status                  self_storage_temp_access_status NOT NULL DEFAULT 'active',
  -- quién lo creó: empleado o el propio cliente desde el portal
  created_by_type         self_storage_actor_type NOT NULL,
  created_by_user_id      uuid NULL,
  reason                  text NULL,
  revoked_at              timestamptz NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_temporary_accesses_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id),
  CONSTRAINT self_storage_temporary_accesses_token_uq UNIQUE (access_token_hash),
  CONSTRAINT self_storage_temporary_accesses_dates_chk CHECK (valid_until > valid_from),
  CONSTRAINT self_storage_temporary_accesses_uses_chk CHECK (
    uses_count >= 0 AND (max_uses IS NULL OR (max_uses > 0 AND uses_count <= max_uses))
  ),
  CONSTRAINT self_storage_temporary_accesses_creator_chk CHECK (created_by_type IN ('staff','customer')),
  CONSTRAINT self_storage_temporary_accesses_phone_chk CHECK (
    guest_phone IS NULL OR guest_phone ~ '^\+[1-9][0-9]{6,14}$'
  )
);

-- "Puertas permitidas" de un acceso temporal (tabla NUEVA de unión: un array
-- de uuid no tendría FK y dejaría pasar puertas de otro centro).
CREATE TABLE IF NOT EXISTS self_storage_temporary_access_doors (
  temporary_access_id  uuid NOT NULL REFERENCES self_storage_temporary_accesses(id) ON DELETE CASCADE,
  door_id              uuid NOT NULL REFERENCES self_storage_doors(id),
  PRIMARY KEY (temporary_access_id, door_id)
);

CREATE TABLE IF NOT EXISTS self_storage_access_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  "timestamp"          timestamptz NOT NULL DEFAULT now(),
  customer_id          uuid NULL,            -- NULL si no se identificó (llamada desconocida)
  contract_id          uuid NULL,
  door_id              uuid NULL,
  device_id            uuid NULL,
  temporary_access_id  uuid NULL,
  method               self_storage_access_method NOT NULL,
  result               self_storage_access_result NOT NULL,
  -- Código estable ('CUSTOMER_BLOCKED', 'OUTSIDE_SCHEDULE', 'DEVICE_TIMEOUT', ...)
  reason               text NOT NULL,
  phone_number         text NULL,
  actor_user_id        uuid NULL,            -- empleado en aperturas 'admin'
  ip                   inet NULL,
  device_latency_ms    integer NULL
  -- Sin FKs a propósito: el registro debe sobrevivir a cualquier borrado y
  -- debe poder escribirse incluso con datos de entrada inválidos.
);

-- 3.9 Incidencias, notificaciones, auditoría ---------------------------------
CREATE TABLE IF NOT EXISTS self_storage_incidents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  center_id        uuid NOT NULL REFERENCES self_storage_centers(id),
  storage_unit_id  uuid NULL REFERENCES self_storage_units(id),
  door_id          uuid NULL REFERENCES self_storage_doors(id),
  customer_id      uuid NULL REFERENCES self_storage_customers(id),
  contract_id      uuid NULL REFERENCES self_storage_contracts(id),
  type             self_storage_incident_type NOT NULL,
  priority         self_storage_priority NOT NULL DEFAULT 'normal',
  status           self_storage_incident_status NOT NULL DEFAULT 'open',
  title            text NOT NULL,
  description      text NULL,
  reported_by_type self_storage_actor_type NOT NULL,
  reported_by_id   uuid NULL,
  assigned_to      uuid NULL,
  resolution       text NULL,
  resolved_at      timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS self_storage_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  customer_id   uuid NULL REFERENCES self_storage_customers(id),
  contract_id   uuid NULL REFERENCES self_storage_contracts(id),
  invoice_id    uuid NULL REFERENCES self_storage_invoices(id),
  channel       self_storage_notification_channel NOT NULL,
  template      text NOT NULL,             -- 'dunning.first_notice', 'invoice.issued', ...
  recipient     text NOT NULL,
  subject       text NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  status        self_storage_notification_status NOT NULL DEFAULT 'pending',
  -- Idempotencia del motor de impagos: 'dunning:{invoice_id}:day3' sólo una vez.
  dedupe_key    text NULL,
  scheduled_at  timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz NULL,
  attempts      integer NOT NULL DEFAULT 0,
  error         text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_notifications_dedupe_uq UNIQUE (dedupe_key)
);

CREATE TABLE IF NOT EXISTS self_storage_audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_type   self_storage_actor_type NOT NULL,
  actor_id     uuid NULL,
  action       text NOT NULL,              -- 'customer.created', 'contract.price_changed', ...
  entity_type  text NOT NULL,
  entity_id    uuid NULL,
  before       jsonb NULL,
  after        jsonb NULL,
  ip           inet NULL,
  user_agent   text NULL,
  request_id   text NULL
);

-- 3.10 Importación de trasteros (CSV / datos de Reus) ------------------------
-- Dos tablas NUEVAS: subir → validar (vista previa con errores por fila) →
-- aplicar. Nada toca self_storage_units hasta "aplicar".
CREATE TABLE IF NOT EXISTS self_storage_unit_imports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id    uuid NOT NULL REFERENCES self_storage_centers(id),
  file_name    text NOT NULL,
  source       text NOT NULL DEFAULT 'csv', -- 'csv' | 'reus_seed'
  status       self_storage_import_status NOT NULL DEFAULT 'uploaded',
  column_map   jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary      jsonb NULL,                  -- {nuevos, actualizados, errores, avisos}
  created_by   uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  applied_at   timestamptz NULL
);

CREATE TABLE IF NOT EXISTS self_storage_unit_import_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id       uuid NOT NULL REFERENCES self_storage_unit_imports(id) ON DELETE CASCADE,
  row_number      integer NOT NULL,
  raw             jsonb NOT NULL,           -- fila tal cual llegó
  -- normalizado: code, zone_code, length_cm, width_cm, height_cm, area_m2,
  -- volume_m3, monthly_price (base), tax_rate, gross_price (PVP)
  parsed          jsonb NULL,
  errors          text[] NOT NULL DEFAULT '{}',
  warnings        text[] NOT NULL DEFAULT '{}', -- p.ej. 'PVP ≠ precio × (1+IVA)'
  action          text NULL CHECK (action IN ('create','update','skip')),
  storage_unit_id uuid NULL REFERENCES self_storage_units(id),
  CONSTRAINT self_storage_unit_import_rows_uq UNIQUE (import_id, row_number)
);

-- FK diferida de settings → centers
DO $$ BEGIN
  ALTER TABLE self_storage_settings
    ADD CONSTRAINT self_storage_settings_center_fk
    FOREIGN KEY (center_id) REFERENCES self_storage_centers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- -----------------------------------------------------------------------------
-- 4. ÍNDICES
-- -----------------------------------------------------------------------------

-- Configuración: una clave por (empresa, centro|empresa)
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_settings_key_uq
  ON self_storage_settings (empresa_id, COALESCE(center_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

-- Plano: un elemento SVG vincula como mucho UN trastero por centro
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_units_shape_uq
  ON self_storage_units (center_id, floor_plan_shape_id) WHERE floor_plan_shape_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_units_center_status_idx ON self_storage_units (center_id, status);
CREATE INDEX IF NOT EXISTS self_storage_units_zone_idx ON self_storage_units (zone_id);

-- Clientes
CREATE INDEX IF NOT EXISTS self_storage_customers_email_idx ON self_storage_customers (empresa_id, lower(email));
CREATE INDEX IF NOT EXISTS self_storage_customers_status_idx ON self_storage_customers (empresa_id, status);
CREATE INDEX IF NOT EXISTS self_storage_customers_search_idx
  ON self_storage_customers (empresa_id, lower(coalesce(company_name, last_name || ' ' || first_name)));
-- Llamada entrante → cliente: un número autorizado identifica a UN cliente por empresa
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_customer_phones_access_uq
  ON self_storage_customer_phones (empresa_id, phone_e164) WHERE allow_door_access;

-- ⚑ ANTI DOBLE CONTRATACIÓN (1/2): una sola reserva activa por trastero
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_reservations_active_unit_uq
  ON self_storage_reservations (storage_unit_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS self_storage_reservations_expiry_idx
  ON self_storage_reservations (expires_at) WHERE status = 'active';

-- ⚑ ANTI DOBLE CONTRATACIÓN (2/2): un solo contrato "vivo" por trastero
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_contracts_live_unit_uq
  ON self_storage_contracts (storage_unit_id)
  WHERE status IN ('pending_signature','pending_payment','active','suspended');
CREATE INDEX IF NOT EXISTS self_storage_contracts_customer_idx ON self_storage_contracts (customer_id, status);
CREATE INDEX IF NOT EXISTS self_storage_contracts_status_idx ON self_storage_contracts (empresa_id, status);

CREATE INDEX IF NOT EXISTS self_storage_contract_documents_contract_idx ON self_storage_contract_documents (contract_id);

-- Facturas / pagos
CREATE INDEX IF NOT EXISTS self_storage_invoices_customer_idx ON self_storage_invoices (customer_id, issue_date DESC);
CREATE INDEX IF NOT EXISTS self_storage_invoices_contract_idx ON self_storage_invoices (contract_id, billing_period_start);
CREATE INDEX IF NOT EXISTS self_storage_invoices_open_idx
  ON self_storage_invoices (empresa_id, due_date) WHERE status IN ('pending','overdue');
-- Un periodo de alquiler se factura una sola vez por contrato
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_invoices_period_uq
  ON self_storage_invoices (contract_id, billing_period_start)
  WHERE contract_id IS NOT NULL AND status NOT IN ('cancelled','draft') AND rectifies_invoice_id IS NULL;
CREATE INDEX IF NOT EXISTS self_storage_invoice_items_invoice_idx ON self_storage_invoice_items (invoice_id);
CREATE INDEX IF NOT EXISTS self_storage_payments_invoice_idx ON self_storage_payments (invoice_id);
CREATE INDEX IF NOT EXISTS self_storage_payments_customer_idx ON self_storage_payments (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_stripe_events_pending_idx
  ON self_storage_stripe_events (received_at) WHERE status IN ('received','failed');

-- Puertas / dispositivos
-- Una salida física controla una sola puerta
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_doors_output_uq
  ON self_storage_doors (device_id, output_channel) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_doors_center_idx ON self_storage_doors (center_id, type);

-- Accesos
-- Un permiso vigente por (contrato, puerta)
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_access_permissions_live_uq
  ON self_storage_access_permissions (contract_id, door_id) WHERE status <> 'expired';
CREATE INDEX IF NOT EXISTS self_storage_access_permissions_check_idx
  ON self_storage_access_permissions (customer_id, door_id, status);
CREATE INDEX IF NOT EXISTS self_storage_access_blocks_active_idx
  ON self_storage_access_blocks (customer_id) WHERE lifted_at IS NULL;
-- No dos bloqueos abiertos idénticos (el motor de impagos es reentrante)
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_access_blocks_open_uq
  ON self_storage_access_blocks (customer_id, COALESCE(contract_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                 COALESCE(door_id, '00000000-0000-0000-0000-000000000000'::uuid), reason)
  WHERE lifted_at IS NULL;
CREATE INDEX IF NOT EXISTS self_storage_temporary_accesses_contract_idx ON self_storage_temporary_accesses (contract_id, status);
CREATE INDEX IF NOT EXISTS self_storage_temporary_accesses_phone_idx
  ON self_storage_temporary_accesses (guest_phone) WHERE status = 'active' AND guest_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_temporary_accesses_expiry_idx
  ON self_storage_temporary_accesses (valid_until) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS self_storage_access_events_ts_idx ON self_storage_access_events (empresa_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS self_storage_access_events_door_idx ON self_storage_access_events (door_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS self_storage_access_events_customer_idx ON self_storage_access_events (customer_id, "timestamp" DESC);

-- Varios
CREATE INDEX IF NOT EXISTS self_storage_incidents_open_idx ON self_storage_incidents (center_id, status) WHERE status IN ('open','in_progress');
CREATE INDEX IF NOT EXISTS self_storage_notifications_pending_idx ON self_storage_notifications (scheduled_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS self_storage_audit_logs_entity_idx ON self_storage_audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_audit_logs_ts_idx ON self_storage_audit_logs (empresa_id, occurred_at DESC);


-- -----------------------------------------------------------------------------
-- 5. TRIGGERS
-- -----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'self_storage_centers','self_storage_zones','self_storage_units','self_storage_customers',
    'self_storage_reservations','self_storage_contracts','self_storage_invoices','self_storage_payments',
    'self_storage_devices','self_storage_doors','self_storage_access_permissions',
    'self_storage_temporary_accesses','self_storage_incidents'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON %I', t, t);
    EXECUTE format('CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION self_storage_touch_updated_at()', t, t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS self_storage_access_events_immutable ON self_storage_access_events;
CREATE TRIGGER self_storage_access_events_immutable
  BEFORE UPDATE OR DELETE ON self_storage_access_events
  FOR EACH ROW EXECUTE FUNCTION self_storage_forbid_mutation();

DROP TRIGGER IF EXISTS self_storage_audit_logs_immutable ON self_storage_audit_logs;
CREATE TRIGGER self_storage_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON self_storage_audit_logs
  FOR EACH ROW EXECUTE FUNCTION self_storage_forbid_mutation();

-- Una factura emitida no cambia de importe ni de número (sólo de estado/pago).
CREATE OR REPLACE FUNCTION self_storage_invoice_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
    OR NEW.subtotal <> OLD.subtotal OR NEW.tax <> OLD.tax OR NEW.total <> OLD.total
    OR NEW.customer_id <> OLD.customer_id OR NEW.issue_date IS DISTINCT FROM OLD.issue_date
    OR NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot) THEN
    RAISE EXCEPTION 'Factura % emitida: se corrige con una rectificativa', OLD.invoice_number
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS self_storage_invoices_freeze ON self_storage_invoices;
CREATE TRIGGER self_storage_invoices_freeze
  BEFORE UPDATE ON self_storage_invoices
  FOR EACH ROW EXECUTE FUNCTION self_storage_invoice_freeze();


-- -----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
-- Modelo (detalle en ARQUITECTURA.md §8):
--   · El servidor Express se conecta con `pg` como propietario de las tablas
--     → no le aplica RLS. Él es quien hace cumplir las reglas de negocio y el
--     aislamiento entre clientes (el id nunca viaja solo).
--   · RLS es la SEGUNDA barrera, para cualquier acceso con la anon key o con
--     el JWT de un usuario a través de PostgREST:
--       - anon: nada, en ninguna tabla.
--       - authenticated que sea CLIENTE de self storage: SELECT de lo suyo y
--         sólo en las tablas que el portal puede necesitar. Ninguna escritura.
--       - authenticated que sea EMPLEADO: nada vía PostgREST; todo por la API.
--   · Tablas internas (stripe_events, audit_logs, devices, settings, imports,
--     sequences, notifications, access_blocks): RLS activado y SIN políticas
--     = denegado para todos salvo service role / propietario.

CREATE OR REPLACE FUNCTION self_storage_current_customer_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM self_storage_customers
   WHERE auth_user_id = auth.uid() AND status <> 'inactive'
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION self_storage_current_customer_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION self_storage_current_customer_id() TO authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'self_storage_settings','self_storage_centers','self_storage_zones','self_storage_units',
    'self_storage_customers','self_storage_customer_phones','self_storage_reservations',
    'self_storage_contracts','self_storage_contract_documents','self_storage_sequences',
    'self_storage_invoices','self_storage_invoice_items','self_storage_payments',
    'self_storage_stripe_events','self_storage_devices','self_storage_doors',
    'self_storage_access_permissions','self_storage_access_blocks',
    'self_storage_temporary_accesses','self_storage_temporary_access_doors',
    'self_storage_access_events','self_storage_incidents','self_storage_notifications',
    'self_storage_audit_logs','self_storage_unit_imports','self_storage_unit_import_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
  END LOOP;
END $$;

-- Lectura del cliente: SÓLO sus filas.
DROP POLICY IF EXISTS ss_customer_self ON self_storage_customers;
CREATE POLICY ss_customer_self ON self_storage_customers
  FOR SELECT TO authenticated USING (id = self_storage_current_customer_id());

DROP POLICY IF EXISTS ss_customer_phones_own ON self_storage_customer_phones;
CREATE POLICY ss_customer_phones_own ON self_storage_customer_phones
  FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id());

DROP POLICY IF EXISTS ss_contracts_own ON self_storage_contracts;
CREATE POLICY ss_contracts_own ON self_storage_contracts
  FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id());

DROP POLICY IF EXISTS ss_contract_docs_own ON self_storage_contract_documents;
CREATE POLICY ss_contract_docs_own ON self_storage_contract_documents
  FOR SELECT TO authenticated
  USING (customer_id = self_storage_current_customer_id() AND visible_to_customer);

DROP POLICY IF EXISTS ss_invoices_own ON self_storage_invoices;
CREATE POLICY ss_invoices_own ON self_storage_invoices
  FOR SELECT TO authenticated
  USING (customer_id = self_storage_current_customer_id() AND status <> 'draft');

DROP POLICY IF EXISTS ss_invoice_items_own ON self_storage_invoice_items;
CREATE POLICY ss_invoice_items_own ON self_storage_invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM self_storage_invoices i
                  WHERE i.id = invoice_id
                    AND i.customer_id = self_storage_current_customer_id()
                    AND i.status <> 'draft'));

DROP POLICY IF EXISTS ss_payments_own ON self_storage_payments;
CREATE POLICY ss_payments_own ON self_storage_payments
  FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id());

DROP POLICY IF EXISTS ss_permissions_own ON self_storage_access_permissions;
CREATE POLICY ss_permissions_own ON self_storage_access_permissions
  FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id());

DROP POLICY IF EXISTS ss_temp_access_own ON self_storage_temporary_accesses;
CREATE POLICY ss_temp_access_own ON self_storage_temporary_accesses
  FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id());

DROP POLICY IF EXISTS ss_access_events_own ON self_storage_access_events;
CREATE POLICY ss_access_events_own ON self_storage_access_events
  FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id());

-- El trastero, zona y puertas: sólo los vinculados a un contrato suyo.
DROP POLICY IF EXISTS ss_units_own ON self_storage_units;
CREATE POLICY ss_units_own ON self_storage_units
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM self_storage_contracts c
                  WHERE c.storage_unit_id = self_storage_units.id
                    AND c.customer_id = self_storage_current_customer_id()));

DROP POLICY IF EXISTS ss_doors_own ON self_storage_doors;
CREATE POLICY ss_doors_own ON self_storage_doors
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM self_storage_access_permissions p
                  WHERE p.door_id = self_storage_doors.id
                    AND p.customer_id = self_storage_current_customer_id()));
-- Nota: el catálogo PÚBLICO (web de contratación) NO se abre con RLS a `anon`:
-- se sirve desde la API con lista blanca de campos (sin notes, sin cliente).


-- -----------------------------------------------------------------------------
-- 7. SUPABASE STORAGE (bucket privado)
-- -----------------------------------------------------------------------------
-- Bucket `self-storage`, privado. Rutas:
--   invoices/{customer_id}/{year}/{invoice_number}.pdf
--   contracts/{customer_id}/{contract_number}/{document_id}.pdf
--   floorplans/{center_id}/v{version}.svg
--   units/{unit_id}/3d.{webp|png}            (imagen 3D: pública vía API/CDN)
-- La API descarga con service role y entrega URLs FIRMADAS de 60 s tras
-- comprobar la propiedad. Política extra por si el cliente usa el SDK:
--
-- INSERT INTO storage.buckets (id, name, public) VALUES ('self-storage','self-storage', false)
--   ON CONFLICT (id) DO NOTHING;
-- DROP POLICY IF EXISTS ss_storage_customer_read ON storage.objects;
-- CREATE POLICY ss_storage_customer_read ON storage.objects FOR SELECT TO authenticated
--   USING (bucket_id = 'self-storage'
--          AND (storage.foldername(name))[1] IN ('invoices','contracts')
--          AND (storage.foldername(name))[2] = self_storage_current_customer_id()::text);
-- (Sin políticas de INSERT/UPDATE/DELETE: sólo escribe el backend.)
