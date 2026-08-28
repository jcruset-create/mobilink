/**
 * Núcleo multiempresa: identidad de empresa + relación comercial con la central.
 *
 * En su propio fichero para no seguir engordando `connect/schema.ts`, igual
 * que hizo el motor de tarifas. Se invoca desde `initConnect()` al arrancar.
 *
 * Todo es aditivo y idempotente. No se borra ni se renombra ninguna columna,
 * porque `connect_provider_companies`, `connect_workshops` y `connect_clients`
 * ya están en producción y hay dos paneles leyéndolas.
 *
 * ── Sobre el backfill, que es la decisión delicada ──────────────────────────
 *
 * A partir de aquí una central ve una empresa si tiene relación con ella. Si
 * las relaciones se crearan vacías, mañana por la mañana la cartera de
 * proveedores aparecería en blanco: el filtro sería correcto y el panel,
 * inservible.
 *
 * Así que el backfill da de alta la relación de CADA empresa con CADA central
 * existente. Eso reproduce exactamente lo que se ve hoy —hoy no hay filtro, o
 * sea que todas las centrales ven todo— y no inventa una separación que nadie
 * ha decidido: no hay forma de saber a posteriori qué empresa pertenece a qué
 * plataforma. La separación real empieza con los datos nuevos, y las
 * relaciones sobrantes se quitan desde la ficha cuando cada central diga
 * cuáles son suyas.
 */

import db from "../db.ts";

