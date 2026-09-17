/**
 * Esquema del módulo OR Manuales (prefijo `orm_`).
 *
 * Se crea al arrancar, idempotente, como el resto del servidor
 * (`prepararEsquema` en `server/index.ts`). El `.sql` gemelo para pegar en el
 * SQL Editor de Supabase está en `supabase/migrations/or_manuales_fase1.sql`.
 *
 * ── Qué controla este módulo ────────────────────────────────────────────────
 *
 * El ciclo de vida del papel: los blocs de órdenes de reparación manuales que
 * el taller usa cuando no hay sistema delante. Un bloc son 25 OR consecutivas
 * y una hoja por OR. El módulo sabe qué blocs hay, quién se llevó cada uno,
 * cuándo volvió, qué hojas se han escaneado y —lo que de verdad importa— cuáles
 * FALTAN.
 *
 * NO gestiona reparaciones: una OR de aquí es una hoja de papel con un número,
 * no un expediente de trabajo. El día que se enlace con la reparación real
 * tendrá su propia columna y su propio evento; hoy no existe ni como campo.
 *
 * ── Cuatro tablas y por qué son cuatro ──────────────────────────────────────
 *
 *   orm_blocs       el taco de papel      ..... qué rango cubre y dónde está
 *   orm_or          cada hoja             ..... una fila por número, siempre
 *   orm_documentos  cada escaneo          ..... el fichero y de dónde salió
 *   orm_entregas    cada salida y vuelta  ..... el histórico de custodia
 *
 * `orm_or` se crea ENTERA al crear el bloc, con las 25 filas en PENDIENTE. Es
 * la decisión que hace que «faltan la 1032 y la 1047» sea una consulta y no un
 * cálculo: lo que falta son las filas que nadie ha tocado. Si las OR nacieran
 * al escanearlas, la pregunta «qué falta» no tendría respuesta en la base.
 *
 * `orm_entregas` existe aparte de las fechas del bloc porque un bloc puede
 * salir y volver más de una vez —se entrega, vuelve a medias, se vuelve a
 * sacar— y las fechas de la ficha sólo pueden contar la última. El histórico
 * está en la tabla.
 *
 * ── Lo que no se toca nunca ─────────────────────────────────────────────────
 *
 * `orm_eventos` es inmutable por trigger, como `rcp_eventos`, `thf_eventos` y
 * `app_auditoria`. Un documento sustituido no se borra: se queda en
 * SUSTITUIDO con su fichero, porque «qué había antes aquí» es justo lo que se
 * pregunta cuando algo no cuadra.
 */

import pool from "../db.ts";

