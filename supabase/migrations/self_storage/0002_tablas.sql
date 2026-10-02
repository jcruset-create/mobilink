-- =============================================================================
-- Mobilink Self Storage · 0002 · Tablas de la fase 1
-- =============================================================================
--
-- Convenciones:
--   · `empresa_id` es el tenant de PLATAFORMA (`app_empresas`). No es un
--     cliente. Los clientes del módulo viven SÓLO en `self_storage_customers`:
--     ninguna tabla de aquí apunta a clientes, empresas comerciales ni
--     usuarios de otros módulos, y ninguna de otro módulo apunta aquí.
--   · `empresa_id` va en todas las tablas de primer nivel, con FKs COMPUESTAS
--     `(x_id, empresa_id)`: un contrato no puede unir un cliente de una empresa
--     con un trastero de otra aunque el servidor se equivoque.
--   · Importes en EUR con numeric(12,2). Medidas físicas en cm (enteros).
--   · `created_by` / `updated_by` = auth.users.id del EMPLEADO (sin FK: es
--     identidad de plataforma, no dato de negocio de este módulo).
-- =============================================================================

-- ── Configuración ────────────────────────────────────────────────────────────
-- Clave → valor JSON. center_id NULL = valor de la empresa; con center_id lo
-- sobreescribe para ese centro. Cada clave se valida con zod en el servidor.
CREATE TABLE IF NOT EXISTS self_storage_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  center_id   uuid NULL,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  updated_by  uuid NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_settings_key_chk CHECK (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)*$')
);

-- ── Centros ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_centers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  code             text NOT NULL,
  name             text NOT NULL,
  address          text NULL,
  postal_code      text NULL,
  city             text NULL,
  province         text NULL,
  country          char(2) NOT NULL DEFAULT 'ES',
  timezone         text NOT NULL DEFAULT 'Europe/Madrid',
  phone            text NULL,
  email            text NULL,
  -- Horario de acceso por defecto (fase 3): {"mon":[["06:00","23:00"]],...}; {} = 24 h
  access_schedule  jsonb NOT NULL DEFAULT '{}'::jsonb,
  public_visible   boolean NOT NULL DEFAULT false,
  status           self_storage_record_status NOT NULL DEFAULT 'active',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_centers_code_uq UNIQUE (empresa_id, code),
  CONSTRAINT self_storage_centers_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_centers_code_chk CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  CONSTRAINT self_storage_centers_name_chk CHECK (length(btrim(name)) > 0)
);

DO $$ BEGIN
  ALTER TABLE self_storage_settings
    ADD CONSTRAINT self_storage_settings_center_fk
    FOREIGN KEY (center_id) REFERENCES self_storage_centers(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Zonas ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  center_id   uuid NOT NULL,
  code        text NOT NULL,
  name        text NOT NULL,
  floor       text NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  status      self_storage_record_status NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_zones_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_zones_code_uq UNIQUE (center_id, code),
  -- Para FKs compuestas (zone_id, center_id): una zona de otro centro no se
  -- puede colar en un trastero (ni, en la fase 3, en una puerta).
  CONSTRAINT self_storage_zones_id_center_uq UNIQUE (id, center_id),
  CONSTRAINT self_storage_zones_code_chk CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{0,19}$'),
  CONSTRAINT self_storage_zones_name_chk CHECK (length(btrim(name)) > 0)
);