export async function initEmpresas(): Promise<void> {
  // ── 1) UUID en las entidades que van a viajar por integraciones ──────────
  /*
   * Los id SERIAL se quedan como están: son la clave de decenas de consultas
   * y de las claves ajenas, y cambiarlos sería reescribir medio backend por
   * un beneficio que no necesitamos todavía.
   *
   * Lo que sí hace falta es un identificador que no colisione al cruzar
   * sistemas: el «cliente 42» de una central y el de otra son cosas distintas,
   * y un ERP que reciba las dos no puede distinguirlas. El uuid es ese
   * identificador. `connect_provider_companies` ya lo tenía; se le añade a las
   * tres que faltaban.
   */
  await db.query(`
    ALTER TABLE connect_workshops ADD COLUMN IF NOT EXISTS uuid TEXT;
    ALTER TABLE connect_clients ADD COLUMN IF NOT EXISTS uuid TEXT;
    ALTER TABLE connect_workshop_contacts ADD COLUMN IF NOT EXISTS uuid TEXT;

    UPDATE connect_workshops SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
    UPDATE connect_clients SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;
    UPDATE connect_workshop_contacts SET uuid = gen_random_uuid()::text WHERE uuid IS NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_workshops_uuid ON connect_workshops (uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_clients_uuid ON connect_clients (uuid);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_contacts_uuid ON connect_workshop_contacts (uuid);
  `);

  // ── 2) La empresa como identidad maestra ─────────────────────────────────
  /*
   * `connect_provider_companies` pasa a ser la ficha de identidad de CUALQUIER
   * empresa, no solo de las proveedoras. El nombre de la tabla se queda:
   * renombrarla rompería el código de los dos paneles y de las integraciones a
   * cambio de nada que el usuario vaya a ver.
   *
   * Aquí solo van datos que no dependen de con quién se trate. Las condiciones
   * comerciales viven en la relación, más abajo.
   */
  await db.query(`
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS "vatNumber" TEXT;
    ALTER TABLE connect_provider_companies ADD COLUMN IF NOT EXISTS "taxIdNormalized" TEXT;

    UPDATE connect_provider_companies
       SET "taxIdNormalized" = upper(regexp_replace(COALESCE("taxId",''), '[^A-Za-z0-9]', '', 'g'))
     WHERE "taxIdNormalized" IS NULL;
  `);

  /*
   * El índice del CIF normalizado es la red que impide crear dos fichas de la
   * misma empresa. Es PARCIAL a propósito: solo cubre las que tienen CIF y no
   * están dadas de baja. Sin la condición, dos fichas sin CIF —que las hay,
   * dadas de alta a toda prisa durante un servicio— chocarían entre ellas.
   *
   * Se crea con tolerancia a fallo: si en la base ya conviven duplicados de
   * antes, el índice no se puede crear y el arranque NO puede caerse por eso.
   * Queda el aviso en el log y la comprobación en la API, que sí puede
   * explicar cuál es la ficha que ya existe.
   */
  try {
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_connect_companies_cif
        ON connect_provider_companies ("taxIdNormalized")
        WHERE "taxIdNormalized" <> '' AND "deletedAtMs" IS NULL;
    `);
  } catch (e: any) {
    console.warn(
      "[Connect] no se ha podido crear el índice único de CIF (¿duplicados previos?):",
      e?.message,
    );
  }

  // ── 3) Relación comercial central ↔ empresa ──────────────────────────────
  await db.query(`
    /*
     * Una fila por central y empresa. Aquí va TODO lo que depende de con quién
     * se trate: los papeles que desempeña, el código con el que la central la
     * llama, las condiciones de pago, los límites y el SLA.
     *
     * Lo que NO va aquí: los precios. Un tarifario es una lista larga con
     * versiones y vigencias, y ya tiene su sitio en connect_tariff_plans /
     * connect_contracts. Esta tabla apunta al plan por defecto y se aparta.
     */
    CREATE TABLE IF NOT EXISTS connect_tenant_companies (
      id SERIAL PRIMARY KEY,
      uuid TEXT NOT NULL UNIQUE,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "companyId" INTEGER NOT NULL REFERENCES connect_provider_companies(id),
      "internalCode" TEXT,
      roles TEXT NOT NULL DEFAULT '[]',        -- CUSTOMER | PROVIDER | PARTNER | WORKSHOP_OWNER
      status TEXT NOT NULL DEFAULT 'active',   -- active | suspended | ended
      "paymentTerms" TEXT,
      "paymentMethod" TEXT,
      "creditLimit" NUMERIC(14,4),
      "authorizationLimit" NUMERIC(14,4),
      "slaAcceptMin" INTEGER,
      "slaArrivalMin" INTEGER,
      "tariffPlanId" INTEGER,
      "billingConfig" TEXT NOT NULL DEFAULT '{}',
      "communicationsConfig" TEXT NOT NULL DEFAULT '{}',
      "validFromMs" BIGINT,
      "validToMs" BIGINT,
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("controlCenterId", "companyId"),
      CONSTRAINT connect_tenant_companies_vigencia
        CHECK ("validToMs" IS NULL OR "validFromMs" IS NULL OR "validToMs" > "validFromMs")
    );

    -- El listado de la cartera siempre entra por la central.
    CREATE INDEX IF NOT EXISTS idx_tenant_companies_cc
      ON connect_tenant_companies ("controlCenterId", status);
    -- Y la comprobación de acceso entra por la pareja: es la consulta que se
    -- hace en CADA petición sobre una empresa concreta.
    CREATE INDEX IF NOT EXISTS idx_tenant_companies_par
      ON connect_tenant_companies ("companyId", "controlCenterId");

    -- Un código interno no puede repetirse dentro de la misma central: es lo
    -- que se teclea para buscar y lo que se manda al ERP.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_companies_codigo
      ON connect_tenant_companies ("controlCenterId", "internalCode")
      WHERE "internalCode" IS NOT NULL AND "internalCode" <> '';
  `);

  // ── 4) El cliente apunta a su empresa ────────────────────────────────────
  /*
   * Nullable y sin backfill automático. Enlazar clientes con empresas por
   * parecido de nombre o de CIF sería inventarse una equivalencia que puede
   * ser falsa, y el resultado —facturar a quien no es— es de los caros. El
   * enlace se hace desde la ficha, a mano, cuando alguien lo confirma.
   */
  await db.query(`
    ALTER TABLE connect_clients
      ADD COLUMN IF NOT EXISTS "companyId" INTEGER REFERENCES connect_provider_companies(id);
    CREATE INDEX IF NOT EXISTS idx_connect_clients_company
      ON connect_clients ("companyId");
  `);

  await backfillRelaciones();
}

/**
 * Da de alta la relación que falta entre cada empresa y cada central.
 *
 * Idempotente por el UNIQUE de la tabla: al segundo arranque no hace nada.
 *
 * Los papeles se deducen de lo que ya hay, sin preguntar: si la empresa tiene
 * talleres es WORKSHOP_OWNER además de PROVIDER. Nadie es CUSTOMER de salida
 * —eso lo dice el enlace con `connect_clients`, que se hace a mano— porque
 * marcar como cliente a quien no lo es abre la puerta a facturarle.
 */
async function backfillRelaciones(): Promise<void> {
  const r = await db.query(
    `INSERT INTO connect_tenant_companies
       (uuid, "controlCenterId", "companyId", roles, status, "createdAtMs", "updatedAtMs")
     SELECT gen_random_uuid()::text, cc.id, pc.id,
            CASE WHEN EXISTS (SELECT 1 FROM connect_workshops w WHERE w."providerCompanyId" = pc.id)
                 THEN '["PROVIDER","WORKSHOP_OWNER"]'
                 ELSE '["PROVIDER"]' END,
            CASE WHEN pc.status = 'suspended' THEN 'suspended' ELSE 'active' END,
            $1, $1
       FROM connect_provider_companies pc
       CROSS JOIN connect_control_centers cc
      WHERE pc."deletedAtMs" IS NULL
        AND cc."deletedAtMs" IS NULL
     ON CONFLICT ("controlCenterId", "companyId") DO NOTHING`,
    [Date.now()],
  );
  if (r.rowCount) {
    console.log(`Connect Pro: ${r.rowCount} relaciones comerciales creadas por migración.`);
  }
}
