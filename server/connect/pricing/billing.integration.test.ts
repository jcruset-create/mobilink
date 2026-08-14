/**
 * Facturación desde las líneas del motor, contra PostgreSQL.
 *
 * Aquí se prueban las dos cosas que no se pueden probar en memoria y que
 * cuestan dinero cuando fallan:
 *
 *  - Que un servicio prestado sin tarifa de cierre NO desaparece del listado.
 *    Se factura de menos en silencio, y nadie echa de menos una fila que nunca
 *    ha visto.
 *  - Que no se puede facturar dos veces lo mismo. Un duplicado es peor que un
 *    olvido: hay que abonarlo, y con el cliente delante.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026_COMPRA, SEAS_2026_VENTA } from "./tarifarios/seas2026.ts";
import { agruparEnDocumentos } from "./billing.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let repo: typeof import("./billingRepo.ts");
let bloquear: typeof import("./service.ts").bloquear;
let finalizar: typeof import("./service.ts").finalizar;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const VIERNES_NOCHE = Date.parse("2026-08-14T22:17:00+02:00");
const AGOSTO = { desdeMs: Date.parse("2026-08-01T00:00:00Z"), hastaMs: Date.parse("2026-09-01T00:00:00Z") };
const JULIO = { desdeMs: Date.parse("2026-07-01T00:00:00Z"), hastaMs: Date.parse("2026-08-01T00:00:00Z") };

let centroId = 0;
let otroCentroId = 0;
let clienteId = 0;
let empresaId = 0;
let tallerId = 0;
let partnerId = 0;

async function crearAsistencia(p: {
  ordenSalidaMs?: number | null; estado?: string; centro?: number;
} = {}): Promise<number> {
  const id = String(process.hrtime.bigint()).slice(-9);
  const r = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "controlCenterId", "clientId", "workshopId", status,
        "serviceType", vehicle, "serviceOrderedAtMs", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,'tyres',$7,$8,$9,$9) RETURNING id`,
    [`fact-${id}`, partnerId, p.centro ?? centroId, clienteId, tallerId,
     p.estado ?? "finished", JSON.stringify({ type: "truck", plate: "1234ABC" }),
     p.ordenSalidaMs === undefined ? VIERNES_NOCHE : p.ordenSalidaMs, now],
  );
  return Number(r.rows[0].id);
}

const periodo = (p: { desdeMs: number; hastaMs: number }, centro = centroId) =>
  ({ controlCenterId: centro, ...p });

describe.skipIf(!RUN)("Facturación desde el motor", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    repo = await import("./billingRepo.ts");
    ({ bloquear, finalizar } = await import("./service.ts"));
    const { cargarTarifario, publicarVersion } = await import("./tarifario.ts");

    const centro = async (etiqueta: string) => {
      const r = await db.query(
        `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$3) RETURNING id`,
        [`cc-fac-${etiqueta}-${sufijo}`, `Central ${etiqueta} ${sufijo}`, now]);
      return Number(r.rows[0].id);
    };
    centroId = await centro("a");
    otroCentroId = await centro("b");

    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`, [`pa-fac-${sufijo}`, `Partner ${sufijo}`, centroId, now]);
    partnerId = Number(p.rows[0].id);

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centroId, `Transportes ${sufijo}`, now]);
    clienteId = Number(cl.rows[0].id);

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`pr-fac-${sufijo}`, `Taller SL ${sufijo}`, now]);
    empresaId = Number(em.rows[0].id);

    const w = await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", "createdAtMs", "updatedAtMs")
       VALUES ($1,41.1,1.2,$2,$3,$3) RETURNING id`, [`Taller ${sufijo}`, empresaId, now]);
    tallerId = Number(w.rows[0].id);

    const v = await cargarTarifario(centroId, { ...SEAS_2026_VENTA, code: `FACV_${sufijo}` });
    const c = await cargarTarifario(centroId, { ...SEAS_2026_COMPRA, code: `FACC_${sufijo}` });
    await publicarVersion(v.tariffVersionId, null);
    await publicarVersion(c.tariffVersionId, null);

    for (const [role, columna, valor, planId] of [
      ["sale", '"clientId"', clienteId, v.tariffPlanId],
      ["purchase", '"providerCompanyId"', empresaId, c.tariffPlanId],
    ] as const) {
      await db.query(
        `INSERT INTO connect_contracts
           ("controlCenterId", role, ${columna}, "tariffPlanId", name, status,
            "validFromMs", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$7)`,
        [centroId, role, valor, planId, `Contrato ${role}`, Date.parse("2026-01-01T00:00:00Z"), now]);
    }
  }, 90_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    for (const centro of [centroId, otroCentroId]) {
      for (const sql of [
        `DELETE FROM connect_billing_marks WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_assistances WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_contracts WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_plans WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_calendars WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_time_bands WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_zones WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tire_brands WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tire_sizes WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_partners WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_clients WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_control_centers WHERE id = $1`,
      ]) await db.query(sql, [centro]).catch(() => {});
    }
    await db.query(`DELETE FROM connect_workshops WHERE id = $1`, [tallerId]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [empresaId]).catch(() => {});
  }, 30_000);

  it("una asistencia cerrada sale con sus líneas por los dos lados", async () => {
    const id = await crearAsistencia();
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 125 });

    const venta = (await repo.lineasFacturables(periodo(AGOSTO), "sale"))
      .filter((l) => l.assistanceId === id);
    expect(venta.map((l) => l.kind)).toEqual(["FORFAIT", "EXTRA_KM"]);
    expect(venta[0].clientName).toContain("Transportes");
    expect(venta[0].plate).toBe("1234ABC");

    const compra = (await repo.lineasFacturables(periodo(AGOSTO), "purchase"))
      .filter((l) => l.assistanceId === id);
    expect(compra[0].providerName).toContain("Taller SL");

    // 331 + 25 km × 1,25 de venta; 275 + 25 × 1,10 de compra
    const docV = agruparEnDocumentos(venta, "sale");
    const docC = agruparEnDocumentos(compra, "purchase");
    expect(docV[0].baseImponible).toBe("362.25");
    expect(docC[0].baseImponible).toBe("302.50");
  });

  it("una tarifa solo comprometida NO se factura: se cobra el cierre", async () => {
    const id = await crearAsistencia();
    await bloquear(id, { distanceKm: 76 });   // sin finalizar

    const filas = await repo.lineasFacturables(periodo(AGOSTO), "sale");
    expect(filas.some((l) => l.assistanceId === id)).toBe(false);
  });

  it("y sale en pendientes de cierre, que es lo que evita facturar de menos", async () => {
    const id = await crearAsistencia();
    await bloquear(id, { distanceKm: 76 });

    const pendientes = await repo.pendientesDeCierre(periodo(AGOSTO));
    const mia = pendientes.find((x: any) => x.id === id) as any;
    expect(mia).toBeTruthy();
    expect(mia.tieneBloqueada).toBe(true);
    expect(mia.clientName).toContain("Transportes");
  });

  it("una asistencia terminada sin tarifa ninguna también sale en pendientes", async () => {
    // El caso peor: servicio prestado del que no hay ni forfait comprometido
    const id = await crearAsistencia();
    const pendientes = await repo.pendientesDeCierre(periodo(AGOSTO));
    const mia = pendientes.find((x: any) => x.id === id) as any;
    expect(mia).toBeTruthy();
    expect(mia.tieneBloqueada).toBe(false);
  });

  it("marcar lo exportado la saca del listado: no se factura dos veces", async () => {
    const id = await crearAsistencia();
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 76 });

    const antes = await repo.lineasFacturables(periodo(AGOSTO), "sale");
    expect(antes.some((l) => l.assistanceId === id)).toBe(true);

    await repo.marcarExportadas(centroId, "sale",
      [{ id, importe: "331.0000", currency: "EUR" }], { referencia: "F-2026-001" });

    const despues = await repo.lineasFacturables(periodo(AGOSTO), "sale");
    expect(despues.some((l) => l.assistanceId === id)).toBe(false);

    // Pero por el lado de compra sigue pendiente: son dos documentos distintos
    const compra = await repo.lineasFacturables(periodo(AGOSTO), "purchase");
    expect(compra.some((l) => l.assistanceId === id)).toBe(true);
  });

  it("marcar dos veces no duplica la marca", async () => {
    const id = await crearAsistencia();
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 76 });

    const primera = await repo.marcarExportadas(centroId, "sale", [{ id, importe: "331.0000", currency: "EUR" }]);
    const segunda = await repo.marcarExportadas(centroId, "sale", [{ id, importe: "999.0000", currency: "EUR" }]);
    expect(primera).toBe(1);
    expect(segunda).toBe(0);

    const filas = await db.query(
      `SELECT amount FROM connect_billing_marks WHERE "assistanceId" = $1 AND side = 'sale'`, [id]);
    expect(filas.rowCount).toBe(1);
    // Y manda la primera: la segunda no pisa el importe ya emitido
    expect(Number(filas.rows[0].amount)).toBe(331);
  });

  it("se puede deshacer si el ERP la rechaza", async () => {
    const id = await crearAsistencia();
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 76 });
    await repo.marcarExportadas(centroId, "sale", [{ id, importe: "331.0000", currency: "EUR" }]);

    expect(await repo.desmarcarExportada(centroId, id, "sale")).toBe(true);
    const filas = await repo.lineasFacturables(periodo(AGOSTO), "sale");
    expect(filas.some((l) => l.assistanceId === id)).toBe(true);

    // Y el de otro centro no puede deshacer la marca de este
    await repo.marcarExportadas(centroId, "sale", [{ id, importe: "331.0000", currency: "EUR" }]);
    expect(await repo.desmarcarExportada(otroCentroId, id, "sale")).toBe(false);
  });

  it("con incluirExportadas se vuelven a ver, para poder revisar un lote", async () => {
    const id = await crearAsistencia();
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 76 });
    await repo.marcarExportadas(centroId, "sale", [{ id, importe: "331.0000", currency: "EUR" }]);

    const filas = await repo.lineasFacturables(
      { ...periodo(AGOSTO), incluirExportadas: true }, "sale");
    const mia = filas.find((l) => l.assistanceId === id);
    expect(mia).toBeTruthy();
    expect(mia!.exportedAtMs).toBeGreaterThan(0);
  });

  it("el periodo va por la orden de salida, no por cuándo se cerró", async () => {
    /*
     * Un servicio pedido el 31 y cerrado el 2 se factura en el mes en que se
     * pidió: es el instante que fijó el forfait y el que va a reclamar el
     * cliente.
     */
    const id = await crearAsistencia({ ordenSalidaMs: Date.parse("2026-07-31T23:30:00+02:00") });
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 76 });

    const agosto = await repo.lineasFacturables(periodo(AGOSTO), "sale");
    expect(agosto.some((l) => l.assistanceId === id)).toBe(false);

    const julio = await repo.lineasFacturables(periodo(JULIO), "sale");
    expect(julio.some((l) => l.assistanceId === id)).toBe(true);
  });

  it("cada centro factura lo suyo y no ve lo del otro", async () => {
    const id = await crearAsistencia();
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 76 });

    const ajenas = await repo.lineasFacturables(periodo(AGOSTO, otroCentroId), "sale");
    expect(ajenas.some((l) => l.assistanceId === id)).toBe(false);

    const pendientesAjenos = await repo.pendientesDeCierre(periodo(AGOSTO, otroCentroId));
    expect(pendientesAjenos.some((x: any) => x.id === id)).toBe(false);
  });

  it("una anulación con salida también se factura: el 50 % del forfait", async () => {
    const id = await crearAsistencia({ estado: "cancelled" });
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { cancelado: true });

    const filas = (await repo.lineasFacturables(periodo(AGOSTO), "sale"))
      .filter((l) => l.assistanceId === id);
    expect(filas.map((l) => l.kind)).toEqual(["CANCELLATION"]);
    expect(agruparEnDocumentos(filas, "sale")[0].baseImponible).toBe("165.50");
  });
});
