-- =============================================================================
-- Mobilink Self Storage · 0009 · Fase 3: accesos físicos
-- =============================================================================
--
-- Principio: la AUTORIZACIÓN es de Mobilink (contrato, bloqueos, permisos,
-- horario); el dispositivo sólo EJECUTA (abre una salida) o mantiene la lista
-- de teléfonos que Mobilink le calcula. Por eso:
--
--   dispositivo (RUT241, otro Teltonika, módulo de relés…)
--     └─ salidas (output_number)              self_storage_device_outputs
--          └─ puerta → device_output_id        self_storage_doors
--
--   permisos (contrato → puertas)             self_storage_access_permissions
--   accesos temporales (+ sus puertas)        self_storage_temporary_accesses
--   eventos de acceso (sólo inserción)        self_storage_access_events
--   sincronización de teléfonos               self_storage_device_syncs
--
-- Secretos: NUNCA en la base. `credentials_secret_name` guarda el NOMBRE de
-- la variable de entorno con las credenciales del dispositivo.
-- =============================================================================

-- ── Dispositivos ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_devices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL,
  center_id                uuid NOT NULL,
  name                     text NOT NULL,
  manufacturer             text NOT NULL DEFAULT 'Teltonika',
  model                    text NOT NULL DEFAULT 'RUT241',
  serial                   text NULL,
  imei                     text NULL,
  phone_number             text NULL,             -- número de la SIM (a él se llama para abrir)
  -- Cómo se llega al dispositivo. El dominio no sabe nada de esto: sólo el adapter.
  connection_type          text NOT NULL DEFAULT 'mock',
  endpoint                 text NULL,             -- https://host:puerto (no es secreto)
  credentials_secret_name  text NULL,             -- NOMBRE de la variable de entorno, nunca la credencial
  driver_options           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- opciones NO secretas del adapter
  simulation               jsonb NOT NULL DEFAULT '{}'::jsonb,  -- sólo para connection_type = 'mock'
  phone_access_mode        text NOT NULL DEFAULT 'rut_whitelist',
  firmware                 text NULL,
  status                   text NOT NULL DEFAULT 'unknown',
  last_seen_at             timestamptz NULL,
  last_error               text NULL,
  last_error_at            timestamptz NULL,
  enabled                  boolean NOT NULL DEFAULT true,
  notes                    text NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_devices_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_devices_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_devices_id_center_uq UNIQUE (id, center_id),
  CONSTRAINT self_storage_devices_name_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT self_storage_devices_connection_chk CHECK (connection_type IN ('mock','direct_http','vpn_http','rms')),
  CONSTRAINT self_storage_devices_status_chk CHECK (status IN ('unknown','online','offline')),
  CONSTRAINT self_storage_devices_phone_mode_chk CHECK (phone_access_mode IN ('none','rut_whitelist')),
  CONSTRAINT self_storage_devices_phone_chk CHECK (phone_number IS NULL OR phone_number ~ '^\+[1-9][0-9]{6,14}$'),
  -- El nombre de una variable de entorno, nada más (que nadie pegue aquí una contraseña).
  CONSTRAINT self_storage_devices_secret_name_chk CHECK (credentials_secret_name IS NULL OR credentials_secret_name ~ '^[A-Z][A-Z0-9_]{2,80}$'),
  CONSTRAINT self_storage_devices_endpoint_chk CHECK (endpoint IS NULL OR endpoint ~ '^https?://[^\s@]+$')
);

-- ── Salidas del dispositivo ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_device_outputs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  device_id          uuid NOT NULL,
  output_number      integer NOT NULL,
  name               text NOT NULL,
  output_type        text NOT NULL DEFAULT 'digital_output',
  pulse_duration_ms  integer NOT NULL DEFAULT 1500,
  enabled            boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_device_outputs_device_fk FOREIGN KEY (device_id, empresa_id)
    REFERENCES self_storage_devices (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_device_outputs_number_uq UNIQUE (device_id, output_number),
  CONSTRAINT self_storage_device_outputs_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_device_outputs_number_chk CHECK (output_number BETWEEN 1 AND 64),
  CONSTRAINT self_storage_device_outputs_type_chk CHECK (output_type IN ('relay','digital_output')),
  CONSTRAINT self_storage_device_outputs_pulse_chk CHECK (pulse_duration_ms BETWEEN 100 AND 30000)
);