export async function initOrManuales(): Promise<void> {
  // ── El bloc físico ────────────────────────────────────────────────────────
  //
  // `responsable_id` es un UUID SIN clave ajena, como en el resto de módulos
  // nuevos: apunta a `app_usuarios`, que es de la fundación SaaS y se aplica a
  // mano; una base de pruebas puede no tenerla. `responsable_nombre` guarda el
  // nombre en el momento de la entrega: quién lo tenía no cambia porque
  // después alguien se case y cambie de apellido.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orm_blocs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      numero_bloc TEXT NOT NULL,
      or_inicial INTEGER NOT NULL,
      or_final INTEGER NOT NULL,
      cantidad_or INTEGER NOT NULL DEFAULT 25,
      responsable_id UUID,
      responsable_nombre TEXT,
      fecha_creacion DATE NOT NULL DEFAULT CURRENT_DATE,
      fecha_entrega DATE,
      fecha_devolucion DATE,
      estado TEXT NOT NULL DEFAULT 'DISPONIBLE'
        CHECK (estado IN ('DISPONIBLE','ENTREGADO','DEVUELTO','PENDIENTE_ESCANEO','INCOMPLETO','REVISAR','COMPLETO','CERRADO')),
      observaciones TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ,
      closed_by UUID,
      CHECK (or_final >= or_inicial),
      UNIQUE (empresa_id, numero_bloc)
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_blocs_empresa_estado ON orm_blocs (empresa_id, estado);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_blocs_rango ON orm_blocs (empresa_id, or_inicial, or_final);`);

  // ── Cada OR del bloc ──────────────────────────────────────────────────────
  //
  // El UNIQUE de (empresa_id, numero_or) es la regla «una OR pertenece a un
  // solo bloc», y está en la BASE y no en una comprobación previa a propósito:
  // dos blocs creados a la vez con rangos que se pisan pasarían las dos
  // comprobaciones y sólo el índice puede pararlos.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orm_or (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      bloc_id UUID NOT NULL REFERENCES orm_blocs(id) ON DELETE CASCADE,
      numero_or INTEGER NOT NULL,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','ESCANEADA','REVISAR','DUPLICADA','ERROR')),
      documento_principal_id UUID,
      fecha_escaneo TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (empresa_id, numero_or)
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_or_bloc ON orm_or (bloc_id, numero_or);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_or_estado ON orm_or (empresa_id, estado);`);

  // ── El lote que alguien sube ──────────────────────────────────────────────
  //
  // Se crea ANTES de procesar nada y sobrevive al proceso: si el servidor se
  // reinicia a mitad de un PDF de 200 páginas, la fila queda en EN_CURSO y se
  // ve en la pantalla. Un procesamiento que sólo existe en memoria es un
  // procesamiento del que nadie puede decir qué pasó.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orm_procesamientos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      archivo_original TEXT NOT NULL,
      storage_key_original TEXT,
      hash_original TEXT,
      mime TEXT,
      paginas INTEGER NOT NULL DEFAULT 0,
      paginas_procesadas INTEGER NOT NULL DEFAULT 0,
      documentos_detectados INTEGER NOT NULL DEFAULT 0,
      documentos_correctos INTEGER NOT NULL DEFAULT 0,
      documentos_revision INTEGER NOT NULL DEFAULT 0,
      no_identificados INTEGER NOT NULL DEFAULT 0,
      duplicados INTEGER NOT NULL DEFAULT 0,
      errores INTEGER NOT NULL DEFAULT 0,
      usuario_id UUID,
      usuario_nombre TEXT,
      fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT now(),
      fecha_fin TIMESTAMPTZ,
      estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','EN_CURSO','COMPLETADO','ERROR')),
      etapa TEXT,
      error_mensaje TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_proc_empresa_fecha ON orm_procesamientos (empresa_id, fecha_inicio DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_proc_pendientes ON orm_procesamientos (estado, fecha_inicio) WHERE estado IN ('PENDIENTE','EN_CURSO');`);

  // ── Cada página escaneada ─────────────────────────────────────────────────
  //
  // Una fila por PÁGINA, no por fichero subido: la regla del módulo es «una
  // página, una OR», así que un PDF de 25 páginas deja 25 documentos
  // independientes y el PDF de origen queda en `orm_procesamientos`.
  //
  // `or_id` y `bloc_id` son NULL mientras no se sepa de quién es la hoja: ése
  // es exactamente el estado NO_IDENTIFICADO que alimenta la bandeja.
  //
  // El hash es del CONTENIDO y no del nombre, porque el nombre de un escaneo
  // lo pone el escáner y «escan0001.pdf» se repite cada mañana.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orm_documentos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      or_id UUID REFERENCES orm_or(id) ON DELETE SET NULL,
      bloc_id UUID REFERENCES orm_blocs(id) ON DELETE SET NULL,
      procesamiento_id UUID REFERENCES orm_procesamientos(id) ON DELETE SET NULL,
      nombre_archivo TEXT NOT NULL,
      nombre_original TEXT NOT NULL,
      pagina_origen INTEGER,
      storage_key TEXT NOT NULL,
      tipo_archivo TEXT NOT NULL DEFAULT 'application/pdf',
      tamano_bytes INTEGER NOT NULL DEFAULT 0,
      hash_archivo TEXT NOT NULL,
      ocr_numero_detectado INTEGER,
      ocr_confianza INTEGER,
      ocr_metodo TEXT,
      ocr_texto TEXT,
      estado_procesamiento TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado_procesamiento IN ('PENDIENTE','ARCHIVADO','REVISION','NO_IDENTIFICADO','DUPLICADO','SUSTITUIDO','ERROR','ELIMINADO')),
      error_mensaje TEXT,
      sustituye_a UUID REFERENCES orm_documentos(id) ON DELETE SET NULL,
      usuario_carga UUID,
      usuario_carga_nombre TEXT,
      fecha_carga TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_doc_or ON orm_documentos (or_id) WHERE or_id IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_doc_estado ON orm_documentos (empresa_id, estado_procesamiento, fecha_carga DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_doc_hash ON orm_documentos (empresa_id, hash_archivo);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_doc_proc ON orm_documentos (procesamiento_id);`);

  // ── Custodia: quién se llevó el bloc y cuándo lo trajo ────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orm_entregas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      bloc_id UUID NOT NULL REFERENCES orm_blocs(id) ON DELETE CASCADE,
      responsable_id UUID,
      responsable_nombre TEXT,
      fecha_entrega DATE NOT NULL,
      fecha_devolucion DATE,
      observaciones TEXT,
      observaciones_devolucion TEXT,
      usuario_registro UUID,
      usuario_registro_nombre TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_entregas_bloc ON orm_entregas (bloc_id, fecha_entrega DESC);`);
  // Sólo puede haber UNA entrega viva por bloc: no se entrega dos veces el
  // mismo taco de papel sin que vuelva primero. Es un índice parcial porque
  // las devueltas sí pueden ser muchas.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orm_entregas_abierta
      ON orm_entregas (bloc_id) WHERE fecha_devolucion IS NULL;
  `);

  // ── Avisos ────────────────────────────────────────────────────────────────
  //
  // Un aviso por bloc y tipo mientras esté abierto: si cada recálculo creara
  // una fila, la pantalla de Avisos sería un historial de ruido en vez de una
  // lista de cosas que hacer. `canal` está preparado para WhatsApp/SMS/correo,
  // pero hoy sólo se escribe INTERNO: el encargo pide no estrenar
  // integraciones externas todavía.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orm_avisos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      bloc_id UUID REFERENCES orm_blocs(id) ON DELETE CASCADE,
      or_id UUID REFERENCES orm_or(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('BLOC_INCOMPLETO','DOCUMENTO_PENDIENTE','OR_DUPLICADA')),
      mensaje TEXT NOT NULL,
      responsable_id UUID,
      responsable_nombre TEXT,
      canal TEXT NOT NULL DEFAULT 'INTERNO'
        CHECK (canal IN ('INTERNO','EMAIL','WHATSAPP','SMS','PUSH')),
      estado TEXT NOT NULL DEFAULT 'ABIERTO' CHECK (estado IN ('ABIERTO','NOTIFICADO','RESUELTO')),
      fecha_creacion TIMESTAMPTZ NOT NULL DEFAULT now(),
      fecha_notificacion TIMESTAMPTZ,
      fecha_resolucion TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_avisos_estado ON orm_avisos (empresa_id, estado, fecha_creacion DESC);`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orm_avisos_vivo
      ON orm_avisos (bloc_id, tipo) WHERE estado <> 'RESUELTO' AND bloc_id IS NOT NULL;
  `);

  // ── El diario del módulo ──────────────────────────────────────────────────
  //
  // Aparte de `app_auditoria`, que es de toda la aplicación: aquí se guarda lo
  // que hay que poder enseñar EN la ficha del bloc sin cruzar tablas de otro
  // módulo. Inmutable por trigger, como `rcp_eventos`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orm_eventos (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      empresa_id UUID NOT NULL,
      bloc_id UUID,
      or_id UUID,
      documento_id UUID,
      accion TEXT NOT NULL,
      detalle JSONB,
      usuario_id UUID,
      usuario_nombre TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_eventos_bloc ON orm_eventos (bloc_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_orm_eventos_empresa ON orm_eventos (empresa_id, created_at DESC);`);

  await pool.query(`
    CREATE OR REPLACE FUNCTION orm_eventos_solo_insertar() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'orm_eventos es inmutable: no se puede % una fila del histórico', TG_OP;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS orm_eventos_inmutable_trg ON orm_eventos;
    CREATE TRIGGER orm_eventos_inmutable_trg
      BEFORE UPDATE OR DELETE ON orm_eventos
      FOR EACH ROW EXECUTE FUNCTION orm_eventos_solo_insertar();
  `);

  // ── Configuración por empresa ─────────────────────────────────────────────
  //
  // Clave/valor, como `rcp_config` y `thf_config`. Sólo guarda lo que alguien
  // ha cambiado; los valores por defecto viven en `config.ts`. Aquí están la
  // zona de OCR y los umbrales de confianza, que el encargo pide poder mover
  // sin desplegar.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orm_config (
      empresa_id UUID NOT NULL,
      clave TEXT NOT NULL,
      valor TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (empresa_id, clave)
    );
  `);

  await registrarModuloOrManuales();
}

/**
 * Da de alta `or-manuales` en los CHECK de licencias y accesos, reconstruyendo
 * la lista con la UNIÓN de lo que ya haya guardado y lo que este módulo
 * necesita. Misma forma que `registrarModuloRecepciones`, y se hace también
 * aquí porque `server/db.ts` y `server/central/schema.ts` reescriben ese CHECK
 * en cada arranque: el último que corre gana, y los tres tienen que llevar la
 * misma lista.
 */
async function registrarModuloOrManuales(): Promise<void> {
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
                                'therefore','recepciones','or-manuales']) AS m
            UNION SELECT modulo FROM ${tabla}
          ) t;
          EXECUTE 'ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${restriccion}';
          EXECUTE format('ALTER TABLE ${tabla} ADD CONSTRAINT ${restriccion} CHECK (modulo IN (%s))', v_lista);
        END
        $migracion$;
      `
      )
      .catch((e) => console.warn(`OR Manuales: no se ha podido registrar el módulo en ${tabla}:`, e?.message ?? e));
  }
}
