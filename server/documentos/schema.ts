/**
 * Registro unificado de documentos de las asistencias.
 *
 * ── Por qué una tabla nueva y no ampliar la que había ───────────────────────
 *
 * `roadside_assistance_files` guarda desde hace años las fotos y firmas de
 * Assist: id, kind, url, nombre. Le falta todo lo que este módulo necesita
 * —tenant, visibilidad, proveedor, relación con el envío— y además solo existe
 * en Assist: Central no tiene dónde guardar el albarán de un taller.
 *
 * Así que `assistance_documents` es el REGISTRO: quién, qué tipo, de dónde
 * viene y quién puede verlo. `roadside_assistance_files` sigue igual, con sus
 * filas y sus pantallas, y sus documentos se incorporan aquí en la migración.
 *
 * Lo que eso significa en la práctica, y conviene ser exacto: durante un tiempo
 * un fichero de Assist estará en las dos. La galería de fotos actual sigue
 * leyendo de la vieja; lo nuevo —tipos, visibilidad, qué falta— lee de ésta.
 * Convergen cuando la galería se migre; no se ha hecho ahora porque tocar el
 * visor de fotos no aporta nada a esta tanda y sí puede romper algo que
 * funciona.
 */

import db from "../db.ts";

export async function initDocumentos(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS assistance_documents (
      id BIGSERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,

      -- La misma terna que el diario: el id local no basta porque Assist y
      -- Central numeran por su cuenta.
      "sourceSystem" TEXT NOT NULL,          -- assist | central
      "tenantId" TEXT,
      "assistanceId" TEXT NOT NULL,
      "correlationId" TEXT,

      tipo TEXT NOT NULL,                    -- albaran | parte | factura | ...
      /*
       * De dónde viene, que es lo que decide la visibilidad por defecto:
       * la factura de un PROVEEDOR es coste interno, la propia es lo que se
       * cobra.
       */
      origen TEXT NOT NULL DEFAULT 'propio', -- propio | proveedor | contraparte
      visibilidad TEXT NOT NULL DEFAULT 'interno',

      url TEXT,
      "fileName" TEXT,
      "mimeType" TEXT,
      "sizeBytes" BIGINT,

      "providerCompanyId" INTEGER,
      "workshopId" INTEGER,
      "dispatchId" INTEGER,                  -- envío al que pertenece, si lo hay

      "documentDate" BIGINT,                 -- fecha del documento, no de la subida
      "documentNumber" TEXT,                 -- nº de albarán o de factura
      amount NUMERIC(14,4),
      currency TEXT,

      "uploadedBy" TEXT,
      notes TEXT,

      -- Vínculo con la fila antigua de Assist, para no importarla dos veces.
      "legacyFileId" INTEGER,

      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL
    );

    -- La consulta de la ficha: todos los documentos de una asistencia.
    CREATE INDEX IF NOT EXISTS idx_documentos_asistencia
      ON assistance_documents ("sourceSystem", "assistanceId", id);
    CREATE INDEX IF NOT EXISTS idx_documentos_correlacion
      ON assistance_documents ("correlationId");
    -- La bandeja de excepciones entra por tipo dentro de un tenant.
    CREATE INDEX IF NOT EXISTS idx_documentos_tenant_tipo
      ON assistance_documents ("tenantId", tipo);
    -- Idempotencia de la importación desde la tabla antigua.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_documentos_legacy
      ON assistance_documents ("legacyFileId") WHERE "legacyFileId" IS NOT NULL;
  `);

  /*
   * Estado administrativo, que NO es el estado del servicio. Se guarda
   * calculado para poder filtrar y ordenar por él sin recorrer los documentos
   * de cada asistencia en cada listado; la verdad sigue siendo la función que
   * lo deduce, y se recalcula en cada cambio.
   *
   * `costeValidadoAtMs` y `facturadaAtMs` son hechos con fecha, no banderas:
   * saber CUÁNDO se validó un coste es la mitad de una discusión.
   */
  await db.query(`
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "estadoAdmin" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "costeValidadoAtMs" BIGINT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "costeValidadoPor" TEXT;
    ALTER TABLE roadside_assistances
      ADD COLUMN IF NOT EXISTS "facturadaAtMs" BIGINT;
    CREATE INDEX IF NOT EXISTS idx_roadside_estado_admin
      ON roadside_assistances ("estadoAdmin");
  `);

  await db.query(`
    ALTER TABLE connect_assistances
      ADD COLUMN IF NOT EXISTS "estadoAdmin" TEXT;
    ALTER TABLE connect_assistances
      ADD COLUMN IF NOT EXISTS "costeValidadoAtMs" BIGINT;
    ALTER TABLE connect_assistances
      ADD COLUMN IF NOT EXISTS "costeValidadoPor" TEXT;
    ALTER TABLE connect_assistances
      ADD COLUMN IF NOT EXISTS "facturadaAtMs" BIGINT;
    CREATE INDEX IF NOT EXISTS idx_connect_estado_admin
      ON connect_assistances ("controlCenterId", "estadoAdmin");
  `);

  await importarFicherosDeAssist();
}

/**
 * Incorpora al registro los ficheros que Assist ya tenía guardados.
 *
 * Idempotente por `legacyFileId`. La visibilidad se decide por tipo con la
 * misma regla que los nuevos, con una salvedad: lo que no se reconoce entra
 * como `interno`, nunca compartido. Un fichero antiguo sin clasificar no puede
 * empezar a verse desde otra plataforma por una migración.
 */
async function importarFicherosDeAssist(): Promise<void> {
  const hay = await db.query(
    `SELECT to_regclass('public.roadside_assistance_files') AS tabla`,
  );
  if (hay.rows[0]?.tabla == null) return;

  const r = await db.query(
    `INSERT INTO assistance_documents
       (uuid, "sourceSystem", "tenantId", "assistanceId", tipo, origen, visibilidad,
        url, "fileName", "legacyFileId", "createdAtMs", "updatedAtMs")
     SELECT gen_random_uuid()::text, 'assist', a."tallerId"::text, f."assistanceId"::text,
            CASE lower(f.kind)
              WHEN 'firma'        THEN 'firma'
              WHEN 'foto'         THEN 'fotografia'
              WHEN 'fotos'        THEN 'fotografia'
              WHEN 'matricula'    THEN 'fotografia'
              WHEN 'averia'       THEN 'fotografia'
              WHEN 'albaran'      THEN 'albaran'
              WHEN 'parte'        THEN 'parte'
              WHEN 'factura'      THEN 'factura'
              WHEN 'autorizacion' THEN 'autorizacion'
              ELSE 'otro'
            END,
            'propio',
            CASE lower(f.kind)
              WHEN 'albaran' THEN 'cliente'
              WHEN 'parte'   THEN 'cliente'
              WHEN 'firma'        THEN 'compartido'
              WHEN 'foto'         THEN 'compartido'
              WHEN 'fotos'        THEN 'compartido'
              WHEN 'matricula'    THEN 'compartido'
              WHEN 'averia'       THEN 'compartido'
              WHEN 'autorizacion' THEN 'compartido'
              ELSE 'interno'
            END,
            f.url, f."fileName", f.id, f."createdAtMs", f."createdAtMs"
       FROM roadside_assistance_files f
       JOIN roadside_assistances a ON a.id = f."assistanceId"
     ON CONFLICT DO NOTHING`,
  );
  if (r.rowCount) {
    console.log(`Documentos: ${r.rowCount} ficheros de Assist incorporados al registro.`);
  }
}