-- ── Tipos de trastero (representación comercial e imagen 3D) ────────────────
-- Muchos trasteros comparten tipo: 15 boxes de ~2,5 m² usan la misma imagen 3D.
-- El trastero conserva SUS medidas reales; el tipo es la medida nominal.
-- center_id NULL = tipo común a todos los centros de la empresa.
CREATE TABLE IF NOT EXISTS self_storage_unit_types (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL,
  center_id             uuid NULL,
  code                  text NOT NULL,
  name                  text NOT NULL,
  width_cm              integer NOT NULL,
  length_cm             integer NOT NULL,
  height_cm             integer NOT NULL,
  nominal_area_m2       numeric(8,2) NOT NULL,
  nominal_volume_m3     numeric(8,2) NOT NULL,
  image_3d_url          text NULL,
  capacity_description  text NULL,
  -- Ejemplos orientativos de lo que cabe («Ver capacidad»): ["20 cajas", ...]
  capacity_examples     text[] NOT NULL DEFAULT '{}',
  sort_order            integer NOT NULL DEFAULT 0,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_unit_types_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_unit_types_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_unit_types_dims_chk CHECK (width_cm > 0 AND length_cm > 0 AND height_cm > 0),
  CONSTRAINT self_storage_unit_types_nominal_chk CHECK (nominal_area_m2 > 0 AND nominal_volume_m3 > 0),
  CONSTRAINT self_storage_unit_types_code_chk CHECK (code ~ '^[A-Z0-9][A-Z0-9_.-]{0,29}$'),
  CONSTRAINT self_storage_unit_types_image_chk CHECK (image_3d_url IS NULL OR image_3d_url ~ '^https://')
);

