/**
 * Esquema del módulo Recepciones (prefijo `rcp_`).
 *
 * Se crea al arrancar, idempotente, como todo lo demás del servidor
 * (`prepararEsquema` en `server/index.ts`). El `.sql` gemelo para pegar en el
 * SQL Editor de Supabase está en `supabase/migrations/recepciones_fase1.sql`.
 *
 * ── Qué controla este módulo y qué NO ───────────────────────────────────────
 *
 * Controla la RECEPCIÓN FÍSICA de mercancía de proveedores: qué se pidió, qué
 * expidió el proveedor, qué llegó, quién lo contó, cuándo, con qué resultado
 * y qué papel quedó firmado. NO gestiona existencias: no escribe en
 * `movimientos_stock`, no conoce el saldo de ningún artículo, no integra con
 * GENES. La entrada del albarán en el ERP la sigue haciendo una persona,
 * después, a mano. Cuando ese paso se automatice, tendrá su propia columna
 * (`genes_*`) y su propio evento; hoy no existe ni como campo.
 *
 * ── Tres cantidades, tres tablas ────────────────────────────────────────────
 *
 *   pedida    → rcp_pedido_lineas       lo que se encargó
 *   expedida  → rcp_albaran_lineas      lo que el proveedor dice que salió
 *   recibida  → rcp_recepcion_lineas    lo que se contó en el muelle
 *
 * Las dos primeras tablas llevan además un acumulado (`cantidad_expedida` en
 * la línea de pedido, `cantidad_recibida` en la del albarán) que se recalcula
 * dentro de la misma transacción que cambia las cantidades. Es
 * desnormalización a propósito: la bandeja lista cientos de albaranes y no
 * puede sumar recepciones por cada uno.
 *
 * ── Lo que no se toca nunca ─────────────────────────────────────────────────
 *
 * Una recepción cerrada no se edita: se rectifica con una fila de
 * `rcp_rectificaciones` que dice qué cambió, quién y por qué. Y `rcp_eventos`
 * es inmutable por trigger, como `thf_eventos` y `app_auditoria`.
 */

import pool from "../db.ts";

