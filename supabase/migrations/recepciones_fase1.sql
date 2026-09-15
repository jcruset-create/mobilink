-- ============================================================
-- Mobilink Recepciones — fase 1: esquema completo (tablas rcp_*).
--
-- Equivalente en código: server/recepciones/schema.ts (initRecepciones), que
-- es la fuente de verdad y se ejecuta en cada arranque del servidor. Este
-- fichero se GENERA capturando esas mismas sentencias, para pegarlo en el SQL
-- Editor de Supabase cuando haga falta prepararlo a mano. Idempotente.
--
-- El módulo controla la RECEPCIÓN FÍSICA de mercancía de proveedores. NO
-- gestiona existencias: aquí no hay ninguna referencia a movimientos_stock ni
-- a ninguna tabla del almacén. La entrada del albarán en GENES la sigue
-- haciendo una persona, después, a mano.
--
-- Va después de saas_modulo_recepciones.sql (licencia y acceso al módulo).
-- ============================================================

CREATE TABLE IF NOT EXISTS rcp_proveedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  nif TEXT,
  remitentes_correo TEXT[] NOT NULL DEFAULT '{}',
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);


CREATE TABLE IF NOT EXISTS rcp_proveedor_articulos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  proveedor_id UUID NOT NULL REFERENCES rcp_proveedores(id) ON DELETE CASCADE,
  referencia_proveedor TEXT,
  descripcion_proveedor TEXT NOT NULL,
  descripcion_normalizada TEXT NOT NULL,
  producto_id UUID,
  producto_texto TEXT,
  ean TEXT,
  estado TEXT NOT NULL DEFAULT 'CONFIRMADO'
    CHECK (estado IN ('SUGERIDO','CONFIRMADO','RECHAZADO')),
  confirmado_por UUID,
  confirmado_nombre TEXT,
  confirmado_at TIMESTAMPTZ,
  veces_usado INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, proveedor_id, descripcion_normalizada)
);
CREATE INDEX IF NOT EXISTS rcp_prov_art_ean_idx
  ON rcp_proveedor_articulos(empresa_id, ean) WHERE ean IS NOT NULL;


CREATE TABLE IF NOT EXISTS rcp_pedidos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  proveedor_id UUID NOT NULL REFERENCES rcp_proveedores(id),
  numero_proveedor TEXT NOT NULL,
  numero_normalizado TEXT NOT NULL,
  fecha_pedido DATE,
  usuario_pedido TEXT,
  centro_id UUID,
  centro_nombre TEXT NOT NULL DEFAULT '',
  almacen_origen TEXT,
  transportista TEXT,
  estado TEXT NOT NULL DEFAULT 'PENDIENTE_EXPEDICION'
    CHECK (estado IN ('PENDIENTE_EXPEDICION','PARCIALMENTE_EXPEDIDO','EXPEDIDO','COMPLETADO','CANCELADO')),
  cancelado_at TIMESTAMPTZ,
  cancelado_por UUID,
  cancelado_motivo TEXT,
  observaciones TEXT,
  origen TEXT NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('MANUAL','CORREO')),
  external_message_id TEXT,
  source_received_at TIMESTAMPTZ,
  creado_por UUID,
  creado_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, proveedor_id, numero_normalizado)
);
CREATE INDEX IF NOT EXISTS rcp_pedidos_estado_idx ON rcp_pedidos(empresa_id, estado, centro_id);
CREATE INDEX IF NOT EXISTS rcp_pedidos_fecha_idx ON rcp_pedidos(empresa_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS rcp_pedidos_msg_idx
  ON rcp_pedidos(empresa_id, external_message_id) WHERE external_message_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS rcp_pedido_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  pedido_id UUID NOT NULL REFERENCES rcp_pedidos(id) ON DELETE CASCADE,
  numero_linea INTEGER NOT NULL,
  referencia_proveedor TEXT,
  descripcion_proveedor TEXT NOT NULL,
  producto_id UUID,
  producto_texto TEXT,
  mapeo_id UUID REFERENCES rcp_proveedor_articulos(id) ON DELETE SET NULL,
  cantidad_pedida NUMERIC(12,3) NOT NULL CHECK (cantidad_pedida > 0),
  precio_unitario_centimos BIGINT,
  -- Acumulados: se recalculan en la transacción que los cambia.
  cantidad_expedida NUMERIC(12,3) NOT NULL DEFAULT 0,
  cantidad_recibida NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, numero_linea)
);
CREATE INDEX IF NOT EXISTS rcp_pedido_lineas_pedido_idx ON rcp_pedido_lineas(pedido_id);