-- ── Trasteros ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_units (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  center_id            uuid NOT NULL,
  zone_id              uuid NOT NULL,
  unit_type_id         uuid NULL,
  code                 text NOT NULL,      -- número de trastero (identificador comercial)
  name                 text NULL,
  width_cm             integer NOT NULL,
  length_cm            integer NOT NULL,
  height_cm            integer NOT NULL,
  -- Se GUARDAN, no se calculan: el fichero de Reus trae m² y m³ comerciales,
  -- que en un box irregular no tienen por qué ser ancho × largo.
  area_m2              numeric(8,2) NOT NULL,
  volume_m3            numeric(8,2) NOT NULL,
  -- Precio mensual del ALQUILER: base, tipo de IVA y PVP. Es el tratamiento
  -- fiscal de ESTE concepto (alquiler); las demás líneas de una factura
  -- (fianza, seguro, candado…) tendrán el suyo propio en la fase 2.
  monthly_price        numeric(12,2) NOT NULL,   -- base imponible
  tax_rate             numeric(5,2)  NOT NULL,   -- % IVA del alquiler
  monthly_price_gross  numeric(12,2) NOT NULL,   -- PVP
  deposit_amount       numeric(12,2) NOT NULL DEFAULT 0,
  status               self_storage_unit_status NOT NULL DEFAULT 'available',
  status_reason        text NULL,               -- por qué está en mantenimiento/bloqueado
  image_3d_url         text NULL,               -- si este box tiene imagen propia (gana al tipo)
  floor_plan_shape_id  text NULL,               -- id del elemento del SVG
  public_visible       boolean NOT NULL DEFAULT true,
  notes                text NULL,               -- interno: nunca en la vista pública
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_units_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_units_zone_fk FOREIGN KEY (zone_id, center_id)
    REFERENCES self_storage_zones (id, center_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_units_type_fk FOREIGN KEY (unit_type_id, empresa_id)
    REFERENCES self_storage_unit_types (id, empresa_id) ON DELETE RESTRICT,
  -- Identificador comercial único: número de trastero + centro.
  CONSTRAINT self_storage_units_code_uq UNIQUE (center_id, code),
  CONSTRAINT self_storage_units_id_center_uq UNIQUE (id, center_id),
  CONSTRAINT self_storage_units_code_chk CHECK (length(btrim(code)) > 0 AND code = btrim(code)),
  CONSTRAINT self_storage_units_dims_chk CHECK (width_cm > 0 AND length_cm > 0 AND height_cm > 0),
  CONSTRAINT self_storage_units_measures_chk CHECK (area_m2 > 0 AND volume_m3 > 0),
  CONSTRAINT self_storage_units_price_chk CHECK (monthly_price >= 0 AND monthly_price_gross >= 0 AND deposit_amount >= 0),
  CONSTRAINT self_storage_units_tax_chk CHECK (tax_rate >= 0 AND tax_rate <= 100),
  -- El PVP tiene que salir de base + IVA (con un céntimo de margen por redondeo):
  -- así se puede guardar el PVP redondo que publica el centro (60,00 €) sin que
  -- base, IVA y PVP lleguen a contradecirse.
  CONSTRAINT self_storage_units_gross_chk CHECK (
    abs(monthly_price_gross - monthly_price * (1 + tax_rate / 100)) <= 0.01
  ),
  CONSTRAINT self_storage_units_image_chk CHECK (image_3d_url IS NULL OR image_3d_url ~ '^https://'),
  CONSTRAINT self_storage_units_reason_chk CHECK (
    status NOT IN ('maintenance','blocked') OR status_reason IS NOT NULL
  )
);

-- Un tipo de un centro sólo vale para trasteros de ese centro (o el tipo es común).
CREATE OR REPLACE FUNCTION self_storage_units_check_type() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE tipo_centro uuid;
BEGIN
  IF NEW.unit_type_id IS NULL THEN RETURN NEW; END IF;
  SELECT center_id INTO tipo_centro FROM self_storage_unit_types WHERE id = NEW.unit_type_id;
  IF tipo_centro IS NOT NULL AND tipo_centro <> NEW.center_id THEN
    RAISE EXCEPTION 'El tipo de trastero es de otro centro'
      USING ERRCODE = 'foreign_key_violation', CONSTRAINT = 'self_storage_units_type_center';
  END IF;
  RETURN NEW;
END $$;

-- ── Plano (SVG versionado) ──────────────────────────────────────────────────
-- El SVG se guarda YA SANEADO (sin scripts, eventos ni referencias externas).
-- Cada subida es una versión nueva; la vigente es la de número más alto. No se
-- edita una versión: se sube otra.
CREATE TABLE IF NOT EXISTS self_storage_floor_plans (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  center_id   uuid NOT NULL,
  version     integer NOT NULL,
  name        text NOT NULL DEFAULT 'Planta',
  svg         text NOT NULL,
  shape_ids   text[] NOT NULL DEFAULT '{}',   -- ids de elementos del SVG
  sha256      text NOT NULL,
  created_by  uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_floor_plans_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_floor_plans_version_uq UNIQUE (center_id, version),
  CONSTRAINT self_storage_floor_plans_version_chk CHECK (version > 0),
  CONSTRAINT self_storage_floor_plans_size_chk CHECK (length(svg) <= 2000000)
);

-- ── Clientes de Self Storage (dominio PROPIO) ───────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  customer_type       self_storage_customer_type NOT NULL,
  first_name          text NULL,
  last_name           text NULL,
  company_name        text NULL,
  tax_id              text NOT NULL,            -- normalizado: mayúsculas, sin separadores
  phone               text NOT NULL,            -- contacto principal, E.164
  email               text NOT NULL,
  address             text NULL,
  postal_code         text NULL,
  city                text NULL,
  province            text NULL,
  country             char(2) NOT NULL DEFAULT 'ES',
  status              self_storage_customer_status NOT NULL DEFAULT 'active',
  status_reason       text NULL,
  stripe_customer_id  text NULL,
  -- Cuenta del portal (fase 4): usuario de Supabase Auth. NO es un usuario
  -- interno: nunca está en app_usuarios ni en app_usuario_modulos.
  auth_user_id        uuid NULL,
  notes               text NULL,
  created_by          uuid NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_customers_tax_id_uq UNIQUE (empresa_id, tax_id),
  CONSTRAINT self_storage_customers_stripe_uq UNIQUE (stripe_customer_id),
  CONSTRAINT self_storage_customers_auth_uq UNIQUE (auth_user_id),
  CONSTRAINT self_storage_customers_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_customers_names_chk CHECK (
    (customer_type = 'individual' AND length(btrim(coalesce(first_name,''))) > 0
                                  AND length(btrim(coalesce(last_name,''))) > 0)
    OR (customer_type = 'company' AND length(btrim(coalesce(company_name,''))) > 0)
  ),
  CONSTRAINT self_storage_customers_tax_id_chk CHECK (tax_id ~ '^[A-Z0-9]{5,20}$'),
  CONSTRAINT self_storage_customers_email_chk CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT self_storage_customers_phone_chk CHECK (phone ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT self_storage_customers_blocked_chk CHECK (status <> 'blocked' OR status_reason IS NOT NULL)
);

-- Teléfonos adicionales y, sobre todo, los AUTORIZADOS para abrir por llamada
-- (fase 3: se sincronizan con la lista blanca del RUT241).
CREATE TABLE IF NOT EXISTS self_storage_customer_phones (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  customer_id        uuid NOT NULL,
  phone_e164         text NOT NULL,
  label              text NULL,
  allow_door_access  boolean NOT NULL DEFAULT false,
  verified_at        timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_customer_phones_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_customer_phones_uq UNIQUE (customer_id, phone_e164),
  CONSTRAINT self_storage_customer_phones_e164_chk CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

-- ── Reservas temporales ─────────────────────────────────────────────────────
-- Modelo listo desde la fase 1 porque es lo que garantiza en la base que dos
-- clientes no contratan el mismo trastero. La lógica (web y caducidad) llega
-- en las fases 2 y 4.
CREATE TABLE IF NOT EXISTS self_storage_reservations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  center_id           uuid NOT NULL,
  storage_unit_id     uuid NOT NULL,
  customer_id         uuid NULL,
  session_token_hash  text NULL,                -- reserva web: sólo el hash del token
  source              text NOT NULL DEFAULT 'admin' CHECK (source IN ('online','admin')),
  status              self_storage_reservation_status NOT NULL DEFAULT 'active',
  expires_at          timestamptz NOT NULL,
  created_by          uuid NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_reservations_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id),
  CONSTRAINT self_storage_reservations_unit_fk FOREIGN KEY (storage_unit_id, center_id)
    REFERENCES self_storage_units (id, center_id),
  CONSTRAINT self_storage_reservations_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id),
  CONSTRAINT self_storage_reservations_expiry_chk CHECK (expires_at > created_at)
);