export async function initRecepciones(): Promise<void> {
  // ── Proveedores de mercancía ──────────────────────────────────────────────
  //
  // Tabla propia y no `sea_suppliers` (EPIs y herramientas, sin API) ni
  // `connect_provider_companies` (proveedores de SERVICIO): un proveedor de
  // neumáticos es otra cosa y necesita, entre otras, la lista de remitentes
  // desde los que manda correos, que es lo que usará la fase siguiente.
  await pool.query(`
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
  `);

  // ── Mapeo artículo del proveedor → artículo Mobilink ─────────────────────
  //
  // `producto_id` es un UUID sin clave ajena: el maestro del almacén
  // (`productos_neumaticos`) no tiene esquema versionado en el repositorio y
  // este módulo no debe depender de que exista. `producto_texto` es lo que se
  // enseña. Recepcionar NUNCA exige que haya mapeo: sin él, la pantalla dice
  // «artículo sin mapear» y se cuenta por la descripción del proveedor.
  await pool.query(`
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
  `);

  // ── Pedidos ───────────────────────────────────────────────────────────────
  //
  // `numero_normalizado` es el núcleo del número del proveedor (ver
  // domain/numero.ts) y lleva el UNIQUE: «B-2026-5688837» y «5688837» son el
  // mismo pedido y no pueden existir dos veces. Las columnas `origen`,
  // `external_message_id` y `source_received_at` están ya para la fase del
  // correo: hoy todo entra MANUAL y esas dos van a NULL.
  //
  // `centro_id` apunta a `app_centros` sin clave ajena (la fundación SaaS se
  // aplica a mano y una base de pruebas puede no tenerla); `centro_nombre` es
  // lo que se enseña y lo que se imprime.
  await pool.query(`
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
  `);

  await pool.query(`
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
  `);

  // ── Operarios del muelle ──────────────────────────────────────────────────
  //
  // Quien cuenta la mercancía casi nunca es quien tiene la sesión de Mobilink
  // abierta: el tablet del muelle lo abre un encargado por la mañana y por él
  // pasan cinco personas. Este padrón es el de esas personas, y su PIN es lo
  // que firma la recepción.
  //
  // Tabla propia porque no hay ninguna reutilizable: `techs` es el taller
  // (sin PIN ni empresa) y `connect_lite_users` son los operarios de los
  // talleres de Connect (con `workshopId`, otro censo). Lo que SÍ se reutiliza
  // es el hasheo, `server/core/credentials.ts`, que ya existía justo para
  // esto: PBKDF2-SHA256 con salt por credencial. El PIN nunca se guarda.
  //
  // `centro_id` NULL significa «vale en todos los centros»; con centro, el
  // operario sólo aparece y sólo firma en el suyo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rcp_operarios (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      centro_id UUID,
      nombre TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      pin_salt TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT true,
      -- Freno a la fuerza bruta: cuatro dígitos son 10.000 combinaciones.
      intentos_fallidos INTEGER NOT NULL DEFAULT 0,
      bloqueado_hasta TIMESTAMPTZ,
      creado_por UUID,
      creado_nombre TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (empresa_id, nombre)
    );
    CREATE INDEX IF NOT EXISTS rcp_operarios_centro_idx ON rcp_operarios(empresa_id, centro_id) WHERE activo;
  `);

  // ── Albaranes (expediciones del proveedor) ────────────────────────────────
  //
  // Un pedido, N albaranes. Que el proveedor emita un albarán NO significa que
  // la mercancía esté aquí: el albarán nace EN_TRANSITO y sólo una recepción
  // física, hecha por un usuario de Mobilink, lo mueve de ahí.
  //
  // `cerrado_at` es la decisión de un gestor de dar el albarán por terminado
  // con unidades de menos (diferencia aceptada). Sin esa decisión, lo que
  // falta sigue pendiente de recibir.
  await pool.query(`
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
  `);

  await pool.query(`
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
  `);

  // ── Recepciones físicas ───────────────────────────────────────────────────
  //
  // El acto de contar en el muelle. `recibido_por`, `recibido_nombre` y
  // `recibido_at` los pone el servidor con el usuario autenticado y `now()`:
  // el operario no escribe ninguno de los tres.
  //
  // `idempotency_key` la genera la pantalla al abrirse: un doble toque en
  // «RECEPCIÓN OK» devuelve la misma recepción en vez de crear dos.
  //
  // Una recepción no se actualiza nunca en lo de negocio. Sólo `documento_*`,
  // que es estado técnico de la generación del PDF.
  await pool.query(`
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
  `);

  await pool.query(`
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
  `);

  // ── Incidencias ───────────────────────────────────────────────────────────
  //
  // Estructuradas, no un texto: producto, esperado, recibido, diferencia y
  // tipo, además de las dimensiones (proveedor, centro, transportista) que
  // son las de las estadísticas de más adelante. Van repetidas a propósito
  // para no cruzar cuatro tablas por consulta.
  await pool.query(`
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
  `);

  // ── Rectificaciones ───────────────────────────────────────────────────────
  //
  // La única forma de corregir una recepción cerrada. La recepción original no
  // cambia; aquí queda quién, cuándo, por qué y qué cantidad pasa a valer cada
  // línea. Los acumulados del albarán y del pedido se recalculan con la
  // corrección, así que la bandeja siempre dice la verdad actual y el
  // histórico siempre dice lo que se contó al principio.
  await pool.query(`
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
  `);

  // ── Documentos ────────────────────────────────────────────────────────────
  //
  // Un fichero, una fila; nunca se sobrescribe, se añade otro. El ORIGINAL del
  // proveedor se guarda byte a byte y el RECEPCIONADO se genera aparte con el
  // sello. `hash_sha256` se calcula sobre el buffer ANTES de subirlo, como en
  // caja: certificar lo que hay en el bucket sería certificar lo que se quiere
  // poder comprobar.
  await pool.query(`
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
  `);

  // ── Histórico inmutable ───────────────────────────────────────────────────
  await pool.query(`
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
  `);

  await pool.query(`
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
  `);

  // ── Numeración ────────────────────────────────────────────────────────────
  //
  // Una serie por empresa, tipo y año: REC-2026-00018452, RECT-2026-00007. El
  // `INSERT … ON CONFLICT DO UPDATE … RETURNING` es atómico, así que dos
  // recepciones cerradas a la vez no pueden coger el mismo número; y si aun
  // así lo cogieran, el UNIQUE de (empresa_id, numero) lo rechazaría.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rcp_contadores (
      empresa_id UUID NOT NULL,
      serie TEXT NOT NULL,
      anio INTEGER NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (empresa_id, serie, anio)
    );
  `);

  /* ══ Fase 2: el correo del proveedor ══════════════════════════════════════ */

  // ── Cada correo que llega ─────────────────────────────────────────────────
  //
  // Un correo, una fila; el texto NUNCA se edita: es la única prueba de qué
  // dijo el proveedor cuando el parser se equivoque. El UNIQUE de
  // (empresa_id, message_id) es la idempotencia: la garantía está en la base
  // y no en un «¿ya existe?», porque dos pasadas a la vez pasarían las dos.
  //
  // `resultado`: PROCESADO (creó o asoció algo), DUPLICADO (ya se había
  // procesado o el pedido/albarán ya existía), IGNORADO (no es de un proveedor
  // conocido o no se reconoce), PENDIENTE_REVISION (se entendió pero falta
  // algo: el pedido del albarán no existe, o no hay líneas) y ERROR (falló
  // algo técnico; el buzón lo deja sin leer y se reintenta).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rcp_correos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      proveedor_id UUID REFERENCES rcp_proveedores(id) ON DELETE SET NULL,
      message_id TEXT NOT NULL,
      in_reply_to TEXT,
      hash_contenido TEXT,
      asunto TEXT NOT NULL DEFAULT '',
      remitente TEXT,
      fecha TIMESTAMPTZ,
      texto TEXT NOT NULL DEFAULT '',
      tipo TEXT NOT NULL DEFAULT 'DESCONOCIDO' CHECK (tipo IN ('PEDIDO','ALBARAN','DESCONOCIDO')),
      resultado TEXT NOT NULL DEFAULT 'RECIBIDO'
        CHECK (resultado IN ('RECIBIDO','PROCESADO','DUPLICADO','IGNORADO','PENDIENTE_REVISION','ERROR')),
      motivo TEXT,
      datos_extraidos JSONB,
      avisos TEXT[] NOT NULL DEFAULT '{}',
      pedido_id UUID REFERENCES rcp_pedidos(id) ON DELETE SET NULL,
      albaran_id UUID REFERENCES rcp_albaranes(id) ON DELETE SET NULL,
      origen TEXT NOT NULL DEFAULT 'buzon' CHECK (origen IN ('buzon','eml','api')),
      intentos INTEGER NOT NULL DEFAULT 0,
      procesado_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (empresa_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS rcp_correos_resultado_idx ON rcp_correos(empresa_id, resultado, created_at DESC);
    CREATE INDEX IF NOT EXISTS rcp_correos_fecha_idx ON rcp_correos(empresa_id, created_at DESC);
  `);

  // ── Cada pasada del buzón ─────────────────────────────────────────────────
  //
  // Para contestar «¿está leyendo el buzón?» sin entrar en el servidor. Una
  // pasada sin correos también se registra: que no haya nada que leer es
  // información, y una tabla que sólo crece cuando llega algo no distingue
  // «tranquilo» de «caído».
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rcp_buzon_pasadas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      iniciada_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      terminada_at TIMESTAMPTZ,
      correos INTEGER NOT NULL DEFAULT 0,
      procesados INTEGER NOT NULL DEFAULT 0,
      ignorados INTEGER NOT NULL DEFAULT 0,
      errores INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      detalle JSONB NOT NULL DEFAULT '[]',
      origen TEXT NOT NULL DEFAULT 'temporizador' CHECK (origen IN ('temporizador','manual','historico','eml'))
    );
    CREATE INDEX IF NOT EXISTS rcp_buzon_pasadas_idx ON rcp_buzon_pasadas(empresa_id, iniciada_at DESC);
  `);

  // ── Configuración por empresa ─────────────────────────────────────────────
  //
  // Clave/valor, como `thf_config`. Sólo guarda lo que alguien ha cambiado;
  // los valores por defecto viven en `config.ts`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rcp_config (
      empresa_id UUID NOT NULL,
      clave TEXT NOT NULL,
      valor TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (empresa_id, clave)
    );
  `);

  // El destino literal del correo (dirección completa): `centro_nombre` se
  // queda con la localidad, y aquí se conserva lo que decía el proveedor.
  await pool.query(`ALTER TABLE rcp_pedidos ADD COLUMN IF NOT EXISTS destino_texto TEXT;`);
  await pool.query(`ALTER TABLE rcp_pedidos ADD COLUMN IF NOT EXISTS cliente_proveedor TEXT;`);
  // Un pedido que no mandó el proveedor: lo dedujimos de su albarán. Mientras
  // sea true, la cantidad pedida es «lo expedido hasta ahora», no lo que se pidió.
  await pool.query(`ALTER TABLE rcp_pedidos ADD COLUMN IF NOT EXISTS derivado_de_albaran BOOLEAN NOT NULL DEFAULT FALSE;`);

  // Quién contó la mercancía, confirmado con su PIN. Es lo que firma el
  // documento. `recibido_por` sigue siendo la SESIÓN desde la que se cerró:
  // las dos cosas se guardan porque las dos hacen falta para responder «¿quién
  // dijo que esto llegó?» y «¿desde qué usuario se registró?».
  await pool.query(`ALTER TABLE rcp_recepciones ADD COLUMN IF NOT EXISTS operario_id UUID;`);
  await pool.query(`ALTER TABLE rcp_recepciones ADD COLUMN IF NOT EXISTS operario_nombre TEXT;`);

  // El móvil que venía escrito en las observaciones del albarán del proveedor
  // («PEDRO 610473077»). Se guarda aparte porque un teléfono dentro de una
  // frase no sirve para avisar a nadie, y en su columna sí.
  await pool.query(`ALTER TABLE rcp_albaranes ADD COLUMN IF NOT EXISTS telefono_contacto TEXT;`);

  // El PDF adjunto de un correo que TODAVÍA no ha dado un albarán. Hay
  // proveedores que no cuentan nada en el cuerpo y lo mandan todo en el
  // adjunto (ver `domain/insa.ts`); si ese correo queda en revisión, el
  // adjunto tiene que sobrevivir, o «Reprocesar» vuelve a mirar un correo
  // vacío y falla igual. Cuando el albarán se crea, su original se guarda
  // aparte con `albaran_id`: esta columna es la del correo, no la de nadie más.
  await pool.query(`ALTER TABLE rcp_documentos ADD COLUMN IF NOT EXISTS correo_id UUID;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS rcp_documentos_correo_idx ON rcp_documentos(correo_id);`);

  // ── Avisos al que espera la mercancía ─────────────────────────────────────
  //
  // Al cerrar una recepción OK se le manda un WhatsApp a quien figura en las
  // observaciones del albarán, si dejó su móvil. Cada intento deja fila: a
  // quién, cuándo, con qué resultado y por qué no, si no salió.
  //
  // Tabla y no una columna en la recepción porque un aviso se reintenta, y
  // porque «no se mandó» tiene motivos que hay que poder leer («sin teléfono»,
  // «apagado», «Twilio dijo…»). Una recepción puede tener varios intentos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rcp_avisos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      recepcion_id UUID NOT NULL REFERENCES rcp_recepciones(id) ON DELETE CASCADE,
      albaran_id UUID NOT NULL REFERENCES rcp_albaranes(id),
      canal TEXT NOT NULL DEFAULT 'WHATSAPP' CHECK (canal IN ('WHATSAPP')),
      destinatario TEXT,
      telefono TEXT,
      estado TEXT NOT NULL CHECK (estado IN ('ENVIADO','OMITIDO','ERROR')),
      motivo TEXT,
      -- El identificador que devuelve Twilio, para cruzarlo con su panel.
      referencia_externa TEXT,
      creado_por UUID,
      creado_nombre TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS rcp_avisos_recepcion_idx ON rcp_avisos(recepcion_id);
    CREATE INDEX IF NOT EXISTS rcp_avisos_fecha_idx ON rcp_avisos(empresa_id, created_at DESC);
  `);

  // El aviso no siempre es «ha llegado tu material»: también se avisa a
  // recepción de que un albarán ha entrado SIN su PDF, para que lo suban a
  // mano. Ése no tiene recepción detrás, de ahí que la columna deje de ser
  // obligatoria.
  await pool.query(`ALTER TABLE rcp_avisos ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'MATERIAL_RECIBIDO';`);
  await pool.query(`ALTER TABLE rcp_avisos ALTER COLUMN recepcion_id DROP NOT NULL;`);

  await registrarModuloRecepciones();
}