CREATE TABLE IF NOT EXISTS rcp_albaranes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  proveedor_id UUID NOT NULL REFERENCES rcp_proveedores(id),
  pedido_id UUID NOT NULL REFERENCES rcp_pedidos(id),
  numero_proveedor TEXT NOT NULL,
  numero_normalizado TEXT NOT NULL,
  fecha_expedicion DATE,
  transportista TEXT,
  estado TEXT NOT NULL DEFAULT 'EN_TRANSITO'
    CHECK (estado IN ('EMITIDO','EN_TRANSITO','PARCIALMENTE_RECIBIDO','RECIBIDO','RECIBIDO_CON_INCIDENCIA')),
  cerrado_at TIMESTAMPTZ,
  cerrado_por UUID,
  cerrado_motivo TEXT,
  observaciones TEXT,
  origen TEXT NOT NULL DEFAULT 'MANUAL' CHECK (origen IN ('MANUAL','CORREO')),
  external_message_id TEXT,
  source_received_at TIMESTAMPTZ,
  enlace_pdf_proveedor TEXT,
  creado_por UUID,
  creado_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, proveedor_id, numero_normalizado)
);
CREATE INDEX IF NOT EXISTS rcp_albaranes_pedido_idx ON rcp_albaranes(pedido_id);
CREATE INDEX IF NOT EXISTS rcp_albaranes_estado_idx ON rcp_albaranes(empresa_id, estado);
CREATE UNIQUE INDEX IF NOT EXISTS rcp_albaranes_msg_idx
  ON rcp_albaranes(empresa_id, external_message_id) WHERE external_message_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS rcp_albaran_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  albaran_id UUID NOT NULL REFERENCES rcp_albaranes(id) ON DELETE CASCADE,
  pedido_linea_id UUID REFERENCES rcp_pedido_lineas(id),
  numero_linea INTEGER NOT NULL,
  referencia_proveedor TEXT,
  descripcion_proveedor TEXT NOT NULL,
  producto_id UUID,
  producto_texto TEXT,
  cantidad_expedida NUMERIC(12,3) NOT NULL CHECK (cantidad_expedida > 0),
  -- Acumulado de TODAS las recepciones de esta línea (y sus rectificaciones).
  cantidad_recibida NUMERIC(12,3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (albaran_id, numero_linea)
);
CREATE INDEX IF NOT EXISTS rcp_albaran_lineas_albaran_idx ON rcp_albaran_lineas(albaran_id);


CREATE TABLE IF NOT EXISTS rcp_recepciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  numero TEXT NOT NULL,
  albaran_id UUID NOT NULL REFERENCES rcp_albaranes(id),
  pedido_id UUID NOT NULL REFERENCES rcp_pedidos(id),
  proveedor_id UUID NOT NULL REFERENCES rcp_proveedores(id),
  centro_id UUID,
  centro_nombre TEXT NOT NULL DEFAULT '',
  resultado TEXT NOT NULL CHECK (resultado IN ('OK','CON_INCIDENCIA')),
  recibido_por UUID NOT NULL,
  recibido_nombre TEXT NOT NULL,
  recibido_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  observaciones TEXT,
  idempotency_key TEXT,
  documento_id UUID,
  documento_estado TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (documento_estado IN ('PENDIENTE','GENERADO','ERROR')),
  documento_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX IF NOT EXISTS rcp_recepciones_albaran_idx ON rcp_recepciones(albaran_id);
