/**
 * Esquema del módulo Therefore.
 *
 * DDL idempotente que se ejecuta al arrancar, como `initDb()`, `initCash()` y
 * `initTacografos()`. El equivalente para pegar en el SQL Editor de Supabase
 * está en `supabase/migrations/therefore_fase1.sql`.
 *
 * ── Qué hay aquí y qué no (fase 1) ──────────────────────────────────────────
 *
 * Las cinco tablas que sostienen la cola de trabajo: expedientes, actuaciones,
 * el histórico, el contador de numeración y la configuración. Las de correo
 * (notificaciones, adjuntos, decisiones) llegan con la ingesta, y las del
 * análisis de albaranes (documentos, líneas, descuentos, validaciones) con el
 * parser de documentos. Se crean cuando haya código que las use: una tabla
 * vacía que nadie escribe es una promesa sin cumplir en medio del esquema.
 *
 * Por eso `thf_eventos` tiene columnas `notificacion_id` y
 * `albaran_analizado_id` **sin clave ajena**: el histórico va a apuntar a esas
 * filas en cuanto existan, y una clave ajena a una tabla que aún no está
 * impediría arrancar.
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
}
