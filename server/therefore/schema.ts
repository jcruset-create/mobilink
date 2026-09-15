/**
 * Esquema del módulo Therefore.
 *
 * DDL idempotente que se ejecuta al arrancar, como `initDb()`, `initCash()` y
 * `initTacografos()`. El equivalente para pegar en el SQL Editor de Supabase
 * está en `supabase/migrations/therefore_fase1.sql`.
 *
 * ── Qué hay aquí y qué no ───────────────────────────────────────────────────
 *
 * Trece tablas. Las cinco de la cola de trabajo (expedientes, actuaciones,
 * histórico, contador de numeración y configuración), las tres de la ingesta
 * de correo (notificaciones, adjuntos, decisiones) y las cinco del análisis de
 * documentos (documentos, albaranes analizados, líneas, descuentos de línea y
 * validaciones).
 *
 * El criterio es que cada tabla entra con el código que la usa: una tabla
 * vacía que nadie escribe es una promesa sin cumplir en medio del esquema, y
 * además nadie sabe si su DDL es correcto hasta que algo la usa de verdad.
 *
 * `thf_eventos` sigue sin clave ajena hacia `notificacion_id` ni hacia
 * `albaran_analizado_id`, y es a propósito: ponérsela obligaría a que las
 * tablas se creasen en un orden concreto, y el histórico tiene que poder
 * escribirse pase lo que pase.
 *
 * ── empresa_id sin clave ajena ──────────────────────────────────────────────
 *
 * Igual que en Mobilink Cash y por el mismo motivo: las pruebas de integración
 * levantan una base desechable donde sólo corre este `init`, sin la fundación
 * SaaS (`app_empresas`). Con la clave ajena incondicional, arrancar contra esa
 * base fallaría. Las claves ajenas hacia `app_*` viven en la migración de
 * Supabase, que se aplica sobre la base real.
 *
 * ── Fechas en TIMESTAMPTZ ───────────────────────────────────────────────────
 *
 * Y no en BIGINT de milisegundos como Tacógrafos o Cash. Es deliberado: aquí se
 * hace aritmética de fechas EN SQL —antigüedad del expediente, ventana de
 * expedientes candidatos al deduplicar, cierre por inactividad— y con epoch en
 * milisegundos cada una de esas consultas sería una conversión escrita a mano.
 * `app_auditoria`, que también la escribe el servidor, ya va en TIMESTAMPTZ.
 */

import pool from "../db.ts";