CREATE INDEX IF NOT EXISTS rcp_recepciones_fecha_idx ON rcp_recepciones(empresa_id, recibido_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS rcp_recepciones_idem_idx
  ON rcp_recepciones(empresa_id, idempotency_key) WHERE idempotency_key IS NOT NULL;


CREATE TABLE IF NOT EXISTS rcp_recepcion_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  recepcion_id UUID NOT NULL REFERENCES rcp_recepciones(id) ON DELETE CASCADE,
  albaran_linea_id UUID NOT NULL REFERENCES rcp_albaran_lineas(id),
  descripcion_proveedor TEXT NOT NULL,
  producto_texto TEXT,
  -- Instantánea en el momento de cerrar: lo que decía el albarán y lo que
  -- quedaba por recibir. Con eso el documento se explica solo un año después.
  cantidad_expedida NUMERIC(12,3) NOT NULL,
  cantidad_esperada NUMERIC(12,3) NOT NULL,
  cantidad_recibida NUMERIC(12,3) NOT NULL CHECK (cantidad_recibida >= 0),
  diferencia NUMERIC(12,3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recepcion_id, albaran_linea_id)
);


CREATE TABLE IF NOT EXISTS rcp_incidencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  recepcion_id UUID NOT NULL REFERENCES rcp_recepciones(id),
  recepcion_linea_id UUID REFERENCES rcp_recepcion_lineas(id),
  albaran_id UUID NOT NULL REFERENCES rcp_albaranes(id),
  albaran_linea_id UUID REFERENCES rcp_albaran_lineas(id),
  pedido_id UUID NOT NULL REFERENCES rcp_pedidos(id),
  proveedor_id UUID NOT NULL REFERENCES rcp_proveedores(id),
  centro_id UUID,
  centro_nombre TEXT NOT NULL DEFAULT '',
  transportista TEXT,
  tipo TEXT NOT NULL CHECK (tipo IN ('FALTA_MERCANCIA','SOBRA_MERCANCIA','PRODUCTO_INCORRECTO','MERCANCIA_DANADA','EMBALAJE_DANADO','OTRO')),
  descripcion_producto TEXT NOT NULL,
  cantidad_esperada NUMERIC(12,3) NOT NULL,
  cantidad_recibida NUMERIC(12,3) NOT NULL,
  diferencia NUMERIC(12,3) NOT NULL,
  observaciones TEXT,
  estado TEXT NOT NULL DEFAULT 'ABIERTA'
    CHECK (estado IN ('ABIERTA','EN_GESTION','RESUELTA','CANCELADA')),
  resolucion TEXT,
  creada_por UUID NOT NULL,
  creada_nombre TEXT NOT NULL,
  resuelta_por UUID,
  resuelta_nombre TEXT,
  resuelta_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rcp_incidencias_estado_idx ON rcp_incidencias(empresa_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS rcp_incidencias_albaran_idx ON rcp_incidencias(albaran_id);


CREATE TABLE IF NOT EXISTS rcp_rectificaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  numero TEXT NOT NULL,
  recepcion_id UUID NOT NULL REFERENCES rcp_recepciones(id),
  albaran_id UUID NOT NULL REFERENCES rcp_albaranes(id),
  motivo TEXT NOT NULL,
  rectificado_por UUID NOT NULL,
  rectificado_nombre TEXT NOT NULL,
  rectificado_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);
CREATE TABLE IF NOT EXISTS rcp_rectificacion_lineas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rectificacion_id UUID NOT NULL REFERENCES rcp_rectificaciones(id) ON DELETE CASCADE,
  recepcion_linea_id UUID NOT NULL REFERENCES rcp_recepcion_lineas(id),
  albaran_linea_id UUID NOT NULL REFERENCES rcp_albaran_lineas(id),
  cantidad_anterior NUMERIC(12,3) NOT NULL,
  cantidad_nueva NUMERIC(12,3) NOT NULL CHECK (cantidad_nueva >= 0),
  UNIQUE (rectificacion_id, recepcion_linea_id)
);
CREATE INDEX IF NOT EXISTS rcp_rectificaciones_recepcion_idx ON rcp_rectificaciones(recepcion_id);


