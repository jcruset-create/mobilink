/**
 * Pruebas del esquema del motor de tarifas contra PostgreSQL real.
 *
 * El esquema se crea al arrancar el servidor, así que un error aquí no se
 * descubre en desarrollo: se descubre en el despliegue, con el servicio caído.
 * Estas pruebas comprueban que se crea desde cero, que volver a ejecutarlo no
 * rompe nada, y —lo que de verdad importa— que las restricciones impiden
 * guardar las filas que el motor no sabría interpretar después.
 *
 * Se ejecutan solo con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base
 * DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let centroId = 0;
let clienteId = 0;
let empresaId = 0;
let planId = 0;
let versionId = 0;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

/** ¿La consulta viola la restricción esperada? */
async function rechaza(sql: string, valores: unknown[]): Promise<string | null> {
  try {
    await db.query(sql, valores as any[]);
    return null;
  } catch (e: any) {
    return e?.constraint ?? e?.code ?? e?.message ?? "error";
  }
}

describe.skipIf(!RUN)("Esquema del motor de tarifas", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    const { initDb } = await import("../../db.ts");
    const { initConnect } = await import("../schema.ts");
    await initDb();
    await initConnect();
    // Segunda pasada: el esquema tiene que aguantar reejecutarse, que es lo
    // que pasa en cada arranque del servidor.
    await initConnect();

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`cc-pricing-${sufijo}`, `Centro de pruebas ${sufijo}`, now],
    );
    centroId = cc.rows[0].id;

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [centroId, `Cliente ${sufijo}`, now],
    );
    clienteId = cl.rows[0].id;

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`prov-pricing-${sufijo}`, `Proveedora ${sufijo}`, now],
    );
    empresaId = em.rows[0].id;

    const plan = await db.query(
      `INSERT INTO connect_tariff_plans ("controlCenterId", code, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`,
      [centroId, `PLAN-${sufijo}`, "Tarifario de pruebas", now],
    );
    planId = plan.rows[0].id;

    const ver = await db.query(
      `INSERT INTO connect_tariff_versions
         ("controlCenterId", "tariffPlanId", version, status, "validFromMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'2026','published',$3,$4,$4) RETURNING id`,
      [centroId, planId, now - 86_400_000, now],
    );
    versionId = ver.rows[0].id;
  }, 60_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    await db.query(`DELETE FROM connect_tariff_plans WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_clients WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [empresaId]).catch(() => {});
    await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [centroId]).catch(() => {});
  });

  it("el dinero se guarda en NUMERIC, no en coma flotante", async () => {
    // Si esto fuera double, 0.1 + 0.2 no daría 0.3 y en una factura se vería.
    const r = await db.query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name IN ('connect_tariff_rules','connect_tariff_extras',
                             'connect_assistance_pricings','connect_assistance_price_lines',
                             'connect_tariff_tire_prices','connect_manufacturer_tire_prices')
          AND (column_name ILIKE '%amount%' OR column_name ILIKE '%unitprice%'
               OR column_name ILIKE '%listprice%' OR column_name ILIKE '%total%'
               OR column_name ILIKE '%margin%' OR column_name ILIKE '%percent%')
          -- Fuera las claves ajenas y los discriminadores: priceListId y
          -- priceModel llevan 'price' en el nombre y no son importes.
          AND column_name NOT ILIKE '%id'
          AND column_name <> 'priceModel'`,
    );
    expect(r.rows.length).toBeGreaterThan(10);
    const flotantes = r.rows.filter((c: any) => c.data_type !== "numeric");
    expect(flotantes).toEqual([]);
  });

  it("las columnas de dinero de antes también son NUMERIC", async () => {
    // Estaban en double: sumar cien lineas de factura acumulaba error hasta
    // que se veia en el total.
    const r = await db.query(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
        WHERE table_schema='public'
          AND ((table_name='connect_assistances' AND column_name IN ('estimatedCost','finalCost'))
            OR (table_name='connect_tariff_lines' AND column_name IN ('baseAmount','perKmAmount')))`,
    );
    expect(r.rows).toHaveLength(4);
    expect(r.rows.filter((c: any) => c.data_type !== "numeric")).toEqual([]);
  });

  it("ninguna tabla del motor admite filas sin centro de control", async () => {
    const tablas = [
      "connect_tariff_plans", "connect_tariff_versions", "connect_contracts",
      "connect_calendars", "connect_tariff_time_bands", "connect_tariff_zones",
      "connect_tariff_extras", "connect_tariff_rules", "connect_tire_sizes",
      "connect_tire_brands", "connect_tariff_tire_prices",
      "connect_assistance_pricings", "connect_assistance_price_lines",
      "connect_pricing_overrides",
    ];
    const r = await db.query(
      `SELECT table_name, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND column_name = 'controlCenterId'
          AND table_name = ANY($1::text[])`,
      [tablas],
    );
    expect(r.rows.map((x: any) => x.table_name).sort()).toEqual([...tablas].sort());
    expect(r.rows.filter((x: any) => x.is_nullable !== "NO")).toEqual([]);
  });

  it("un contrato de venta sin cliente no se puede guardar", async () => {
    const motivo = await rechaza(
      `INSERT INTO connect_contracts
         ("controlCenterId", role, "tariffPlanId", name, "validFromMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,'sale',$2,'Sin cliente',$3,$4,$4)`,
      [centroId, planId, now, now],
    );
    expect(motivo).toBe("connect_contracts_contraparte");
  });

  it("un contrato de compra con cliente tampoco", async () => {
    const motivo = await rechaza(
      `INSERT INTO connect_contracts
         ("controlCenterId", role, "clientId", "providerCompanyId", "tariffPlanId", name,
          "validFromMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,'purchase',$2,$3,$4,'Mezclado',$5,$6,$6)`,
      [centroId, clienteId, empresaId, planId, now, now],
    );
    expect(motivo).toBe("connect_contracts_contraparte");
  });

  it("el mismo tarifario sirve de venta y de compra a la vez", async () => {
    // Es el caso real: la central compra al taller y vende a su cliente con el
    // mismo tarifario. Si esto no se pudiera, habría que duplicarlo.
    const venta = await db.query(
      `INSERT INTO connect_contracts
         ("controlCenterId", role, "clientId", "tariffPlanId", name, "validFromMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,'sale',$2,$3,'Venta',$4,$5,$5) RETURNING id`,
      [centroId, clienteId, planId, now, now],
    );
    const compra = await db.query(
      `INSERT INTO connect_contracts
         ("controlCenterId", role, "providerCompanyId", "tariffPlanId", name, "validFromMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,'purchase',$2,$3,'Compra',$4,$5,$5) RETURNING id, "tariffPlanId"`,
      [centroId, empresaId, planId, now, now],
    );
    expect(venta.rows[0].id).toBeGreaterThan(0);
    expect(compra.rows[0].tariffPlanId).toBe(planId);
  });

  it("una vigencia que termina antes de empezar se rechaza", async () => {
    const motivo = await rechaza(
      `INSERT INTO connect_tariff_versions
         ("controlCenterId", "tariffPlanId", version, "validFromMs", "validToMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [centroId, planId, `mal-${sufijo}`, now, now - 1000, now],
    );
    expect(motivo).toBe("connect_tariff_versions_vigencia");
  });

  it("una franja horaria no puede empezar y acabar a la misma hora", async () => {
    const motivo = await rechaza(
      `INSERT INTO connect_tariff_time_bands
         ("controlCenterId", code, name, "startMinute", "endMinute", "createdAtMs")
       VALUES ($1,$2,'Vacía',480,480,$3)`,
      [centroId, `BAND-${sufijo}`, now],
    );
    expect(motivo).toBe("connect_time_bands_rango");
  });

  it("una franja que cruza la medianoche sí se admite", async () => {
    const r = await db.query(
      `INSERT INTO connect_tariff_time_bands
         ("controlCenterId", code, name, "startMinute", "endMinute", weekdays, "createdAtMs")
       VALUES ($1,$2,'Nocturno',1140,480,'{1,2,3,4,5}',$3) RETURNING id, "weekdayAnchor"`,
      [centroId, `NOCT-${sufijo}`, now],
    );
    expect(r.rows[0].id).toBeGreaterThan(0);
    // Por defecto se mira el día real del momento, no el día en que empezó
    expect(r.rows[0].weekdayAnchor).toBe("moment");
  });

  it("un precio de neumático no puede colgar de marca y de grupo a la vez", async () => {
    const marca = await db.query(
      `INSERT INTO connect_tire_brands ("controlCenterId", code, name, "normalizedName", "createdAtMs")
       VALUES ($1,$2,'Bridgestone',$3,$4) RETURNING id`,
      [centroId, `BS-${sufijo}`, `bridgestone-${sufijo}`, now],
    );
    const grupo = await db.query(
      `INSERT INTO connect_tire_brand_groups ("controlCenterId", "tariffVersionId", code, name)
       VALUES ($1,$2,'PREMIUM','Premium') RETURNING id`,
      [centroId, versionId],
    );
    const motivo = await rechaza(
      `INSERT INTO connect_tariff_tire_prices
         ("controlCenterId", "tariffVersionId", "brandId", "brandGroupId", "priceModel", "netAmount", "createdAtMs")
       VALUES ($1,$2,$3,$4,'NET_PRICE',460,$5)`,
      [centroId, versionId, marca.rows[0].id, grupo.rows[0].id, now],
    );
    expect(motivo).toBe("connect_tire_prices_destino");
  });

  it("un precio neto sin importe se rechaza, y uno por descuento sin porcentaje también", async () => {
    const sinImporte = await rechaza(
      `INSERT INTO connect_tariff_tire_prices
         ("controlCenterId", "tariffVersionId", "priceModel", "createdAtMs") VALUES ($1,$2,'NET_PRICE',$3)`,
      [centroId, versionId, now],
    );
    expect(sinImporte).toBe("connect_tire_prices_modelo");

    const sinDescuento = await rechaza(
      `INSERT INTO connect_tariff_tire_prices
         ("controlCenterId", "tariffVersionId", "priceModel", "createdAtMs")
       VALUES ($1,$2,'DISCOUNT_FROM_LIST',$3)`,
      [centroId, versionId, now],
    );
    expect(sinDescuento).toBe("connect_tire_prices_modelo");
  });

  it("una asistencia no puede tener dos tarifas bloqueadas", async () => {
    // Es lo que hace idempotente el bloqueo: dos eventos simultáneos no
    // producen dos forfaits distintos para el mismo servicio.
    // En una base recién creada no hay partners: el seed no crea ninguno.
    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`partner-pricing-${sufijo}`, `Partner ${sufijo}`, now],
    );
    const partnerId = p.rows[0].id;
    const a = await db.query(
      `INSERT INTO connect_assistances (uuid, "partnerId", status, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'assigned',$3,$3) RETURNING id`,
      [`pricing-${sufijo}`, partnerId, now],
    );
    const asistenciaId = a.rows[0].id;

    await db.query(
      `INSERT INTO connect_assistance_pricings
         ("controlCenterId", "assistanceId", stage, "saleTotal", "engineVersion", "computedAtMs")
       VALUES ($1,$2,'locked',331,'test',$3)`,
      [centroId, asistenciaId, now],
    );
    const segunda = await db.query(
      `INSERT INTO connect_assistance_pricings
         ("controlCenterId", "assistanceId", stage, "saleTotal", "engineVersion", "computedAtMs")
       VALUES ($1,$2,'locked',999,'test',$3)
       ON CONFLICT ("assistanceId", stage) DO NOTHING RETURNING id`,
      [centroId, asistenciaId, now],
    );
    expect(segunda.rows).toEqual([]);

    // La estimación y el cierre sí conviven con el bloqueo: son etapas
    // distintas y ninguna sobrescribe a otra.
    const otra = await db.query(
      `INSERT INTO connect_assistance_pricings
         ("controlCenterId", "assistanceId", stage, "saleTotal", "engineVersion", "computedAtMs")
       VALUES ($1,$2,'final',362.25,'test',$3) RETURNING "saleTotal"`,
      [centroId, asistenciaId, now],
    );
    // NUMERIC llega como texto: la precisión se conserva entera
    expect(String(otra.rows[0].saleTotal)).toBe("362.2500");

    await db.query(`DELETE FROM connect_assistances WHERE id = $1`, [asistenciaId]);
    await db.query(`DELETE FROM connect_partners WHERE id = $1`, [partnerId]);
  });

  it("la compra desconocida se guarda como null, no como cero", async () => {
    const r = await db.query(
      `SELECT "purchaseTotal" FROM connect_assistance_pricings WHERE "purchaseTotal" IS NULL LIMIT 1`,
    );
    // Puede no haber filas; lo que importa es que la columna admita null
    const c = await db.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name='connect_assistance_pricings' AND column_name='purchaseTotal'`,
    );
    expect(c.rows[0].is_nullable).toBe("YES");
    expect(r.rowCount).toBeGreaterThanOrEqual(0);
  });

  it("el instante contractual queda en la asistencia", async () => {
    const c = await db.query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name='connect_assistances' AND column_name='serviceOrderedAtMs'`,
    );
    expect(c.rows[0]?.data_type).toBe("bigint");
  });
});