export async function initTherefore(): Promise<void> {
  // ── Expedientes ───────────────────────────────────────────────────────────
  //
  // La unidad de trabajo. NO es el correo: un mismo problema genera correos
  // durante días y todos caen en el mismo expediente.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_expedientes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,

      -- Numeración propia (INC-000452). Es lo que la gente cita por teléfono;
      -- el UUID sigue siendo la clave. Por empresa, desde thf_contadores.
      numero TEXT NOT NULL,

      /*
       * La sociedad del ERP a la que se refiere el correo («007»), que NO es el
       * tenant. empresa_id es quién usa Mobilink; empresa_codigo es de qué
       * empresa habla Therefore. Confundirlos haría que una instalación con dos
       * sociedades no pudiera distinguir sus incidencias.
       */
      empresa_codigo TEXT NOT NULL DEFAULT '',
      empresa_nombre TEXT NOT NULL DEFAULT '',

      tipo TEXT NOT NULL
        CHECK (tipo IN ('INCIDENCIA_ALBARAN','APROBACION_FACTURA','OTRO')),
      estado TEXT NOT NULL DEFAULT 'NUEVO'
        CHECK (estado IN ('NUEVO','PENDIENTE','EN_PROCESO','BLOQUEADO','RESUELTO','CERRADO')),

      /*
       * Prioridad y estado son ejes distintos, y las reclamaciones un tercero.
       * Un expediente puede estar PENDIENTE, con tres reclamaciones y prioridad
       * CRÍTICA: las tres cosas a la vez. Por eso «RECLAMADO» no es un estado.
       */
      prioridad TEXT NOT NULL DEFAULT 'NORMAL'
        CHECK (prioridad IN ('BAJA','NORMAL','ALTA','CRITICA')),
      prioridad_score INTEGER NOT NULL DEFAULT 0,
      -- Fijada por una persona. Si está, gana; el score se sigue calculando.
      prioridad_manual TEXT
        CHECK (prioridad_manual IS NULL OR prioridad_manual IN ('BAJA','NORMAL','ALTA','CRITICA')),

      -- Hay algo que una persona tiene que mirar (parser dudoso, validación en
      -- revisión, decisión pendiente). Se guarda en vez de deducirse en cada
      -- consulta porque la bandeja filtra por ello.
      requiere_revision BOOLEAN NOT NULL DEFAULT false,

      proveedor_codigo TEXT,
      proveedor_nombre TEXT,
      cuenta_contable TEXT,
      factura_numero TEXT,
      factura_fecha DATE,

      /*
       * En céntimos y CON SIGNO. Un abono de 45,63 € es -4563, y conservar el
       * signo es parte del encargo: un abono grabado como cargo es un asiento
       * del revés. Entero, además, para no arrastrar los errores de coma
       * flotante en una cifra contable (mismo criterio que Mobilink Cash).
       */
      importe_centimos BIGINT,
      moneda TEXT NOT NULL DEFAULT 'EUR',
      caso_referencia TEXT,

      /*
       * La antigüedad se cuenta desde la PRIMERA notificación, no desde que se
       * creó la fila: un expediente importado del histórico lleva abierto desde
       * que Therefore lo pidió por primera vez.
       */
      fecha_primera_notificacion TIMESTAMPTZ NOT NULL DEFAULT now(),
      fecha_ultima_notificacion TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Cero al crearlo a mano: todavía no hay ningún correo detrás.
      numero_notificaciones INTEGER NOT NULL DEFAULT 0,
      numero_reclamaciones INTEGER NOT NULL DEFAULT 0,

      urgente BOOLEAN NOT NULL DEFAULT false,
      tarea_vencida BOOLEAN NOT NULL DEFAULT false,

      asignado_usuario_id UUID,
      fecha_inicio_gestion TIMESTAMPTZ,
      fecha_resolucion TIMESTAMPTZ,
      resuelto_por_usuario_id UUID,
      fecha_cierre TIMESTAMPTZ,

      observaciones TEXT NOT NULL DEFAULT '',

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by UUID,

      UNIQUE (empresa_id, numero)
    );
  `);

  await pool.query(`
    -- Las dos claves con las que se busca un expediente al deduplicar.
    CREATE INDEX IF NOT EXISTS thf_exp_empresa_factura_idx
      ON thf_expedientes(empresa_id, empresa_codigo, factura_numero);
    CREATE INDEX IF NOT EXISTS thf_exp_proveedor_factura_idx
      ON thf_expedientes(empresa_id, proveedor_codigo, factura_numero);
    -- El orden de la bandeja.
    CREATE INDEX IF NOT EXISTS thf_exp_estado_prioridad_idx
      ON thf_expedientes(empresa_id, estado, prioridad);
    CREATE INDEX IF NOT EXISTS thf_exp_ultima_notif_idx
      ON thf_expedientes(empresa_id, fecha_ultima_notificacion DESC);
    -- Las pestañas «Revisar» y «Mis expedientes», que son las que se miran.
    CREATE INDEX IF NOT EXISTS thf_exp_revision_idx
      ON thf_expedientes(empresa_id) WHERE requiere_revision;
    CREATE INDEX IF NOT EXISTS thf_exp_asignado_idx
      ON thf_expedientes(empresa_id, asignado_usuario_id)
      WHERE asignado_usuario_id IS NOT NULL;
  `);

  // ── Actuaciones ───────────────────────────────────────────────────────────
  //
  // Lo que hay que hacer, una fila por cosa. Un mismo correo pide grabar dos
  // albaranes y modificar un tercero: son tres actuaciones de un expediente, y
  // cada una se resuelve por su cuenta.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_actuaciones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      expediente_id UUID NOT NULL REFERENCES thf_expedientes(id) ON DELETE CASCADE,

      tipo_accion TEXT NOT NULL
        CHECK (tipo_accion IN ('GRABAR','MODIFICAR','REVISAR','GESTIONAR','ANULAR','APROBAR','OTRO')),

      -- Tal y como lo escribió quien mandó el correo («0501234»).
      albaran_solicitado TEXT,
      -- El núcleo, que es con lo que se cruza (ver domain/albaran.ts).
      albaran_normalizado TEXT,

      /*
       * Lo que DICE EL CORREO. Si el documento dice otra cosa se registra la
       * discrepancia, pero esta columna no se toca: son dos fuentes y las dos
       * tienen que poder verse.
       */
      importe_centimos BIGINT,

      /*
       * Lo que venía junto al albarán y no se sabe qué significa: «T2».
       * Se conserva tal cual y no se interpreta. Inventarle un significado es
       * peor que no tenerlo, porque nadie revisa lo que parece entendido.
       */
      indicador_adicional TEXT,

      estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','EN_PROCESO','BLOQUEADA','RESUELTA','DESCARTADA')),
      -- Una actuación no obligatoria no impide dar por resuelto el expediente.
      obligatoria BOOLEAN NOT NULL DEFAULT true,

      resultado TEXT,
      -- Número de albarán o de asiento que quedó en el ERP.
      erp_referencia TEXT,
      erp_estado JSONB,
      erp_consultado_at TIMESTAMPTZ,

      confianza NUMERIC(3,2) NOT NULL DEFAULT 1.00,
      -- El correo que la introdujo. Sin clave ajena: la tabla llega después.
      origen_notificacion_id UUID,

      iniciada_por_usuario_id UUID,
      iniciada_at TIMESTAMPTZ,
      resuelta_por_usuario_id UUID,
      resuelta_at TIMESTAMPTZ,

      observaciones TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  /*
   * El matiz de la instrucción, cuando el correo lo trae.
   *
   * `MODIFICAR` y `MODIFICAR FECHA` son la misma acción normalizada, pero quien
   * lo grabe en el ERP necesita saber que lo que hay que cambiar es la fecha.
   * Lo mismo con «Costes (modificar)». Guardar sólo el verbo es quedarse con la
   * mitad de la frase.
   *
   * Va con ALTER y no dentro del CREATE de arriba porque la tabla ya existe en
   * producción desde la fase 1: un `CREATE TABLE IF NOT EXISTS` con la columna
   * añadida no haría nada sobre una tabla que ya está.
   */
  await pool.query(`
    ALTER TABLE thf_actuaciones ADD COLUMN IF NOT EXISTS accion_texto TEXT;
  `);

  /*
   * El orden en que se pidieron.
   *
   * Hace falta porque `created_at` NO sirve para ordenarlas: su valor por
   * defecto es `now()`, que en PostgreSQL es la hora de inicio de la
   * TRANSACCIÓN, así que las cuatro actuaciones de un mismo correo nacen con el
   * mismo instante al milisegundo. El desempate caía entonces en el UUID, que
   * es aleatorio, y un correo que pide «graba éste y cambia la fecha de estos
   * tres» salía barajado en pantalla.
   *
   * Un contador es exacto y no depende del reloj. Al añadirlo, PostgreSQL
   * rellena las filas que ya había en su orden físico, que para lo que existe
   * hoy es el de creación.
   */
  await pool.query(`
    ALTER TABLE thf_actuaciones ADD COLUMN IF NOT EXISTS orden BIGSERIAL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS thf_act_expediente_idx
      ON thf_actuaciones(expediente_id);
    CREATE INDEX IF NOT EXISTS thf_act_albaran_idx
      ON thf_actuaciones(empresa_id, albaran_normalizado)
      WHERE albaran_normalizado IS NOT NULL;
  `);

  /*
   * El índice que impide duplicar una actuación.
   *
   * Es la garantía de que una reclamación que repite «grabar 123, 456» sobre un
   * expediente que ya las tiene no cree dos actuaciones más. Tiene que ser un
   * índice y no una comprobación previa: dos correos procesados a la vez
   * pasarían los dos por un «¿ya existe?».
   *
   * Deja fuera las DESCARTADAS a propósito: una actuación que un cambio de
   * instrucción dejó sin efecto no bloquea que se vuelva a pedir lo mismo.
   */
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS thf_act_unica_idx
      ON thf_actuaciones(expediente_id, tipo_accion, albaran_normalizado)
      WHERE albaran_normalizado IS NOT NULL AND estado <> 'DESCARTADA';
  `);

  // ── Histórico ─────────────────────────────────────────────────────────────
  //
  // Inmutable, y la inmutabilidad la impone la BASE, no el servidor: aquí se
  // conecta con `pg` y un solo usuario, así que la RLS no pinta nada y un
  // UPDATE sería perfectamente posible. Mismo par de disparadores que
  // `assistance_events`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_eventos (
      id BIGSERIAL PRIMARY KEY,
      empresa_id UUID NOT NULL,

      -- Todas opcionales salvo la empresa: hay eventos de expediente, de
      -- actuación y (más adelante) de un correo que todavía no tiene expediente.
      expediente_id UUID,
      notificacion_id UUID,
      actuacion_id UUID,
      albaran_analizado_id UUID,

      tipo TEXT NOT NULL,
      actor_tipo TEXT NOT NULL DEFAULT 'sistema'
        CHECK (actor_tipo IN ('sistema','usuario')),
      usuario_id UUID,
      usuario_nombre TEXT,

      datos_anteriores JSONB,
      datos_nuevos JSONB,
      -- Una frase para la timeline. Se escribe al anotar, no al leer: quien
      -- mira el histórico dentro de un año no tiene por qué saber interpretar
      -- un JSON de diferencias.
      descripcion TEXT NOT NULL DEFAULT '',

      occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      huella TEXT
    );

    CREATE INDEX IF NOT EXISTS thf_ev_expediente_idx
      ON thf_eventos(expediente_id, occurred_at);
    CREATE INDEX IF NOT EXISTS thf_ev_empresa_idx
      ON thf_eventos(empresa_id, occurred_at DESC);
  `);

  // La huella se calcula en la base y no en Node, como en `app_auditoria`: así
  // vale para cualquier código que escriba aquí mañana sin que tenga que
  // acordarse de nada.
  await pool.query(`
    CREATE OR REPLACE FUNCTION thf_eventos_huella() RETURNS TRIGGER AS $$
    BEGIN
      NEW.huella := encode(sha256(convert_to(
        NEW.empresa_id::text                        || '|' ||
        COALESCE(NEW.expediente_id::text,'')        || '|' ||
        COALESCE(NEW.actuacion_id::text,'')         || '|' ||
        NEW.tipo                                    || '|' ||
        NEW.actor_tipo                              || '|' ||
        COALESCE(NEW.usuario_id::text,'')           || '|' ||
        NEW.occurred_at::text                       || '|' ||
        COALESCE(NEW.datos_anteriores::text,'')     || '|' ||
        COALESCE(NEW.datos_nuevos::text,''),
        'UTF8')), 'hex');
      RETURN NEW;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS thf_eventos_huella_trg ON thf_eventos;
    CREATE TRIGGER thf_eventos_huella_trg
      BEFORE INSERT ON thf_eventos
      FOR EACH ROW EXECUTE FUNCTION thf_eventos_huella();
  `);

  /*
   * El candado. El mensaje dice QUÉ hacer en vez de sólo negarse: quien se topa
   * con esto casi siempre quería corregir algo, y lo que corrige un evento
   * equivocado es otro evento.
   */
  await pool.query(`
    CREATE OR REPLACE FUNCTION thf_eventos_solo_insertar() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION
        'thf_eventos es inmutable: no se puede % un evento. Una correccion se registra como un evento nuevo.',
        TG_OP;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS thf_eventos_inmutable_trg ON thf_eventos;
    CREATE TRIGGER thf_eventos_inmutable_trg
      BEFORE UPDATE OR DELETE ON thf_eventos
      FOR EACH ROW EXECUTE FUNCTION thf_eventos_solo_insertar();
  `);

  // ── Numeración ────────────────────────────────────────────────────────────
  //
  // Una serie por empresa y tipo (INC, APR, EXP). El `UPDATE ... RETURNING` de
  // `siguienteNumero` es atómico, así que dos expedientes creados a la vez no
  // pueden coger el mismo número; y si aun así lo cogieran, el UNIQUE de
  // (empresa_id, numero) lo rechazaría.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_contadores (
      empresa_id UUID NOT NULL,
      serie TEXT NOT NULL,
      last_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (empresa_id, serie)
    );
  `);

  // ── Configuración ─────────────────────────────────────────────────────────
  //
  // Clave/valor POR EMPRESA, como `cash_settings`. Por empresa y no global
  // (`workshop_config`) porque los pesos de la prioridad son una opinión de
  // cada instalación sobre qué corre más, y dos clientes no tienen por qué
  // opinar igual. Sólo guarda lo que alguien ha cambiado: los valores por
  // defecto viven en `config.ts`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_config (
      empresa_id UUID NOT NULL,
      clave TEXT NOT NULL,
      valor TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (empresa_id, clave)
    );
  `);

  /*
   * La misma normalización que `domain/dedupe.ts`, pero en SQL.
   *
   * Hace falta aquí porque la consulta de candidatos tiene que cruzar la
   * factura `0000555111` de un correo con la `555111` de un expediente, y
   * traerse a Node todos los expedientes de la ventana para compararlos sería
   * leer miles de filas para quedarse con dos.
   *
   * Que la regla esté escrita dos veces es un riesgo real —se cambia una y se
   * olvida la otra—, así que hay una prueba de integración que pasa la misma
   * lista de valores por las dos y exige el mismo resultado. Es la única forma
   * honesta de tener las dos: o coinciden, o la CI se pone roja.
   *
   * IMMUTABLE no es decorativo: sin eso no se puede indexar por ella.
   */
  await pool.query(`
    CREATE OR REPLACE FUNCTION thf_normalizar_id(v TEXT) RETURNS TEXT AS $$
      SELECT NULLIF(
        regexp_replace(
          regexp_replace(upper(COALESCE(v, '')), '[^A-Z0-9]', '', 'g'),
          '^0+', ''),
        '')
    $$ LANGUAGE sql IMMUTABLE;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS thf_exp_factura_norm_idx
      ON thf_expedientes(empresa_id, thf_normalizar_id(factura_numero));
  `);

  // ── Notificaciones ────────────────────────────────────────────────────────
  //
  // Un correo. NO es la unidad de trabajo: un expediente tiene muchos, y un
  // correo puede quedarse sin expediente mientras una persona decide a cuál va.
  // De ahí que `expediente_id` sea NULL-able y no al revés.
  //
  // El texto original NUNCA se borra ni se edita: es la única prueba de qué
  // pidió Therefore exactamente. Cuando el parser se equivoque —y se va a
  // equivocar— lo que se corrige es lo interpretado, y esta columna es contra
  // lo que se compara.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_notificaciones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      -- SET NULL y no CASCADE: si un expediente se borra, sus correos siguen
      -- siendo correos que llegaron. Borrarlos sería falsear el buzón.
      expediente_id UUID REFERENCES thf_expedientes(id) ON DELETE SET NULL,

      /*
       * El Message-ID del RFC, que es lo que existe en CUALQUIER buzón. El
       * encargo pedía que el único fuera el identificador de Gmail, pero eso
       * ataría el módulo a un proveedor concreto: aquí el buzón es cdmon. El de
       * Gmail se guarda aparte y con su propio índice único parcial, para
       * cuando el servidor sea Gmail y lo mande.
       */
      message_id TEXT NOT NULL,
      gmail_message_id TEXT,
      gmail_thread_id TEXT,
      in_reply_to TEXT,

      fecha_email TIMESTAMPTZ NOT NULL,
      remitente TEXT NOT NULL DEFAULT '',
      destinatario TEXT NOT NULL DEFAULT '',
      asunto TEXT NOT NULL DEFAULT '',

      texto_original TEXT NOT NULL,
      html_original TEXT,
      -- El .eml tal cual, cuando haya buzón y almacenamiento (fase 4).
      eml_storage_path TEXT,

      tipo_notificacion TEXT NOT NULL DEFAULT 'SOLICITUD'
        CHECK (tipo_notificacion IN
          ('SOLICITUD','RECORDATORIO','RECLAMACION','TAREA_VENCIDA','CAMBIO_INSTRUCCION','APROBACION','OTRO')),

      urgente_detectado BOOLEAN NOT NULL DEFAULT false,
      persona_solicitante TEXT,
      fecha_solicitud_texto TEXT,

      -- sha256 del texto normalizado. Cruza reenvíos que llegan con otro
      -- Message-ID pero el mismo cuerpo, que es lo que hace el reenvío manual.
      hash_contenido TEXT NOT NULL,

      -- Lo que entendió el parser, con sus confianzas: la EVIDENCIA. Lo que se
      -- mira cuando alguien pregunta por qué se creó esta actuación.
      parseado JSONB,

      estado_proceso TEXT NOT NULL DEFAULT 'PROCESADA'
        CHECK (estado_proceso IN ('PROCESADA','PENDIENTE_DECISION','ERROR_PARSER','IGNORADA')),
      error_proceso TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      /*
       * La idempotencia de la ingesta, y por eso es un UNIQUE de la base y no
       * un «¿ya existe?» antes de insertar: dos pasadas del buzón a la vez
       * pasarían las dos por la comprobación previa. El mismo correo dos veces
       * tiene que dar cero filas nuevas, no un duplicado ni un error.
       */
      UNIQUE (empresa_id, message_id)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS thf_notif_expediente_idx
      ON thf_notificaciones(expediente_id, fecha_email);
    CREATE INDEX IF NOT EXISTS thf_notif_hash_idx
      ON thf_notificaciones(empresa_id, hash_contenido);
    CREATE INDEX IF NOT EXISTS thf_notif_hilo_idx
      ON thf_notificaciones(empresa_id, gmail_thread_id)
      WHERE gmail_thread_id IS NOT NULL;
    -- Lo que hay que atender: las que NO están procesadas. Parcial porque las
    -- procesadas son el 99 % y no se buscan nunca por este campo.
    CREATE INDEX IF NOT EXISTS thf_notif_pendientes_idx
      ON thf_notificaciones(empresa_id, estado_proceso)
      WHERE estado_proceso <> 'PROCESADA';
    CREATE UNIQUE INDEX IF NOT EXISTS thf_notif_gmail_idx
      ON thf_notificaciones(empresa_id, gmail_message_id)
      WHERE gmail_message_id IS NOT NULL;
  `);

  // ── Adjuntos ──────────────────────────────────────────────────────────────
  //
  // Los ficheros del correo. En esta fase se registran su nombre, su tipo y su
  // HASH; el contenido se guarda cuando haya almacenamiento (fase 3). El hash
  // ya sirve para algo desde hoy: es una de las señales del deduplicador —el
  // mismo PDF adjunto en dos correos es el mismo asunto— y es lo que evitará
  // volver a analizar un documento ya analizado.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_adjuntos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      notificacion_id UUID NOT NULL REFERENCES thf_notificaciones(id) ON DELETE CASCADE,
      expediente_id UUID REFERENCES thf_expedientes(id) ON DELETE SET NULL,

      nombre_archivo TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      tamano_bytes INTEGER,

      tipo_documento TEXT NOT NULL DEFAULT 'OTRO'
        CHECK (tipo_documento IN ('PDF_FACTURA','PDF_ABONO','XML_FACTURA','OTRO')),

      hash_archivo TEXT NOT NULL,
      -- <empresa>/<hash[0:2]>/<hash>.<ext>. NULL mientras no haya dónde
      -- guardarlo: el mismo fichero se guardará UNA vez aunque llegue diez.
      storage_path TEXT,

      paginas INTEGER,
      tiene_texto BOOLEAN,
      parsed BOOLEAN NOT NULL DEFAULT false,
      parse_error TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- El mismo fichero en el mismo correo es el mismo adjunto.
      UNIQUE (notificacion_id, hash_archivo)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS thf_adj_hash_idx ON thf_adjuntos(empresa_id, hash_archivo);
    CREATE INDEX IF NOT EXISTS thf_adj_expediente_idx ON thf_adjuntos(expediente_id);
  `);

  // ── Decisiones ────────────────────────────────────────────────────────────
  //
  // Lo que el sistema NO decide por su cuenta.
  //
  // Es la tabla que sostiene la regla de todo el módulo: cuando no se sabe, se
  // pregunta. Un motor que siempre elige acierta el 95 % y el 5 % restante
  // aparece en contabilidad semanas después, cuando ya nadie recuerda de qué
  // correo salió. Aquí el correo se queda esperando, con sus candidatos y la
  // puntuación de cada uno, hasta que una persona diga.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_decisiones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,

      tipo TEXT NOT NULL
        CHECK (tipo IN
          ('POSIBLE_DUPLICADO','CAMBIO_INSTRUCCION','RECLAMACION_SOBRE_RESUELTO','REQUIERE_REVISION','ERROR_PARSER')),

      notificacion_id UUID REFERENCES thf_notificaciones(id) ON DELETE CASCADE,
      -- El expediente al que afecta, cuando lo hay: un POSIBLE_DUPLICADO
      -- todavía no tiene, y un CAMBIO_INSTRUCCION sí.
      expediente_id UUID REFERENCES thf_expedientes(id) ON DELETE CASCADE,
      /*
       * La actuación concreta, para los CAMBIO_INSTRUCCION. Un mismo correo
       * puede cambiar la instrucción de tres albaranes, y son tres decisiones
       * distintas: aceptar una y mantener otra es una respuesta perfectamente
       * razonable. Sin esta columna serían una sola y habría que decidir las
       * tres a la vez.
       */
      actuacion_id UUID REFERENCES thf_actuaciones(id) ON DELETE CASCADE,

      -- [{id, numero, estado, score, motivos:[{clave,puntos,texto}]}]. Se
      -- guarda la puntuación TAL Y COMO se calculó, no una referencia: los
      -- pesos se pueden cambiar, y entonces la pantalla enseñaría una razón
      -- distinta de la que hubo. Lo que se decidió se decidió con estos números.
      candidatos JSONB NOT NULL DEFAULT '[]',
      detalle JSONB,

      estado TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','DECIDIDA')),
      decision TEXT,
      motivo TEXT,
      decidida_por_usuario_id UUID,
      decidida_por_nombre TEXT,
      decidida_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    -- La cola de revisión: lo único que se consulta a diario.
    CREATE INDEX IF NOT EXISTS thf_dec_pendientes_idx
      ON thf_decisiones(empresa_id, created_at DESC)
      WHERE estado = 'PENDIENTE';
    CREATE INDEX IF NOT EXISTS thf_dec_expediente_idx ON thf_decisiones(expediente_id);
    CREATE INDEX IF NOT EXISTS thf_dec_notificacion_idx ON thf_decisiones(notificacion_id);
  `);

  /*
   * Una decisión pendiente por correo, tipo y actuación, y no más.
   *
   * Sin esto, reprocesar un correo —algo que se hace a mano cuando el parser
   * falla— dejaría dos «posible duplicado» idénticos en la cola, y quien
   * resolviera el primero se encontraría el segundo sin saber si es otro caso.
   *
   * El COALESCE es necesario y no un adorno: en un índice único de PostgreSQL
   * dos NULL son distintos, así que sin él las decisiones sin actuación —que
   * son casi todas— no se deduplicarían entre sí.
   *
   * Deja fuera las DECIDIDAS: el histórico de lo que ya se decidió no estorba.
   */
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS thf_dec_unica_idx
      ON thf_decisiones(
        notificacion_id, tipo,
        COALESCE(actuacion_id, '00000000-0000-0000-0000-000000000000'::uuid))
      WHERE estado = 'PENDIENTE' AND notificacion_id IS NOT NULL;
  `);
  /* ══ Análisis de documentos (fase 3b) ═════════════════════════════════════
   *
   * Cinco tablas que cuelgan del expediente y de la actuación. La frontera
   * entre ellas responde a una pregunta: ¿esto es de la FACTURA o del
   * ALBARÁN? `thf_documentos` es la cabecera del fichero —una factura entera,
   * con su número y sus totales—; `thf_albaranes_analizados` es lo que se ha
   * sacado de UN albarán para UNA actuación. Una factura con cinco albaranes
   * da una fila de documento y cinco de análisis, y cada una puede estar en un
   * estado distinto, que es lo normal.
   */

  // ── El documento, una vez por fichero ─────────────────────────────────────
  //
  // El correo y el papel se comparan y NUNCA se sobrescribe el dato del
  // correo: si el número de factura no coincide, se guardan los dos y sale una
  // validación. El que manda lo decide una persona, no el parser.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_documentos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      expediente_id UUID NOT NULL REFERENCES thf_expedientes(id) ON DELETE CASCADE,
      adjunto_id UUID REFERENCES thf_adjuntos(id) ON DELETE SET NULL,

      hash_archivo TEXT NOT NULL,

      tipo_documento TEXT NOT NULL DEFAULT 'OTRO'
        CHECK (tipo_documento IN ('FACTURA','ABONO','ALBARAN','OTRO')),
      numero_documento TEXT,
      fecha_documento DATE,

      proveedor_nombre TEXT,
      proveedor_nif TEXT,
      cliente_nombre TEXT,
      cliente_nif TEXT,

      -- Céntimos CON SIGNO, como en todo el módulo: un abono es negativo.
      base_centimos BIGINT,
      iva_centimos BIGINT,
      total_centimos BIGINT,
      moneda TEXT NOT NULL DEFAULT 'EUR',

      -- [{numeroDocumento, normalizado, paginaInicio, paginaFin}]
      albaranes_detectados JSONB NOT NULL DEFAULT '[]',

      origen TEXT CHECK (origen IN ('XML','PDF_TEXTO','PDF_IA')),
      parser_usado TEXT,
      confianza JSONB NOT NULL DEFAULT '{}',
      metadata_json JSONB NOT NULL DEFAULT '{}',

      validacion TEXT NOT NULL DEFAULT 'SIN_COMPARAR'
        CHECK (validacion IN ('SIN_COMPARAR','VALIDADO','DISCREPANCIA')),
      discrepancias JSONB NOT NULL DEFAULT '[]',

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      -- El mismo fichero en el mismo expediente se analiza UNA vez.
      UNIQUE (expediente_id, hash_archivo)
    );
    CREATE INDEX IF NOT EXISTS thf_doc_expediente_idx ON thf_documentos(expediente_id);
    CREATE INDEX IF NOT EXISTS thf_doc_hash_idx ON thf_documentos(empresa_id, hash_archivo);
  `);

  /*
   * ── El albarán analizado, y la cola ──────────────────────────────────────
   *
   * `estado_proceso` ES la cola. No hay infraestructura nueva: es el patrón
   * del proyecto —la tabla como cola, `FOR UPDATE SKIP LOCKED` para repartir
   * entre instancias— y cuesta una columna en vez de un servicio.
   *
   * Una fila por INTENTO VIVO. Reanalizar no machaca: crea otra fila y deja la
   * anterior como histórico, porque la comparación «antes y después» de un
   * parser corregido es justo lo que hay que poder enseñar el día que alguien
   * pregunte por qué ahora sale otra cosa.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_albaranes_analizados (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      expediente_id UUID NOT NULL REFERENCES thf_expedientes(id) ON DELETE CASCADE,
      actuacion_id UUID NOT NULL REFERENCES thf_actuaciones(id) ON DELETE CASCADE,
      adjunto_id UUID REFERENCES thf_adjuntos(id) ON DELETE SET NULL,
      documento_id UUID REFERENCES thf_documentos(id) ON DELETE SET NULL,

      -- El que pedía la incidencia y el que trae el papel. Se guardan los dos:
      -- la diferencia entre ellos es la mitad de la información.
      numero_solicitado TEXT NOT NULL,
      numero_documento TEXT,
      numero_normalizado TEXT,

      confianza_match NUMERIC(3,2),
      resultado_match TEXT CHECK (resultado_match IN ('MATCH','UNCERTAIN','NO_MATCH')),

      fecha DATE,
      matricula TEXT,
      bastidor TEXT,
      observaciones TEXT,

      -- Copia del importe de la actuación EN EL MOMENTO del análisis: si luego
      -- llega una corrección, el análisis sigue explicando lo que comparó.
      importe_incidencia_centimos BIGINT,
      importe_lineas_centimos BIGINT,
      diferencia_centimos BIGINT,

      estado_analisis TEXT CHECK (estado_analisis IN ('OK','REVISAR','ERROR')),

      estado_proceso TEXT NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado_proceso IN ('PENDIENTE','PROCESANDO','COMPLETADO','ERROR')),
      intentos INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      procesando_desde TIMESTAMPTZ,

      pagina_inicio INTEGER,
      pagina_fin INTEGER,
      parser_usado TEXT,
      origen TEXT,

      metadata_json JSONB NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS thf_alb_actuacion_idx ON thf_albaranes_analizados(actuacion_id);
    CREATE INDEX IF NOT EXISTS thf_alb_expediente_idx ON thf_albaranes_analizados(expediente_id);
    -- La cola: sólo lo que queda por hacer, que es lo que se consulta cada 15 s.
    CREATE INDEX IF NOT EXISTS thf_alb_cola_idx
      ON thf_albaranes_analizados(empresa_id, created_at)
      WHERE estado_proceso IN ('PENDIENTE','PROCESANDO');
  `);

  // ── Las líneas ────────────────────────────────────────────────────────────
  //
  // `raw_text`, `pagina` y `bbox` no son metadatos de adorno: son lo que
  // permite enseñar de dónde salió cada celda. Sin ellos, «el precio es 77,50»
  // es una afirmación que nadie puede comprobar sin reabrir el PDF a mano.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_albaran_lineas (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      albaran_analizado_id UUID NOT NULL REFERENCES thf_albaranes_analizados(id) ON DELETE CASCADE,
      numero_linea INTEGER NOT NULL,

      referencia TEXT,
      descripcion TEXT,
      cantidad NUMERIC(12,3),
      precio_unitario_centimos BIGINT,
      importe_centimos BIGINT,

      confianza_referencia NUMERIC(3,2),
      confianza_descripcion NUMERIC(3,2),
      confianza_cantidad NUMERIC(3,2),
      confianza_precio NUMERIC(3,2),
      confianza_importe NUMERIC(3,2),
      confianza_descuentos NUMERIC(3,2),

      -- cantidad · precio · Π(1 − dᵢ) ≈ importe. NULL si faltan datos para
      -- comprobarlo, que no es lo mismo que fallar.
      cuadra_aritmetica BOOLEAN,

      raw_text TEXT NOT NULL,
      pagina INTEGER,
      bbox JSONB,
      metadata_json JSONB NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

      UNIQUE (albaran_analizado_id, numero_linea)
    );
    CREATE INDEX IF NOT EXISTS thf_alb_lin_albaran_idx ON thf_albaran_lineas(albaran_analizado_id);
  `);

  // ── Los descuentos de cada línea ──────────────────────────────────────────
  //
  // Una fila por descuento y en orden: `60% + 10%` son DOS, nunca uno del 64 %.
  // `raw_value` conserva lo impreso porque es lo que el ERP pide y lo que está
  // pactado con el proveedor; «64 %» no aparece en ningún papel.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_albaran_linea_descuentos (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      linea_id UUID NOT NULL REFERENCES thf_albaran_lineas(id) ON DELETE CASCADE,
      orden INTEGER NOT NULL,
      porcentaje NUMERIC(6,3),
      raw_value TEXT NOT NULL,
      UNIQUE (linea_id, orden)
    );
  `);

  // ── Las validaciones ──────────────────────────────────────────────────────
  //
  // Es lo que explica POR QUÉ algo está en revisión. Un estado sin motivo
  // obliga a quien lo recibe a repetir a mano el trabajo del parser.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS thf_validaciones (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      expediente_id UUID NOT NULL REFERENCES thf_expedientes(id) ON DELETE CASCADE,
      actuacion_id UUID REFERENCES thf_actuaciones(id) ON DELETE CASCADE,
      albaran_analizado_id UUID REFERENCES thf_albaranes_analizados(id) ON DELETE CASCADE,

      tipo TEXT NOT NULL CHECK (tipo IN (
        'ALBARAN_MATCH','IMPORTE','LINEAS','DESCUENTOS','CAMPOS_CRITICOS',
        'SEPARACION_ALBARANES','DOCUMENTO','CORREO_VS_DOCUMENTO')),
      estado TEXT NOT NULL CHECK (estado IN ('OK','REVISAR','ERROR')),

      -- Escrito para la pantalla, no para el log.
      mensaje TEXT NOT NULL,
      valor_esperado TEXT,
      valor_obtenido TEXT,
      metadata_json JSONB NOT NULL DEFAULT '{}',

      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS thf_val_albaran_idx ON thf_validaciones(albaran_analizado_id);
    -- Lo que no está OK es lo único que se busca por expediente.
    CREATE INDEX IF NOT EXISTS thf_val_pendientes_idx
      ON thf_validaciones(expediente_id, estado)
      WHERE estado <> 'OK';
  `);
}
