-- =============================================================================
-- Mobilink Self Storage · 0011 · Asistente IA
-- =============================================================================
--
-- Capa OPCIONAL sobre el Call Center: se puede apagar sin que el Call Center
-- note nada. Una llamada puede tener ninguna, una o varias sesiones de IA
-- (reconexiones); una sesión puede no tener llamada (consola de prueba).
--
--   base de conocimiento (estático, por empresa y centro)  self_storage_ai_knowledge
--   sesiones de IA (proveedor, modelo, uso, resumen)       self_storage_ai_sessions
--   mensajes de la sesión (se purgan según la empresa)     self_storage_ai_messages
--   herramientas ejecutadas (sólo inserción)               self_storage_ai_tool_calls
--
-- Los DATOS DINÁMICOS (disponibilidad, cliente, contrato, centro, acceso,
-- incidencias) NO van en la base de conocimiento: el asistente los consulta
-- con herramientas de Mobilink. Ningún proveedor toca la base directamente.
-- Ningún secreto en la base: las claves viven en variables de entorno.
-- =============================================================================

-- ── Base de conocimiento ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_ai_knowledge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  center_id   uuid NULL,
  category    text NOT NULL,
  question    text NOT NULL,
  answer      text NOT NULL,
  language    text NOT NULL DEFAULT 'es',
  active      boolean NOT NULL DEFAULT true,
  priority    integer NOT NULL DEFAULT 0,
  -- Contenido inicial cargado con el botón: su clave hace la carga idempotente.
  seed_key    text NULL,
  created_by  uuid NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_ai_knowledge_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_ai_knowledge_language_chk CHECK (language ~ '^[a-z]{2}$'),
  CONSTRAINT self_storage_ai_knowledge_category_chk CHECK (category ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT self_storage_ai_knowledge_question_chk CHECK (length(btrim(question)) BETWEEN 1 AND 500),
  CONSTRAINT self_storage_ai_knowledge_answer_chk CHECK (length(btrim(answer)) BETWEEN 1 AND 4000)
);
CREATE UNIQUE INDEX IF NOT EXISTS self_storage_ai_knowledge_seed_uq
  ON self_storage_ai_knowledge (empresa_id, coalesce(center_id, '00000000-0000-0000-0000-000000000000'::uuid), seed_key, language)
  WHERE seed_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS self_storage_ai_knowledge_empresa_idx ON self_storage_ai_knowledge (empresa_id, language, active);