CREATE TABLE IF NOT EXISTS rcp_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ALBARAN_ORIGINAL','ALBARAN_RECEPCION','OTRO')),
  albaran_id UUID REFERENCES rcp_albaranes(id),
  recepcion_id UUID REFERENCES rcp_recepciones(id),
  nombre_fichero TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  hash_sha256 TEXT NOT NULL,
  tamano_bytes BIGINT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/pdf',
  origen TEXT NOT NULL CHECK (origen IN ('SUBIDA_MANUAL','CORREO','DESCARGA_PROVEEDOR','GENERADO')),
  generado_desde_hash TEXT,
  subido_por UUID,
  subido_nombre TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rcp_documentos_albaran_idx ON rcp_documentos(albaran_id);
CREATE INDEX IF NOT EXISTS rcp_documentos_recepcion_idx ON rcp_documentos(recepcion_id);
-- Un albarán tiene UN original. Subir otro es un error, no una sustitución.
CREATE UNIQUE INDEX IF NOT EXISTS rcp_documentos_original_idx
  ON rcp_documentos(albaran_id) WHERE tipo = 'ALBARAN_ORIGINAL';


CREATE TABLE IF NOT EXISTS rcp_eventos (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL,
  pedido_id UUID,
  albaran_id UUID,
  recepcion_id UUID,
  incidencia_id UUID,
  tipo TEXT NOT NULL,
  actor_tipo TEXT NOT NULL DEFAULT 'usuario' CHECK (actor_tipo IN ('sistema','usuario')),
  usuario_id UUID,
  usuario_nombre TEXT,
  datos JSONB,
  descripcion TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  huella TEXT
);
CREATE INDEX IF NOT EXISTS rcp_eventos_pedido_idx ON rcp_eventos(pedido_id, occurred_at);
CREATE INDEX IF NOT EXISTS rcp_eventos_albaran_idx ON rcp_eventos(albaran_id, occurred_at);


CREATE OR REPLACE FUNCTION rcp_eventos_huella() RETURNS TRIGGER AS $$
BEGIN
  NEW.huella := encode(sha256(convert_to(
    NEW.empresa_id::text                   || '|' ||
    COALESCE(NEW.pedido_id::text,'')       || '|' ||
    COALESCE(NEW.albaran_id::text,'')      || '|' ||
    COALESCE(NEW.recepcion_id::text,'')    || '|' ||
    NEW.tipo                               || '|' ||
    COALESCE(NEW.usuario_id::text,'')      || '|' ||
    NEW.occurred_at::text                  || '|' ||
    COALESCE(NEW.datos::text,''),
    'UTF8')), 'hex');
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rcp_eventos_huella_trg ON rcp_eventos;
CREATE TRIGGER rcp_eventos_huella_trg
  BEFORE INSERT ON rcp_eventos
  FOR EACH ROW EXECUTE FUNCTION rcp_eventos_huella();

CREATE OR REPLACE FUNCTION rcp_eventos_solo_insertar() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'rcp_eventos es inmutable: no se puede % un evento. Una correccion se registra como un evento nuevo.',
    TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rcp_eventos_inmutable_trg ON rcp_eventos;
CREATE TRIGGER rcp_eventos_inmutable_trg
  BEFORE UPDATE OR DELETE ON rcp_eventos
  FOR EACH ROW EXECUTE FUNCTION rcp_eventos_solo_insertar();


CREATE TABLE IF NOT EXISTS rcp_contadores (
  empresa_id UUID NOT NULL,
  serie TEXT NOT NULL,
  anio INTEGER NOT NULL,
  last_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id, serie, anio)
);


DO $migracion$
DECLARE v_lista TEXT;
BEGIN
  SELECT string_agg(quote_literal(m), ',' ORDER BY m) INTO v_lista
  FROM (
    SELECT unnest(ARRAY['administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety',
                        'presencia','taller','workplanner','cash','central','tacografos','assist',
                        'therefore','recepciones']) AS m
    UNION SELECT modulo FROM app_usuario_modulos
  ) t;
  EXECUTE 'ALTER TABLE app_usuario_modulos DROP CONSTRAINT IF EXISTS app_usuario_modulos_modulo_check';
  EXECUTE format('ALTER TABLE app_usuario_modulos ADD CONSTRAINT app_usuario_modulos_modulo_check CHECK (modulo IN (%s))', v_lista);
END
$migracion$;