/**
 * Da de alta `recepciones` en los CHECK de licencias y accesos, reconstruyendo
 * la lista con la UNIÓN de lo que ya haya guardado y lo que este módulo
 * necesita. Misma forma que `saas_modulo_therefore.sql`, y se hace también
 * aquí porque `server/db.ts` y `server/central/schema.ts` reescriben ese CHECK
 * en cada arranque: el último que corre gana, y los tres tienen que llevar la
 * misma lista.
 */
async function registrarModuloRecepciones(): Promise<void> {
  for (const [tabla, restriccion] of [
    ["app_licencias", "app_licencias_modulo_check"],
    ["app_usuario_modulos", "app_usuario_modulos_modulo_check"],
  ]) {
    const { rows } = await pool.query(`SELECT to_regclass($1) IS NOT NULL AS hay`, [`public.${tabla}`]);
    if (!rows[0]?.hay) continue;
    await pool
      .query(
        `
        DO $migracion$
        DECLARE v_lista TEXT;
        BEGIN
          SELECT string_agg(quote_literal(m), ',' ORDER BY m) INTO v_lista
          FROM (
            SELECT unnest(ARRAY['administracion','tyrecontrol','almacen','sea-core','toolcontrol','safety',
                                'presencia','taller','workplanner','cash','central','tacografos','assist',
                                'therefore','recepciones']) AS m
            UNION SELECT modulo FROM ${tabla}
          ) t;
          EXECUTE 'ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${restriccion}';
          EXECUTE format('ALTER TABLE ${tabla} ADD CONSTRAINT ${restriccion} CHECK (modulo IN (%s))', v_lista);
        END
        $migracion$;
      `
      )
      .catch((e) => console.warn(`Recepciones: no se ha podido registrar el módulo en ${tabla}:`, e?.message ?? e));
  }
}