-- ── Sesiones ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_ai_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL,
  call_id             uuid NULL,
  center_id           uuid NULL,
  provider            text NOT NULL,
  model               text NULL,
  language            text NULL,
  mode                text NOT NULL DEFAULT 'console',
  status              text NOT NULL DEFAULT 'active',
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz NULL,
  turns               integer NOT NULL DEFAULT 0,
  input_tokens        integer NOT NULL DEFAULT 0,
  output_tokens       integer NOT NULL DEFAULT 0,
  audio_seconds       integer NOT NULL DEFAULT 0,
  cost_estimate       numeric(10,4) NULL,
  summary             text NULL,
  error               text NULL,
  escalated_at        timestamptz NULL,
  escalation_reason   text NULL,
  -- Calidad: un supervisor revisa y marca.
  flagged_for_review  boolean NOT NULL DEFAULT false,
  flag_reason         text NULL,
  review_status       text NULL,
  review_notes        text NULL,
  reviewed_by         uuid NULL,
  reviewed_at         timestamptz NULL,
  created_by          uuid NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_storage_ai_sessions_id_empresa_uq UNIQUE (id, empresa_id),
  CONSTRAINT self_storage_ai_sessions_call_fk FOREIGN KEY (call_id, empresa_id)
    REFERENCES self_storage_calls (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_ai_sessions_center_fk FOREIGN KEY (center_id, empresa_id)
    REFERENCES self_storage_centers (id, empresa_id) ON DELETE RESTRICT,
  CONSTRAINT self_storage_ai_sessions_provider_chk CHECK (provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
  CONSTRAINT self_storage_ai_sessions_language_chk CHECK (language IS NULL OR language ~ '^[a-z]{2}$'),
  CONSTRAINT self_storage_ai_sessions_mode_chk CHECK (mode IN ('console','call')),
  CONSTRAINT self_storage_ai_sessions_status_chk CHECK (status IN ('active','finished','escalated','error')),
  CONSTRAINT self_storage_ai_sessions_review_chk CHECK (review_status IS NULL OR review_status IN ('correct','partial','incorrect'))
);
CREATE INDEX IF NOT EXISTS self_storage_ai_sessions_empresa_idx ON self_storage_ai_sessions (empresa_id, started_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_ai_sessions_call_idx ON self_storage_ai_sessions (call_id) WHERE call_id IS NOT NULL;

-- ── Mensajes de la sesión ───────────────────────────────────────────────────
-- Hacen falta mientras la sesión está viva (el asistente necesita el hilo).
-- Al terminar se borran salvo que la empresa guarde transcripciones, y la
-- purga por retención se lleva los que queden.
CREATE TABLE IF NOT EXISTS self_storage_ai_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL,
  session_id  uuid NOT NULL,
  role        text NOT NULL,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT self_storage_ai_messages_session_fk FOREIGN KEY (session_id, empresa_id)
    REFERENCES self_storage_ai_sessions (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_ai_messages_role_chk CHECK (role IN ('user','assistant','tool','system')),
  CONSTRAINT self_storage_ai_messages_content_chk CHECK (length(content) <= 20000)
);
CREATE INDEX IF NOT EXISTS self_storage_ai_messages_session_idx ON self_storage_ai_messages (session_id, created_at);

-- ── Herramientas ejecutadas (sólo inserción) ────────────────────────────────
CREATE TABLE IF NOT EXISTS self_storage_ai_tool_calls (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  session_id   uuid NOT NULL,
  call_id      uuid NULL,
  tool         text NOT NULL,
  risk         text NOT NULL,
  actor_type   text NOT NULL DEFAULT 'ai',
  actor_id     uuid NULL,
  params       jsonb NOT NULL DEFAULT '{}'::jsonb,
  result       jsonb NULL,
  outcome      text NOT NULL,
  error        text NULL,
  duration_ms  integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT self_storage_ai_tool_calls_session_fk FOREIGN KEY (session_id, empresa_id)
    REFERENCES self_storage_ai_sessions (id, empresa_id) ON DELETE CASCADE,
  CONSTRAINT self_storage_ai_tool_calls_tool_chk CHECK (tool ~ '^[a-z][a-z0-9_]{1,59}$'),
  CONSTRAINT self_storage_ai_tool_calls_risk_chk CHECK (risk IN ('READ_ONLY','WRITE_SAFE','SENSITIVE','UNKNOWN')),
  CONSTRAINT self_storage_ai_tool_calls_actor_chk CHECK (actor_type IN ('ai','staff')),
  CONSTRAINT self_storage_ai_tool_calls_outcome_chk CHECK (outcome IN ('success','error','blocked'))
);
CREATE INDEX IF NOT EXISTS self_storage_ai_tool_calls_empresa_idx ON self_storage_ai_tool_calls (empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS self_storage_ai_tool_calls_session_idx ON self_storage_ai_tool_calls (session_id, created_at);

CREATE OR REPLACE FUNCTION self_storage_ai_tool_calls_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- El borrado en cascada de una sesión sí se permite.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'self_storage_ai_tool_calls es de sólo inserción' USING ERRCODE = 'insufficient_privilege';
END $$;
DROP TRIGGER IF EXISTS self_storage_ai_tool_calls_guard ON self_storage_ai_tool_calls;
CREATE TRIGGER self_storage_ai_tool_calls_guard BEFORE UPDATE OR DELETE ON self_storage_ai_tool_calls
  FOR EACH ROW EXECUTE FUNCTION self_storage_ai_tool_calls_guard();

-- updated_at
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['self_storage_ai_knowledge','self_storage_ai_sessions'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION self_storage_touch_updated_at()',
      t || '_touch', t
    );
  END LOOP;
END $$;

-- ── RLS: todo cerrado; sólo el servidor ─────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['self_storage_ai_knowledge','self_storage_ai_sessions','self_storage_ai_messages','self_storage_ai_tool_calls'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
