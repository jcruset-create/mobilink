/**
 * Motor de tarifas — esquema.
 *
 * Migraciones idempotentes, en su propio fichero para no seguir engordando
 * `connect/schema.ts`, que ya pasa de 1.000 líneas. Se invoca desde
 * `initConnect()` al arrancar, como el resto.
 *
 * Tres reglas que se cumplen en TODAS las tablas de aquí:
 *
 *  1. `controlCenterId` obligatorio y con índice. El motor maneja costes,
 *     precios y márgenes: una fila sin dueño es una fuga de datos entre
 *     centros de control esperando a ocurrir.
 *  2. Dinero en NUMERIC, nunca en coma flotante. `0.1 + 0.2` no es `0.3` y en
 *     una factura eso se ve.
 *  3. Una versión publicada no se modifica. Corregir un precio es publicar
 *     otra versión. Es lo que permite reproducir dentro de tres años por qué
 *     una asistencia costó lo que costó.
 *
 * El diseño completo está en docs/PRICING_diseno.md.
 */

import db from "../../db.ts";

/** Importes y porcentajes: escala fija, la misma en todas las tablas. */
const MONEY = "NUMERIC(14,4)";
const PERCENT = "NUMERIC(7,4)";

export async function initPricing(): Promise<void> {
  // ── Contratos, tarifarios y versiones ────────────────────────────────────
  await db.query(`
    /*
     * El contrato es quien dice si un tarifario se usa para comprar o para
     * vender. El tarifario en sí es neutro: es una lista de precios, igual que
     * el PDF que la central tiene encima de la mesa, y ese papel no dice si se
     * usa para comprar o para vender.
     * Así el mismo tarifario se carga una vez y lo apuntan los dos contratos
     * —el del cliente al que se factura y el del taller que factura—, y un
     * cambio de precio mueve las dos facturas a la vez, que es lo que pasa en
     * la realidad.
     */
    CREATE TABLE IF NOT EXISTS connect_tariff_plans (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      currency TEXT NOT NULL DEFAULT 'EUR',
      -- Las franjas y los festivos se resuelven en esta zona, no en UTC
      timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
      "calendarId" INTEGER,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("controlCenterId", code)
    );
    CREATE INDEX IF NOT EXISTS idx_tariff_plans_cc
      ON connect_tariff_plans ("controlCenterId");

    CREATE TABLE IF NOT EXISTS connect_tariff_versions (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "tariffPlanId" INTEGER NOT NULL REFERENCES connect_tariff_plans(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',   -- draft | published | archived
      "validFromMs" BIGINT NOT NULL,
      "validToMs" BIGINT,                     -- NULL = sin fin
      priority INTEGER NOT NULL DEFAULT 0,
      "publishedAtMs" BIGINT,
      "publishedByUserId" INTEGER,
      "sourceDocument" TEXT,
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("tariffPlanId", version),
      CONSTRAINT connect_tariff_versions_vigencia
        CHECK ("validToMs" IS NULL OR "validToMs" > "validFromMs")
    );
    CREATE INDEX IF NOT EXISTS idx_tariff_versions_vigencia
      ON connect_tariff_versions ("tariffPlanId", status, "validFromMs", "validToMs");

    CREATE TABLE IF NOT EXISTS connect_contracts (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      role TEXT NOT NULL,                     -- sale | purchase
      "clientId" INTEGER REFERENCES connect_clients(id),
      "providerCompanyId" INTEGER REFERENCES connect_provider_companies(id),
      -- Acuerdo con un taller concreto de esa empresa, si lo hay
      "workshopId" INTEGER REFERENCES connect_workshops(id),
      "tariffPlanId" INTEGER NOT NULL REFERENCES connect_tariff_plans(id),
      code TEXT,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EUR',
      "validFromMs" BIGINT NOT NULL,
      "validToMs" BIGINT,
      status TEXT NOT NULL DEFAULT 'draft',   -- draft | active | ended
      priority INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      /*
       * La contraparte depende del papel y no puede quedar a medias: un
       * contrato de venta sin cliente no se puede resolver, y uno de compra
       * con cliente sería una fila que nadie sabría interpretar.
       */
      CONSTRAINT connect_contracts_contraparte CHECK (
        (role = 'sale'     AND "clientId" IS NOT NULL AND "providerCompanyId" IS NULL) OR
        (role = 'purchase' AND "providerCompanyId" IS NOT NULL AND "clientId" IS NULL)
      ),
      CONSTRAINT connect_contracts_vigencia
        CHECK ("validToMs" IS NULL OR "validToMs" > "validFromMs")
    );
    CREATE INDEX IF NOT EXISTS idx_contracts_venta
      ON connect_contracts ("controlCenterId", role, "clientId", status);
    CREATE INDEX IF NOT EXISTS idx_contracts_compra
      ON connect_contracts ("controlCenterId", role, "providerCompanyId", "workshopId", status);
  `);

  // ── Calendario ───────────────────────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS connect_calendars (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'ES',
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      "updatedAtMs" BIGINT NOT NULL,
      UNIQUE ("controlCenterId", code)
    );

    /*
     * Un día puede estar varias veces con ámbitos distintos: el 25 de
     * diciembre es festivo nacional y además Navidad, y el motor necesita
     * saber las dos cosas para que la regla de Navidad pueda ganarle a la de
     * festivo. Por eso dayClass es libre y la unicidad incluye el ámbito.
     */
    CREATE TABLE IF NOT EXISTS connect_calendar_days (
      id SERIAL PRIMARY KEY,
      "calendarId" INTEGER NOT NULL REFERENCES connect_calendars(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      scope TEXT NOT NULL,          -- national | regional | provincial | local | special
      "regionCode" TEXT,
      "provinceCode" TEXT,
      municipality TEXT,
      "dayClass" TEXT NOT NULL DEFAULT 'holiday',
      name TEXT,
      yearly BOOLEAN NOT NULL DEFAULT false,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL
    );
    -- Con COALESCE no vale una restriccion UNIQUE: tiene que ser un indice.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_days_unico
      ON connect_calendar_days ("calendarId", date, scope, "dayClass",
        COALESCE("regionCode", ''), COALESCE("provinceCode", ''), COALESCE(municipality, ''));
    CREATE INDEX IF NOT EXISTS idx_calendar_days_fecha
      ON connect_calendar_days ("calendarId", date) WHERE active;
  `);

  // ── Franjas horarias y zonas ─────────────────────────────────────────────
  await db.query(`
    /*
     * Los minutos van desde medianoche en hora LOCAL del tarifario. Si
     * startMinute > endMinute la franja cruza la medianoche y vale
     * [start, 1440) ∪ [0, end): así "19:00-08:00" es una sola fila.
     *
     * weekdayAnchor resuelve una ambigüedad real de "L-V 19:00-08:00": el
     * sábado a las 02:00, ¿es el nocturno del viernes o ya es sábado? Con
     * 'moment' se mira el día real; con 'band_start', la noche pertenece al
     * día en que empezó. Es configuración, no una decisión del código.
     */
    CREATE TABLE IF NOT EXISTS connect_tariff_time_bands (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      "startMinute" INTEGER NOT NULL,
      "endMinute" INTEGER NOT NULL,
      weekdays INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',  -- 1=lunes … 7=domingo
      "weekdayAnchor" TEXT NOT NULL DEFAULT 'moment',          -- moment | band_start
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      UNIQUE ("controlCenterId", code),
      CONSTRAINT connect_time_bands_rango CHECK (
        "startMinute" >= 0 AND "startMinute" < 1440 AND
        "endMinute"   >= 0 AND "endMinute"  <= 1440 AND
        "startMinute" <> "endMinute"
      )
    );

    CREATE TABLE IF NOT EXISTS connect_tariff_zones (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,   -- COUNTRY | COUNTRY_GROUP | REGION | PROVINCE
                            -- | CUSTOM | ROAD_NETWORK | PRIVATE_HIGHWAY
      priority INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      UNIQUE ("controlCenterId", code)
    );

    CREATE TABLE IF NOT EXISTS connect_tariff_zone_members (
      id SERIAL PRIMARY KEY,
      "zoneId" INTEGER NOT NULL REFERENCES connect_tariff_zones(id) ON DELETE CASCADE,
      "matchType" TEXT NOT NULL,  -- country | region | province | postal_prefix | road | polygon
      value TEXT,
      polygon JSONB,
      CONSTRAINT connect_zone_members_valor CHECK (
        ("matchType" = 'polygon' AND polygon IS NOT NULL) OR
        ("matchType" <> 'polygon' AND value IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_zone_members_zona
      ON connect_tariff_zone_members ("zoneId", "matchType");
  `);

  // ── Extras y reglas de servicio ──────────────────────────────────────────
  await db.query(`
    CREATE TABLE IF NOT EXISTS connect_tariff_extras (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "tariffVersionId" INTEGER NOT NULL REFERENCES connect_tariff_versions(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      "calculationType" TEXT NOT NULL,
      -- FIXED | PER_UNIT | PER_KM | PER_MINUTE | PER_HOUR | PERCENTAGE | FORMULA
      amount ${MONEY},
      percentage ${PERCENT},
      unit TEXT,
      "appliesTo" TEXT NOT NULL DEFAULT 'assistance',  -- assistance | forfait | line
      "lineKind" TEXT,             -- tipo de línea que genera (EXTRA_KM, TOLL…)
      conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
      priority INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      UNIQUE ("tariffVersionId", code)
    );

    /*
     * Una regla produce UN importe. Que ese importe sea de compra o de venta
     * lo decide el contrato que apunta a esta versión, no la regla.
     *
     * Las dimensiones a NULL son comodín ("cualquiera"). Cuantas menos NULL,
     * más específica es la regla, y eso desempata cuando dos tienen la misma
     * prioridad.
     */
    CREATE TABLE IF NOT EXISTS connect_tariff_rules (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "tariffVersionId" INTEGER NOT NULL REFERENCES connect_tariff_versions(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,

      "serviceTypeCode" TEXT,
      "vehicleTypeCode" TEXT,
      "zoneId" INTEGER REFERENCES connect_tariff_zones(id),
      "timeBandId" INTEGER REFERENCES connect_tariff_time_bands(id),
      "dayClasses" TEXT[],

      "minDistanceKm" ${MONEY},
      "maxDistanceKm" ${MONEY},
      "minDurationMin" INTEGER,
      "maxDurationMin" INTEGER,

      amount ${MONEY} NOT NULL DEFAULT 0,
      "includedDistanceKm" ${MONEY},
      "includedDurationMin" INTEGER,

      "extraDistanceExtraId" INTEGER REFERENCES connect_tariff_extras(id),
      "extraDurationExtraId" INTEGER REFERENCES connect_tariff_extras(id),
      /*
       * Cómo se dispara el suplemento (la "regla del 20 %" es esto, y es un
       * dato: THRESHOLD_PERCENT con umbral 20, no una excepción en el código).
       */
      "extraTriggerType" TEXT NOT NULL DEFAULT 'ALWAYS',
      -- ALWAYS | THRESHOLD_PERCENT | THRESHOLD_ABSOLUTE
      "extraThresholdPercent" ${PERCENT},

      priority INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      notes TEXT,
      "createdAtMs" BIGINT NOT NULL,
      UNIQUE ("tariffVersionId", code)
    );
    CREATE INDEX IF NOT EXISTS idx_tariff_rules_resolucion
      ON connect_tariff_rules ("tariffVersionId", active, priority DESC);
  `);

  // ── Neumáticos ───────────────────────────────────────────────────────────
  await db.query(`
    /*
     * Medidas normalizadas: 315/70R22.5, 315/70 R 22.5 y 315-70-22,5 son la
     * misma y no pueden dar dos filas. La normalización la hace el mismo
     * código que TyreControl (medidaCanonica), para que el día que se quiera
     * cruzar el catálogo de precios con el almacén, cruce.
     */
    CREATE TABLE IF NOT EXISTS connect_tire_sizes (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      width INTEGER,
      "aspectRatio" INTEGER,
      "rimDiameter" NUMERIC(4,1),
      "normalizedCode" TEXT NOT NULL,
      "rawInput" TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      UNIQUE ("controlCenterId", "normalizedCode")
    );

    CREATE TABLE IF NOT EXISTS connect_tire_brands (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      "normalizedName" TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      UNIQUE ("controlCenterId", "normalizedName")
    );

    /*
     * El grupo cuelga de la VERSIÓN tarifaria, no de la marca: que Hankook sea
     * IMPORT_1 para un cliente no obliga a que lo sea para otro.
     */
    CREATE TABLE IF NOT EXISTS connect_tire_brand_groups (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "tariffVersionId" INTEGER NOT NULL REFERENCES connect_tariff_versions(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE ("tariffVersionId", code)
    );

    CREATE TABLE IF NOT EXISTS connect_tire_brand_group_members (
      id SERIAL PRIMARY KEY,
      "groupId" INTEGER NOT NULL REFERENCES connect_tire_brand_groups(id) ON DELETE CASCADE,
      "brandId" INTEGER NOT NULL REFERENCES connect_tire_brands(id) ON DELETE CASCADE,
      UNIQUE ("groupId", "brandId")
    );

    CREATE TABLE IF NOT EXISTS connect_manufacturer_price_lists (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "brandId" INTEGER NOT NULL REFERENCES connect_tire_brands(id),
      name TEXT NOT NULL,
      "validFromMs" BIGINT NOT NULL,
      "validToMs" BIGINT,
      "sourceDocument" TEXT,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manufacturer_lists_vigencia
      ON connect_manufacturer_price_lists ("brandId", "validFromMs", "validToMs");

    CREATE TABLE IF NOT EXISTS connect_manufacturer_tire_prices (
      id SERIAL PRIMARY KEY,
      "priceListId" INTEGER NOT NULL REFERENCES connect_manufacturer_price_lists(id) ON DELETE CASCADE,
      "tireSizeId" INTEGER NOT NULL REFERENCES connect_tire_sizes(id),
      model TEXT,
      "listPrice" ${MONEY} NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturer_prices_unico
      ON connect_manufacturer_tire_prices ("priceListId", "tireSizeId", COALESCE(model, ''));

    CREATE TABLE IF NOT EXISTS connect_tariff_tire_prices (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "tariffVersionId" INTEGER NOT NULL REFERENCES connect_tariff_versions(id) ON DELETE CASCADE,
      "tireSizeId" INTEGER REFERENCES connect_tire_sizes(id),
      "brandId" INTEGER REFERENCES connect_tire_brands(id),
      "brandGroupId" INTEGER REFERENCES connect_tire_brand_groups(id),
      position TEXT NOT NULL DEFAULT 'ANY',   -- STEER | DRIVE | TRAILER | ANY
      "priceModel" TEXT NOT NULL,             -- NET_PRICE | DISCOUNT_FROM_LIST
      "netAmount" ${MONEY},
      "discountPercent" ${PERCENT},
      "manufacturerPriceListId" INTEGER REFERENCES connect_manufacturer_price_lists(id),
      priority INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      "createdAtMs" BIGINT NOT NULL,
      -- Marca o grupo, no las dos: si no, no se sabría cuál manda
      CONSTRAINT connect_tire_prices_destino CHECK (
        ("brandId" IS NOT NULL AND "brandGroupId" IS NULL) OR
        ("brandId" IS NULL AND "brandGroupId" IS NOT NULL) OR
        ("brandId" IS NULL AND "brandGroupId" IS NULL)
      ),
      CONSTRAINT connect_tire_prices_modelo CHECK (
        ("priceModel" = 'NET_PRICE' AND "netAmount" IS NOT NULL) OR
        ("priceModel" = 'DISCOUNT_FROM_LIST' AND "discountPercent" IS NOT NULL)
      )
    );
    CREATE INDEX IF NOT EXISTS idx_tire_prices_resolucion
      ON connect_tariff_tire_prices ("tariffVersionId", "tireSizeId", active, priority DESC);
  `);

  // ── Resultado de la tarificación ─────────────────────────────────────────
  await db.query(`
    /*
     * Una fila por etapa. La restricción única sobre (asistencia, etapa) es lo
     * que hace idempotente el bloqueo: dos eventos simultáneos no producen dos
     * tarifas bloqueadas, y reintentar el cierre no duplica nada.
     *
     * El snapshot guarda el porqué completo del cálculo. La pregunta que tiene
     * que poder responderse dentro de tres años no es "cuánto costó" —eso está
     * en los totales— sino "por qué costó eso", con el tarifario de entonces,
     * no con el de ahora.
     */
    CREATE TABLE IF NOT EXISTS connect_assistance_pricings (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,              -- estimate | locked | final
      status TEXT NOT NULL DEFAULT 'ok', -- ok | manual_review | partial

      "saleContractId" INTEGER REFERENCES connect_contracts(id),
      "saleVersionId" INTEGER REFERENCES connect_tariff_versions(id),
      "saleRuleId" INTEGER REFERENCES connect_tariff_rules(id),
      "purchaseContractId" INTEGER REFERENCES connect_contracts(id),
      "purchaseVersionId" INTEGER REFERENCES connect_tariff_versions(id),
      "purchaseRuleId" INTEGER REFERENCES connect_tariff_rules(id),

      -- NULL significa DESCONOCIDO, nunca cero. Un taller sin acuerdo deja la
      -- compra sin determinar; poner 0 sería inventarse un margen.
      "purchaseTotal" ${MONEY},
      "saleTotal" ${MONEY},
      "grossMargin" ${MONEY},
      "grossMarginPct" ${PERCENT},
      currency TEXT NOT NULL DEFAULT 'EUR',

      snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
      "engineVersion" TEXT NOT NULL,
      "pricingRequestId" TEXT,
      "computedAtMs" BIGINT NOT NULL,
      "computedByUserId" INTEGER,
      UNIQUE ("assistanceId", stage)
    );
    CREATE INDEX IF NOT EXISTS idx_assistance_pricings_cc
      ON connect_assistance_pricings ("controlCenterId", "computedAtMs" DESC);

    /*
     * La línea SÍ lleva compra y venta, porque el mismo concepto (el forfait)
     * se compra y se vende. Cada lado guarda su regla de origen: son
     * resoluciones distintas del mismo motor sobre contratos distintos.
     */
    CREATE TABLE IF NOT EXISTS connect_assistance_price_lines (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "pricingId" INTEGER NOT NULL REFERENCES connect_assistance_pricings(id) ON DELETE CASCADE,
      "lineNumber" INTEGER NOT NULL,
      kind TEXT NOT NULL,
      -- FORFAIT | EXTRA_KM | EXTRA_TIME | TIRE | ADDITIONAL_TIRE | MATERIAL
      -- | CANCELLATION | ADMIN_FEE | TOLL | OTHER
      "conceptCode" TEXT,
      description TEXT NOT NULL,
      quantity NUMERIC(12,4) NOT NULL DEFAULT 1,
      unit TEXT,
      "purchaseUnitPrice" ${MONEY},
      "saleUnitPrice" ${MONEY},
      "purchaseTotal" ${MONEY},
      "saleTotal" ${MONEY},
      "saleRuleId" INTEGER REFERENCES connect_tariff_rules(id),
      "purchaseRuleId" INTEGER REFERENCES connect_tariff_rules(id),
      "extraId" INTEGER REFERENCES connect_tariff_extras(id),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAtMs" BIGINT NOT NULL,
      UNIQUE ("pricingId", "lineNumber")
    );

    /*
     * Nunca se sustituye un importe en silencio. Se guarda el anterior, el
     * nuevo, el motivo y quién lo autorizó.
     */
    CREATE TABLE IF NOT EXISTS connect_pricing_overrides (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      "priceLineId" INTEGER REFERENCES connect_assistance_price_lines(id) ON DELETE SET NULL,
      field TEXT NOT NULL,
      "originalValue" ${MONEY},
      "newValue" ${MONEY} NOT NULL,
      reason TEXT NOT NULL,
      "authorizedByUserId" INTEGER,
      "authorizedByName" TEXT,
      "authorizedAtMs" BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pricing_overrides_asistencia
      ON connect_pricing_overrides ("assistanceId", "authorizedAtMs" DESC);

    /*
     * Qué ha salido ya hacia el ERP y por qué lado.
     *
     * Dos lados y dos marcas, porque son dos documentos distintos a dos
     * empresas distintas: la factura al cliente (venta) y la que el taller
     * emite a la central (compra). Que la de venta esté hecha no dice nada de
     * la de compra, y la columna invoicedAtMs de siempre no podía
     * distinguirlas.
     *
     * El UNIQUE es lo que impide facturar dos veces el mismo servicio: una
     * exportación repetida se encuentra la marca y se salta la línea, en vez
     * de mandar un duplicado que alguien tendría que abonar después.
     */
    CREATE TABLE IF NOT EXISTS connect_billing_marks (
      id SERIAL PRIMARY KEY,
      "controlCenterId" INTEGER NOT NULL REFERENCES connect_control_centers(id),
      "assistanceId" INTEGER NOT NULL REFERENCES connect_assistances(id) ON DELETE CASCADE,
      side TEXT NOT NULL,                     -- sale | purchase
      "exportedAtMs" BIGINT NOT NULL,
      "exportedByUserId" INTEGER,
      "externalReference" TEXT,               -- número de factura o de lote del ERP
      amount ${MONEY},
      currency TEXT NOT NULL DEFAULT 'EUR',
      UNIQUE ("assistanceId", side)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_marks_centro
      ON connect_billing_marks ("controlCenterId", "exportedAtMs" DESC);
  `);

  // El plan apunta a su calendario; la clave se añade aparte porque
  // connect_calendars se crea después de connect_tariff_plans.
  await db.query(`
    DO $$ BEGIN
      ALTER TABLE connect_tariff_plans
        ADD CONSTRAINT connect_tariff_plans_calendario
        FOREIGN KEY ("calendarId") REFERENCES connect_calendars(id);
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);

  /*
   * El instante contractual: cuándo se dio la orden de salida al taller. El
   * forfait se congela ahí, no cuando el técnico llega. Es una marca de
   * tiempo y no un estado nuevo a propósito: añadir SERVICE_ORDERED a la
   * máquina obligaría a tocar la APK Lite, el core, los webhooks de partners
   * y los KPIs, y a migrar el histórico.
   */
  await db.query(`
    ALTER TABLE connect_assistances ADD COLUMN IF NOT EXISTS "serviceOrderedAtMs" BIGINT;
  `);

  await migrarImportesADecimal();
  await habilitarRls();
}

/**
 * Las columnas de dinero que ya existían estaban en DOUBLE PRECISION.
 *
 * En coma flotante binaria, 0,1 + 0,2 no es 0,3, y sumar cien líneas de
 * factura acumula el error hasta que se ve en el total. Se pasan a NUMERIC,
 * que es exacto en decimal.
 *
 * El ALTER reescribe la tabla entera y bloquea, así que solo se ejecuta si el
 * tipo todavía es el antiguo: comprobarlo antes evita reescribirlas en cada
 * arranque del servidor.
 *
 * Efecto colateral que hay que tener presente: node-postgres devuelve NUMERIC
 * como TEXTO para no perder precisión. Todo lo que lea estas columnas tiene
 * que envolver en Number() antes de operar o de formatear.
 */
async function migrarImportesADecimal(): Promise<void> {
  const columnas: Array<[string, string, string]> = [
    ["connect_assistances", "estimatedCost", MONEY],
    ["connect_assistances", "finalCost", MONEY],
    ["connect_tariff_lines", "baseAmount", MONEY],
    ["connect_tariff_lines", "perKmAmount", MONEY],
  ];
  for (const [tabla, columna, tipo] of columnas) {
    const r = await db.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [tabla, columna],
    );
    const actual = r.rows[0]?.data_type;
    if (!actual || actual === "numeric") continue;
    await db.query(
      `ALTER TABLE ${tabla} ALTER COLUMN "${columna}" TYPE ${tipo} USING "${columna}"::${tipo}`,
    );
    console.log(`[Pricing] ${tabla}."${columna}": ${actual} → ${tipo}`);
  }
}

/**
 * RLS en todas las tablas del motor.
 *
 * Hoy Central Pro accede con credenciales de servicio, que se saltan RLS: esto
 * no cambia nada en ejecución. Se activa igualmente porque no cuesta nada y
 * porque el día que alguna de estas tablas se exponga por PostgREST —donde el
 * usuario sí lleva su propio rol— la protección ya estará escrita. El
 * aislamiento efectivo de hoy lo da la capa de acceso, que exige el centro de
 * control en cada consulta.
 */
async function habilitarRls(): Promise<void> {
  const tablas = [
    "connect_tariff_plans", "connect_tariff_versions", "connect_contracts",
    "connect_calendars", "connect_tariff_time_bands", "connect_tariff_zones",
    "connect_tariff_extras", "connect_tariff_rules",
    "connect_tire_sizes", "connect_tire_brands", "connect_tire_brand_groups",
    "connect_manufacturer_price_lists", "connect_tariff_tire_prices",
    "connect_assistance_pricings", "connect_assistance_price_lines",
    "connect_pricing_overrides", "connect_billing_marks",
  ];
  for (const tabla of tablas) {
    await db.query(`ALTER TABLE ${tabla} ENABLE ROW LEVEL SECURITY;`).catch(() => {});
    // Una política por tabla, idempotente: el rol de servicio la ignora, y
    // cualquier otro solo ve su centro de control.
    await db.query(`
      DO $$ BEGIN
        CREATE POLICY ${tabla}_tenant ON ${tabla}
          USING ("controlCenterId" = NULLIF(current_setting('app.control_center_id', true), '')::int);
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `).catch((e: any) => console.error(`[Pricing] RLS ${tabla}:`, e?.message));
  }
}