-- ── Contratos (modelo; la lógica es de la fase 2) ───────────────────────────
-- 1 cliente → N contratos; 1 contrato → 1 trastero (inicialmente).
CREATE TABLE IF NOT EXISTS self_storage_contracts (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                  uuid NOT NULL,
  center_id                   uuid NOT NULL,
  contract_number             text NOT NULL,
  customer_id                 uuid NOT NULL,
  storage_unit_id             uuid NOT NULL,
  reservation_id              uuid NULL REFERENCES self_storage_reservations(id),
  start_date                  date NOT NULL,
  end_date                    date NULL,
  monthly_price               numeric(12,2) NOT NULL,   -- base, CONGELADA al firmar
  tax_rate                    numeric(5,2)  NOT NULL,
  deposit_amount              numeric(12,2) NOT NULL DEFAULT 0,
  billing_day                 smallint NOT NULL,
  stripe_subscription_id      text NULL,
  status                      self_storage_contract_status NOT NULL DEFAULT 'draft',
  signed_at                   timestamptz NULL,
  activated_at                timestamptz NULL,
  suspended_at                timestamptz NULL,
  terminated_at               timestamptz NULL,
  termination_reason          text NULL,
  notes                       text NULL,
  created_by                  uuid NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_contracts_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id),
  CONSTRAINT self_storage_contracts_unit_fk FOREIGN KEY (storage_unit_id, center_id)
    REFERENCES self_storage_units (id, center_id),
  CONSTRAINT self_storage_contracts_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id),
  CONSTRAINT self_storage_contracts_number_uq UNIQUE (empresa_id, contract_number),
  CONSTRAINT self_storage_contracts_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_contracts_subscription_uq UNIQUE (stripe_subscription_id),
  CONSTRAINT self_storage_contracts_dates_chk CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT self_storage_contracts_billing_day_chk CHECK (billing_day BETWEEN 1 AND 28),
  CONSTRAINT self_storage_contracts_price_chk CHECK (monthly_price >= 0 AND deposit_amount >= 0),
  CONSTRAINT self_storage_contracts_tax_chk CHECK (tax_rate >= 0 AND tax_rate <= 100),
  CONSTRAINT self_storage_contracts_signed_chk CHECK (
    status IN ('draft','pending_signature','cancelled') OR signed_at IS NOT NULL
  ),
  CONSTRAINT self_storage_contracts_terminated_chk CHECK (status <> 'terminated' OR terminated_at IS NOT NULL),
  CONSTRAINT self_storage_contracts_suspended_chk CHECK (status <> 'suspended' OR suspended_at IS NOT NULL)
);

