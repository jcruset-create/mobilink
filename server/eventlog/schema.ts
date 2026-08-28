/**
 * Diario de eventos de las asistencias: esquema e inmutabilidad.
 *
 * Una sola tabla para los dos sistemas. La asistencia de Assist y la de Central
 * son filas distintas en bases distintas conceptualmente, así que la clave no
 * puede ser un id: es la terna `(system, tenantId, assistanceId)`, más el
 * `correlationId` que ata las dos mitades cuando una se subcontrata a la otra.
 *
 * ── Inmutable de verdad ─────────────────────────────────────────────────────
 *
 * Se reutiliza el mismo mecanismo que `app_auditoria`, y por el mismo motivo:
 * las políticas RLS no alcanzan al servidor, que se conecta con `pg` y las
 * salta. Un disparador sí alcanza a todo el mundo. Y cada fila lleva su huella,
 * para poder demostrar que no la han cambiado por fuera.
 *
 * Corregir un evento equivocado se hace anotando otro, nunca con un UPDATE. Es
 * lo que hace que la timeline se pueda reconstruir años después.
 */

import db from "../db.ts";

export async function initEventLog(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS assistance_events (
      id BIGSERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,

      -- De quién es el evento. Los tres juntos identifican la asistencia:
      -- el id local no basta porque Assist y Central numeran por su cuenta.
      "sourceSystem" TEXT NOT NULL,          -- assist | central
      "tenantId" TEXT,
      "assistanceId" TEXT NOT NULL,

      -- El hilo de la cadena completa, aunque pase por tres plataformas.
      "correlationId" TEXT,

      "eventType" TEXT NOT NULL,
      -- Quién lo originó, que puede no ser el sistema que lo anota: un
      -- PROVIDER_ASSIGNED anotado por Assist lo originó Central.
      "originSystem" TEXT,
      "originTenantId" TEXT,

      "actorType" TEXT NOT NULL DEFAULT 'system',   -- user | system | api | partner | provider
      "actorId" TEXT,
      "actorName" TEXT,

      -- Cuándo OCURRIÓ, que no es cuándo se anotó. Un aviso que llega con diez
      -- minutos de retraso tiene que salir en la timeline en su sitio.
      "occurredAtMs" BIGINT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',

      /*
       * Deduplicación. Un webhook se entrega AL MENOS una vez, así que el
       * mismo hecho puede llegar dos o tres veces; sin esto, la timeline
       * enseñaría «En camino» tres veces seguidas.
       *
       * Es NULL para los eventos propios, que no se repiten, y así no obliga a
       * inventar una clave para cada anotación interna.
       */
      "dedupeKey" TEXT,

      "createdAtMs" BIGINT NOT NULL,
      huella TEXT
    );

    -- La consulta de la timeline: todos los eventos de una asistencia, en orden.
    CREATE INDEX IF NOT EXISTS idx_assistance_events_asistencia
      ON assistance_events ("sourceSystem", "assistanceId", "occurredAtMs");
    -- La cadena completa entre plataformas.
    CREATE INDEX IF NOT EXISTS idx_assistance_events_correlacion
      ON assistance_events ("correlationId", "occurredAtMs");
    CREATE INDEX IF NOT EXISTS idx_assistance_events_tenant
      ON assistance_events ("tenantId", "occurredAtMs" DESC);
    -- La deduplicación tiene que ser una garantía de la base, no una consulta
    -- previa: dos webhooks a la vez pasarían los dos por un "¿ya existe?".
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assistance_events_dedupe
      ON assistance_events ("dedupeKey") WHERE "dedupeKey" IS NOT NULL;
  `);

  /*
   * La huella se calcula en la base y no en Node, igual que en `app_auditoria`:
   * así vale para cualquier módulo que escriba aquí mañana sin que tenga que
   * acordarse de nada.
   */
  await db.query(`
    CREATE OR REPLACE FUNCTION assistance_events_huella() RETURNS TRIGGER AS $$
    BEGIN
      NEW.huella := encode(sha256(convert_to(
        NEW."sourceSystem"                     || '|' ||
        COALESCE(NEW."tenantId",'')            || '|' ||
        NEW."assistanceId"                     || '|' ||
        COALESCE(NEW."correlationId",'')       || '|' ||
        NEW."eventType"                        || '|' ||
        NEW."actorType"                        || '|' ||
        COALESCE(NEW."actorId",'')             || '|' ||
        NEW."occurredAtMs"::text               || '|' ||
        NEW.payload,
        'UTF8')), 'hex');
      RETURN NEW;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS assistance_events_huella_trg ON assistance_events;
    CREATE TRIGGER assistance_events_huella_trg
      BEFORE INSERT ON assistance_events
      FOR EACH ROW EXECUTE FUNCTION assistance_events_huella();
  `);

  /*
   * El candado. El mensaje explica QUÉ hacer en lugar de solo negarse: quien
   * se topa con esto casi siempre quería corregir algo, y lo que corrige un
   * evento equivocado es otro evento.
   */
  await db.query(`
    CREATE OR REPLACE FUNCTION assistance_events_solo_insertar() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION
        'assistance_events es inmutable: no se puede % un evento. Una correccion se registra como un evento nuevo.',
        TG_OP;
    END $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS assistance_events_inmutable_trg ON assistance_events;
    CREATE TRIGGER assistance_events_inmutable_trg
      BEFORE UPDATE OR DELETE ON assistance_events
      FOR EACH ROW EXECUTE FUNCTION assistance_events_solo_insertar();
  `);

  await migrarHistoricos();
}

/**
 * Trae al diario lo que ya estaba anotado en otro sitio.
 *
 * Dos orígenes, los dos de tablas que ya existían:
 *
 *   · `external_dispatch_events` — el historial del envío, que hasta ahora era
 *     el único sitio donde constaba que Central aceptó algo.
 *   · `connect_status_history`  — los cambios de estado de Central.
 *
 * Ninguna de las dos se toca ni se borra: siguen ahí con sus filas. Lo que
 * cambia es que a partir de ahora la timeline se construye desde el diario, y
 * sin este traspaso las asistencias de ayer aparecerían vacías.
 *
 * Es idempotente por el índice de deduplicación: al segundo arranque no repite.
 */
async function migrarHistoricos(): Promise<void> {
  const now = Date.now();

  /*
   * Las dos tablas de origen son de OTROS módulos, y este esquema puede
   * inicializarse antes que ellos (lo llama `initConnect`, que corre antes que
   * los envíos). Si aún no existen no hay nada que migrar: se vuelve a intentar
   * en el siguiente arranque, cuando ya estén.
   */
  const hay = await db.query(
    `SELECT to_regclass('public.external_dispatch_events') AS envios,
            to_regclass('public.connect_status_history')   AS estados`,
  );
  const hayEnvios = hay.rows[0]?.envios != null;
  const hayEstados = hay.rows[0]?.estados != null;
  if (!hayEnvios && !hayEstados) return;

  // Envíos: el evento del cable se traduce al vocabulario del diario.
  const envios = !hayEnvios ? { rowCount: 0 } : await db.query(
    `INSERT INTO assistance_events
       (uuid, "sourceSystem", "tenantId", "assistanceId", "correlationId", "eventType",
        "originSystem", "actorType", "occurredAtMs", payload, "dedupeKey", "createdAtMs")
     SELECT gen_random_uuid()::text,
            d."sourceSystem", d."sourceTenantId", d."sourceAssistanceId", d."correlationId",
            CASE e.event
              WHEN 'RECEIVED'       THEN 'EXTERNAL_ASSISTANCE_RECEIVED'
              WHEN 'ACCEPTED'       THEN 'ASSISTANCE_ACCEPTED'
              WHEN 'REJECTED'       THEN 'ASSISTANCE_REJECTED'
              WHEN 'INFO_REQUESTED' THEN 'INFORMATION_REQUESTED'
              WHEN 'ASSIGNED'       THEN 'PROVIDER_ASSIGNED'
              WHEN 'EN_ROUTE'       THEN 'EN_ROUTE'
              WHEN 'ON_SITE'        THEN 'ON_SITE'
              WHEN 'IN_PROGRESS'    THEN 'SERVICE_STARTED'
              WHEN 'COMPLETED'      THEN 'SERVICE_COMPLETED'
              WHEN 'CANCELLED'      THEN 'SERVICE_CANCELLED'
              WHEN 'DOCUMENTED'     THEN 'DOCUMENT_UPLOADED'
              WHEN 'BILLABLE'       THEN 'READY_TO_BILL'
              WHEN 'REQUESTED'      THEN 'EXTERNAL_DISPATCH_CREATED'
            END,
            CASE WHEN e.direction = 'in' THEN d."destinationSystem" ELSE d."sourceSystem" END,
            'system', e."occurredAtMs",
            json_build_object('migrado', true, 'remoteStatus', e."remoteStatus")::text,
            'migr-envio-' || e.id::text,
            $1
       FROM external_dispatch_events e
       JOIN external_dispatches d ON d.id = e."dispatchId"
      WHERE e.event IN ('RECEIVED','ACCEPTED','REJECTED','INFO_REQUESTED','ASSIGNED',
                        'EN_ROUTE','ON_SITE','IN_PROGRESS','COMPLETED','CANCELLED',
                        'DOCUMENTED','BILLABLE','REQUESTED')
     ON CONFLICT DO NOTHING`,
    [now],
  );

  // Estados de Central. Solo los que tienen equivalente: 'pending' y
  // 'searching' son trámite interno y no son noticia para nadie.
  const estados = !hayEstados ? { rowCount: 0 } : await db.query(
    `INSERT INTO assistance_events
       (uuid, "sourceSystem", "tenantId", "assistanceId", "correlationId", "eventType",
        "originSystem", "actorType", "occurredAtMs", payload, "dedupeKey", "createdAtMs")
     SELECT gen_random_uuid()::text,
            'central', a."controlCenterId"::text, a.id::text, a."correlationId",
            CASE h."toStatus"
              WHEN 'assigned'            THEN 'PROVIDER_ASSIGNED'
              WHEN 'technician_assigned' THEN 'PROVIDER_ASSIGNED'
              WHEN 'en_route'            THEN 'EN_ROUTE'
              WHEN 'arrived'             THEN 'ON_SITE'
              WHEN 'in_progress'         THEN 'SERVICE_STARTED'
              WHEN 'finished'            THEN 'SERVICE_COMPLETED'
              WHEN 'cancelled'           THEN 'SERVICE_CANCELLED'
              WHEN 'no_coverage'         THEN 'ASSISTANCE_REJECTED'
              WHEN 'assignment_failed'   THEN 'ASSISTANCE_REJECTED'
            END,
            'central', h."actorType", h."occurredAtMs",
            json_build_object('migrado', true, 'fromStatus', h."fromStatus",
                              'toStatus', h."toStatus")::text,
            'migr-estado-' || h.id::text,
            $1
       FROM connect_status_history h
       JOIN connect_assistances a ON a.id = h."assistanceId"
      WHERE h."toStatus" IN ('assigned','technician_assigned','en_route','arrived',
                             'in_progress','finished','cancelled','no_coverage',
                             'assignment_failed')
     ON CONFLICT DO NOTHING`,
    [now],
  );

  const total = (envios.rowCount ?? 0) + (estados.rowCount ?? 0);
  if (total > 0) console.log(`Diario de asistencias: ${total} eventos históricos incorporados.`);
}