-- ── Puertas ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_doors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  center_id         uuid NOT NULL,
  zone_id           uuid NULL,
  name              text NOT NULL,
  door_type         text NOT NULL DEFAULT 'main',
  device_output_id  uuid NULL,      -- sin salida = puerta dada de alta pero sin instalar
  enabled           boolean NOT NULL DEFAULT true,
  allow_app         boolean NOT NULL DEFAULT true,
  allow_phone       boolean NOT NULL DEFAULT true,
  -- null = 24 h. {"timezone":"Europe/Madrid","rules":[{"days":[1,2,3,4,5],"from":"07:00","to":"22:00"}]}
  access_schedule   jsonb NULL,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_doors_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  -- La zona tiene que ser del mismo centro que la puerta.
  CONSTRAINT self_storage_doors_zone_fk FOREIGN KEY (zone_id, center_id)
    REFERENCES self_storage_zones (id, center_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_doors_output_fk FOREIGN KEY (device_output_id, empresa_id)
    REFERENCES self_storage_device_outputs (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_doors_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_doors_name_chk CHECK (length(btrim(name)) > 0),
  CONSTRAINT self_storage_doors_type_chk CHECK (door_type IN ('main','zone','internal','other')),
  CONSTRAINT self_storage_doors_zone_chk CHECK (door_type <> 'zone' OR zone_id IS NOT NULL)
);
-- Una salida abre UNA puerta.
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_doors_output_uq ON self_storage_doors (device_output_id) WHERE device_output_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_doors_center_idx ON self_storage_doors (center_id);

-- ── Personas autorizadas: cuenta propia para abrir desde la app ─────────────
ALTER TABLE self_storage_contract_members ADD COLUMN IF NOT EXISTS auth_user_id uuid NULL;
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_contract_members_auth_uq ON self_storage_contract_members (auth_user_id) WHERE auth_user_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE self_storage_contract_members ADD CONSTRAINT self_storage_contract_members_id_empresa_uq UNIQUE (id, empresa_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $$;

-- ── Permisos de acceso (contrato → puertas) ─────────────────────────────────
-- Los de origen `contract` los calcula el servidor a partir del contrato
-- (puerta principal + puerta de SU zona). Los `manual` los da una persona.
-- Un permiso guardado NO basta para abrir: se vuelve a comprobar contrato,
-- bloqueos y horario en cada intento (evaluateAccess).
CREATE TABLE IF NOT EXISTS self_storage_access_permissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  contract_id  uuid NOT NULL,
  door_id      uuid NOT NULL,
  source       text NOT NULL DEFAULT 'contract',
  valid_from   timestamptz NULL,
  valid_until  timestamptz NULL,
  status       text NOT NULL DEFAULT 'active',
  granted_by   uuid NULL,
  notes        text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz NULL,
  revoked_by   uuid NULL,
  CONSTRAINT self_storage_access_permissions_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_access_permissions_door_fk FOREIGN KEY (door_id, empresa_id)
    REFERENCES self_storage_doors (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_access_permissions_source_chk CHECK (source IN ('contract','manual')),
  CONSTRAINT self_storage_access_permissions_status_chk CHECK (status IN ('active','revoked')),
  CONSTRAINT self_storage_access_permissions_revoked_chk CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT self_storage_access_permissions_window_chk CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until > valid_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_access_permissions_active_uq
  ON self_storage_access_permissions (contract_id, door_id) WHERE status = 'active';

-- ── Accesos temporales ──────────────────────────────────────────────────────
-- Para el titular (fuera de horario, p. ej.) o un invitado. Si dependen de un
-- contrato, el contrato manda: bloqueado el contrato, bloqueado el temporal.
CREATE TABLE IF NOT EXISTS self_storage_temporary_accesses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  center_id    uuid NOT NULL,
  contract_id  uuid NULL,
  customer_id  uuid NULL,
  holder_type  text NOT NULL DEFAULT 'guest',
  full_name    text NOT NULL,
  phone_e164   text NULL,
  email        text NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  max_uses     integer NULL,         -- null = sin límite dentro de las fechas
  uses_count   integer NOT NULL DEFAULT 0,
  token_hash   text NULL,            -- SHA-256 del enlace de apertura; el token no se guarda
  status       text NOT NULL DEFAULT 'active',
  created_by   uuid NULL,
  notes        text NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz NULL,
  CONSTRAINT self_storage_temporary_accesses_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_temporary_accesses_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_temporary_accesses_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_temporary_accesses_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_temporary_accesses_holder_chk CHECK (holder_type IN ('holder','guest')),
  CONSTRAINT self_storage_temporary_accesses_window_chk CHECK (ends_at > starts_at),
  CONSTRAINT self_storage_temporary_accesses_uses_chk CHECK (uses_count >= 0 AND (max_uses IS NULL OR (max_uses >= 1 AND uses_count <= max_uses))),
  CONSTRAINT self_storage_temporary_accesses_status_chk CHECK (status IN ('active','revoked')),
  CONSTRAINT self_storage_temporary_accesses_phone_chk CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT self_storage_temporary_accesses_name_chk CHECK (length(btrim(full_name)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_temporary_accesses_token_uq ON self_storage_temporary_accesses (token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS self_storage_temporary_access_doors (
  temporary_access_id  uuid NOT NULL,
  door_id              uuid NOT NULL,
  empresa_id           uuid NOT NULL,
  PRIMARY KEY (temporary_access_id, door_id),
  CONSTRAINT self_storage_temporary_access_doors_access_fk FOREIGN KEY (temporary_access_id, empresa_id)
    REFERENCES self_storage_temporary_accesses (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_temporary_access_doors_door_fk FOREIGN KEY (door_id, empresa_id)
    REFERENCES self_storage_doors (id, empresa_id) ON DELETE RESTRICT
);

-- ── Eventos de acceso (sólo inserción) ──────────────────────────────────────
-- Cada intento queda registrado con QUIÉN (cliente, persona autorizada,
-- acceso temporal o empleado), la decisión y su motivo. El resultado físico
-- (execution_*) se rellena UNA vez, después de hablar con el dispositivo: es
-- la única actualización permitida (trigger).
CREATE TABLE IF NOT EXISTS self_storage_access_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  center_id            uuid NULL,
  door_id              uuid NULL,
  device_id            uuid NULL,
  device_output_id     uuid NULL,
  contract_id          uuid NULL,
  customer_id          uuid NULL,
  contract_member_id   uuid NULL,
  temporary_access_id  uuid NULL,
  staff_user_id        uuid NULL,
  actor_type           self_storage_actor_type NOT NULL,
  actor_name           text NULL,      -- «Juan García», «María (autorizada)»: quién, no sólo qué contrato
  phone_e164           text NULL,
  method               text NOT NULL,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  decision             text NOT NULL,
  reason               text NOT NULL,
  execution_status     text NOT NULL,
  executed_at          timestamptz NULL,
  latency_ms           integer NULL,
  device_response      jsonb NULL,     -- saneado: nunca tokens ni credenciales
  admin_reason         text NULL,
  ip                   text NULL,
  user_agent           text NULL,
  CONSTRAINT self_storage_access_events_method_chk CHECK (method IN ('app','phone','admin','temporary_link')),
  CONSTRAINT self_storage_access_events_decision_chk CHECK (decision IN ('granted','denied')),
  CONSTRAINT self_storage_access_events_exec_chk CHECK (execution_status IN ('not_attempted','pending','succeeded','failed','timeout')),
  CONSTRAINT self_storage_access_events_denied_chk CHECK (decision = 'granted' OR execution_status = 'not_attempted')
);
CREATE INDEX IF NOT EXISTS self_storage_access_events_door_idx ON self_storage_access_events (door_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_access_events_customer_idx ON self_storage_access_events (customer_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_access_events_empresa_idx ON self_storage_access_events (empresa_id, requested_at DESC);

CREATE OR REPLACE FUNCTION self_storage_access_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'self_storage_access_events es de sólo inserción' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Sólo se completa el resultado de un intento pendiente, y una sola vez.
  IF OLD.execution_status <> 'pending'
     OR NEW.execution_status NOT IN ('succeeded','failed','timeout')
     OR (to_jsonb(NEW) - ARRAY['execution_status','executed_at','latency_ms','device_response'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['execution_status','executed_at','latency_ms','device_response']) THEN
    RAISE EXCEPTION 'self_storage_access_events es de sólo inserción (sólo se completa el resultado una vez)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS self_storage_access_events_guard ON self_storage_access_events;
CREATE TRIGGER self_storage_access_events_guard BEFORE UPDATE OR DELETE ON self_storage_access_events
  FOR EACH ROW EXECUTE FUNCTION self_storage_access_events_guard();

-- ── Sincronización de teléfonos con el dispositivo ─────────────────────────
-- Estado DESEADO (lo que Mobilink calcula) frente a estado REAL (lo último que
-- el dispositivo aceptó). «Al día» = las dos huellas coinciden.
CREATE TABLE IF NOT EXISTS self_storage_device_syncs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL,
  device_id        uuid NOT NULL,
  sync_type        text NOT NULL DEFAULT 'phone_whitelist',
  desired_state    jsonb NOT NULL DEFAULT '[]'::jsonb,
  desired_hash     text NOT NULL,
  actual_state     jsonb NULL,
  actual_hash      text NULL,
  status           text NOT NULL DEFAULT 'pending',
  attempts         integer NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NULL,
  last_attempt_at  timestamptz NULL,
  last_success_at  timestamptz NULL,
  error            text NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_device_syncs_device_fk FOREIGN KEY (device_id, empresa_id)
    REFERENCES self_storage_devices (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_device_syncs_uq UNIQUE (device_id, sync_type),
  CONSTRAINT self_storage_device_syncs_type_chk CHECK (sync_type IN ('phone_whitelist')),
  CONSTRAINT self_storage_device_syncs_status_chk CHECK (status IN ('pending','synced','failed'))
);

-- updated_at
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['self_storage_devices','self_storage_device_outputs','self_storage_doors'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION self_storage_touch_updated_at()',
      t || '_touch', t
    );
  END LOOP;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Mismo modelo que 0004/0007: el servidor es propietario; por PostgREST un
-- cliente sólo LEE lo suyo (sus eventos, permisos y accesos temporales).
-- Dispositivos, salidas, puertas y sincronizaciones: cerrados.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'self_storage_devices','self_storage_device_outputs','self_storage_doors','self_storage_access_permissions',
    'self_storage_temporary_accesses','self_storage_temporary_access_doors','self_storage_access_events',
    'self_storage_device_syncs'
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
  IF to_regprocedure('self_storage_current_customer_id()') IS NULL THEN
    RAISE NOTICE 'Self Storage: sin self_storage_current_customer_id(); políticas de la fase 3 no creadas';
    RETURN;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS ss_access_events_own ON self_storage_access_events';
  EXECUTE $p$ CREATE POLICY ss_access_events_own ON self_storage_access_events
    FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id()) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_access_permissions_own ON self_storage_access_permissions';
  EXECUTE $p$ CREATE POLICY ss_access_permissions_own ON self_storage_access_permissions
    FOR SELECT TO authenticated USING (EXISTS (
      SELECT 1 FROM self_storage_contracts c
       WHERE c.id = self_storage_access_permissions.contract_id
         AND c.customer_id = self_storage_current_customer_id())) $p$;

  EXECUTE 'DROP POLICY IF EXISTS ss_temporary_accesses_own ON self_storage_temporary_accesses';
  EXECUTE $p$ CREATE POLICY ss_temporary_accesses_own ON self_storage_temporary_accesses
    FOR SELECT TO authenticated USING (customer_id = self_storage_current_customer_id()) $p$;
END
$rls$;