-- ── Personas autorizadas de un contrato ─────────────────────────────────────
-- Titular: el cliente del contrato. Aquí van los ADICIONALES (María, autorizada
-- por Juan). Cada uno tendrá sus propios eventos de acceso (fase 3:
-- access_events.contract_member_id), para que no todo aparezca como el titular.
CREATE TABLE IF NOT EXISTS self_storage_contract_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL,
  contract_id   uuid NOT NULL,
  full_name     text NOT NULL,
  phone_e164    text NULL,
  email         text NULL,
  status        self_storage_member_status NOT NULL DEFAULT 'active',
  allow_app     boolean NOT NULL DEFAULT false,
  allow_phone   boolean NOT NULL DEFAULT false,
  notes         text NULL,
  created_by    uuid NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_contract_members_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_contract_members_name_chk CHECK (length(btrim(full_name)) > 0),
  CONSTRAINT self_storage_contract_members_phone_chk CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT self_storage_contract_members_email_chk CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Abrir por llamada exige teléfono; por app, una cuenta (email) en la fase 4.
  CONSTRAINT self_storage_contract_members_phone_access_chk CHECK (NOT allow_phone OR phone_e164 IS NOT NULL),
  CONSTRAINT self_storage_contract_members_app_access_chk CHECK (NOT allow_app OR email IS NOT NULL)
);

-- ── Auditoría (sólo inserción) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_audit_logs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_type   self_storage_actor_type NOT NULL,
  actor_id     uuid NULL,
  actor_name   text NULL,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid NULL,
  before       jsonb NULL,
  after        jsonb NULL,
  ip           text NULL,
  CONSTRAINT self_storage_audit_logs_action_chk CHECK (action ~ '^[a-z_]+\.[a-z_.]+$')
);

-- ── Importación de trasteros (CSV) ──────────────────────────────────────────
-- validar (dry-run, nada toca self_storage_units) → revisar errores → aplicar.
CREATE TABLE IF NOT EXISTS self_storage_unit_imports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  center_id        uuid NOT NULL,
  file_name        text NOT NULL,
  file_sha256      text NOT NULL,
  default_zone_id  uuid NULL,
  status           self_storage_import_status NOT NULL DEFAULT 'validated',
  options          jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by       uuid NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  applied_by       uuid NULL,
  applied_at       timestamptz NULL,
  CONSTRAINT self_storage_unit_imports_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id),
  CONSTRAINT self_storage_unit_imports_zone_fk FOREIGN KEY (default_zone_id, center_id)
    REFERENCES self_storage_zones (id, center_id),
  CONSTRAINT self_storage_unit_imports_applied_chk CHECK (status <> 'applied' OR applied_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS self_storage_unit_import_rows (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id        uuid NOT NULL REFERENCES self_storage_unit_imports(id) ON DELETE CASCADE,
  row_number       integer NOT NULL,
  unit_code        text NULL,          -- número de trastero normalizado ('' si no venía)
  raw              jsonb NOT NULL,
  parsed           jsonb NULL,
  errors           text[] NOT NULL DEFAULT '{}',
  warnings         text[] NOT NULL DEFAULT '{}',
  action           text NULL CHECK (action IN ('create','update','skip','error')),
  storage_unit_id  uuid NULL REFERENCES self_storage_units(id),
  CONSTRAINT self_storage_unit_import_rows_uq UNIQUE (import_id, row_number)
);
