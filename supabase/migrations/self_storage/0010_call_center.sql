-- =============================================================================
-- Mobilink Self Storage · 0010 · Call Center (y las incidencias del módulo)
-- =============================================================================
--
-- El Call Center gestiona la LLAMADA y su ciclo de vida, la atienda una
-- persona, una IA o las dos. No sabe nada de proveedores: ni de telefonía
-- (sólo guarda `telephony_provider` + `external_call_id` para no duplicar) ni
-- de IA (las sesiones de IA, cuando lleguen, apuntarán a la llamada).
--
--   catálogo de motivos y resultados (por empresa)   self_storage_call_catalog
--   llamadas                                         self_storage_calls
--   cronología de cada llamada (sólo inserción)      self_storage_call_events
--   incidencias (ÚNICA entidad de incidencias)       self_storage_incidents
--
-- Interesados: NO hay tabla de leads. Un interesado es una llamada sin
-- `customer_id`, agrupada por `phone_e164`. `lead_id` queda reservado (sin FK)
-- para vincular la llamada al modelo de lead que defina la web pública.
--
-- Quien llama nunca se convierte en cliente por llamar.
-- =============================================================================

-- ── Catálogo de motivos y resultados ────────────────────────────────────────
-- Los de partida los crea el servidor por empresa (idempotente); aquí sólo la
-- forma. `is_system`: su código no se puede cambiar (lo usan informes y reglas),
-- sí su etiqueta, su orden y si está activo.
CREATE TABLE IF NOT EXISTS self_storage_call_catalog (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL,
  kind              text NOT NULL,
  code              text NOT NULL,
  label             text NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0,
  default_priority  text NULL,
  is_system         boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_call_catalog_uq UNIQUE (empresa_id, kind, code),
  CONSTRAINT self_storage_call_catalog_kind_chk CHECK (kind IN ('reason','result')),
  CONSTRAINT self_storage_call_catalog_code_chk CHECK (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT self_storage_call_catalog_label_chk CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  CONSTRAINT self_storage_call_catalog_priority_chk CHECK (default_priority IS NULL OR default_priority IN ('normal','high','urgent'))
);

-- ── Llamadas ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_calls (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL,
  center_id            uuid NULL,
  customer_id          uuid NULL,
  contract_id          uuid NULL,
  -- Reservado: modelo de lead de la web pública (fase 4). Sin FK a propósito.
  lead_id              uuid NULL,
  phone_e164           text NULL,
  phone_raw            text NULL,
  caller_name          text NULL,
  direction            text NOT NULL DEFAULT 'incoming',
  channel              text NOT NULL DEFAULT 'phone',
  handled_by           text NOT NULL DEFAULT 'human',
  operator_user_id     uuid NULL,
  telephony_provider   text NULL,
  external_call_id     text NULL,
  language             text NULL,
  started_at           timestamptz NOT NULL DEFAULT now(),
  answered_at          timestamptz NULL,
  ended_at             timestamptz NULL,
  duration_seconds     integer NULL,
  reason_code          text NULL,
  result_code          text NULL,
  status               text NOT NULL DEFAULT 'started',
  priority             text NOT NULL DEFAULT 'normal',
  requires_human       boolean NOT NULL DEFAULT false,
  summary              text NULL,
  transcript           text NULL,
  notes                text NULL,
  escalated_at         timestamptz NULL,
  escalation_reason    text NULL,
  follow_up_at         timestamptz NULL,
  follow_up_done_at    timestamptz NULL,
  created_by           uuid NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_calls_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_calls_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_calls_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_calls_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_calls_phone_chk CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT self_storage_calls_direction_chk CHECK (direction IN ('incoming','outgoing')),
  CONSTRAINT self_storage_calls_channel_chk CHECK (channel IN ('phone')),
  CONSTRAINT self_storage_calls_handled_by_chk CHECK (handled_by IN ('human','ai','hybrid')),
  CONSTRAINT self_storage_calls_language_chk CHECK (language IS NULL OR language ~ '^[a-z]{2}$'),
  CONSTRAINT self_storage_calls_status_chk CHECK (status IN ('started','in_progress','finished','escalated','follow_up','closed')),
  CONSTRAINT self_storage_calls_priority_chk CHECK (priority IN ('normal','high','urgent')),
  CONSTRAINT self_storage_calls_duration_chk CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  CONSTRAINT self_storage_calls_times_chk CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT self_storage_calls_external_chk CHECK ((external_call_id IS NULL) = (telephony_provider IS NULL))
);
-- Un webhook repetido del proveedor no crea dos llamadas.
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_calls_external_uq
  ON self_storage_calls (empresa_id, telephony_provider, external_call_id) WHERE external_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_calls_empresa_idx ON self_storage_calls (empresa_id, started_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_calls_phone_idx ON self_storage_calls (empresa_id, phone_e164, started_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_calls_customer_idx ON self_storage_calls (customer_id, started_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_calls_follow_up_idx ON self_storage_calls (empresa_id, follow_up_at)
  WHERE follow_up_at IS NOT NULL AND follow_up_done_at IS NULL;

-- ── Cronología de la llamada (sólo inserción) ───────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_call_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  call_id      uuid NOT NULL,
  occurred_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_type   text NOT NULL,
  actor_id     uuid NULL,
  actor_name   text NULL,
  event_type   text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT self_storage_call_events_call_fk FOREIGN KEY (call_id, empresa_id)
    REFERENCES self_storage_calls (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_call_events_actor_chk CHECK (actor_type IN ('staff','ai','system','telephony')),
  CONSTRAINT self_storage_call_events_type_chk CHECK (event_type ~ '^[a-z][a-z_]{1,39}$')
);
-- clock_timestamp(): varios eventos de la misma transacción quedan en su orden.
ALTER TABLE self_storage_call_events ALTER COLUMN occurred_at SET DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS self_storage_call_events_call_idx ON self_storage_call_events (call_id, occurred_at);
CREATE INDEX IF NOT EXISTS self_storage_call_events_empresa_idx ON self_storage_call_events (empresa_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION self_storage_call_events_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- El borrado en cascada de una llamada (purga por retención) sí se permite.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'self_storage_call_events es de sólo inserción' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS self_storage_call_events_guard ON self_storage_call_events;
CREATE TRIGGER self_storage_call_events_guard BEFORE UPDATE OR DELETE ON self_storage_call_events
  FOR EACH ROW EXECUTE FUNCTION self_storage_call_events_guard();

-- ── Incidencias ─────────────────────────────────────────────────────────────
-- La ÚNICA entidad de incidencias de Self Storage. Sencilla a propósito: la
-- fase 4 la amplía (asignación, SLA, adjuntos…) sin sustituirla.
CREATE TABLE IF NOT EXISTS self_storage_incidents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  center_id       uuid NOT NULL,
  customer_id     uuid NULL,
  contract_id     uuid NULL,
  call_id         uuid NULL,
  incident_type   text NOT NULL,
  priority        text NOT NULL DEFAULT 'normal',
  status          text NOT NULL DEFAULT 'open',
  source          text NOT NULL DEFAULT 'panel',
  title           text NOT NULL,
  description     text NULL,
  resolution      text NULL,
  opened_by       uuid NULL,
  assigned_to     uuid NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz NULL,
  closed_at       timestamptz NULL,
  CONSTRAINT self_storage_incidents_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_incidents_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_incidents_customer_fk FOREIGN KEY (customer_id, empresa_id)
    REFERENCES self_storage_customers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_incidents_contract_fk FOREIGN KEY (contract_id, empresa_id)
    REFERENCES self_storage_contracts (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_incidents_call_fk FOREIGN KEY (call_id, empresa_id)
    REFERENCES self_storage_calls (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_incidents_type_chk CHECK (incident_type IN (
    'no_access','security','unauthorized_access','emergency','facility_failure',
    'billing','documentation','complaint','cancellation','administrative','other')),
  CONSTRAINT self_storage_incidents_priority_chk CHECK (priority IN ('normal','high','urgent')),
  -- Las de acceso, seguridad, emergencia y fallo grave son SIEMPRE urgentes.
  CONSTRAINT self_storage_incidents_urgent_chk CHECK (
    incident_type NOT IN ('no_access','security','unauthorized_access','emergency','facility_failure') OR priority = 'urgent'),
  CONSTRAINT self_storage_incidents_status_chk CHECK (status IN ('open','in_progress','resolved','closed','cancelled')),
  CONSTRAINT self_storage_incidents_source_chk CHECK (source IN ('panel','call','system','portal')),
  CONSTRAINT self_storage_incidents_title_chk CHECK (length(btrim(title)) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS self_storage_incidents_empresa_idx ON self_storage_incidents (empresa_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_incidents_call_idx ON self_storage_incidents (call_id) WHERE call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_incidents_customer_idx ON self_storage_incidents (customer_id) WHERE customer_id IS NOT NULL;

-- updated_at
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['self_storage_call_catalog','self_storage_calls','self_storage_incidents'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION self_storage_touch_updated_at()',
      t || '_touch', t
    );
  END LOOP;
END $$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Todo cerrado por PostgREST: llamadas, cronología, catálogo e incidencias
-- sólo se leen y escriben desde el servidor (con permiso fino por rol). El
-- portal del cliente no ve sus llamadas en esta fase.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['self_storage_call_catalog','self_storage_calls','self_storage_call_events','self_storage_incidents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
