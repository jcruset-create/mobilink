/**
 * Las tres etapas contra PostgreSQL: estimación, bloqueo y cierre.
 *
 * Aquí se cierra el último hueco de la batería del §56: la idempotencia a
 * nivel de servicio. No es un detalle técnico. La orden de salida puede
 * dispararse dos veces —un doble clic, un reintento de la API, dos instancias
 * procesando el mismo evento— y dos forfaits distintos para el mismo servicio
 * serían un problema contractual, no un fallo de programación.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026 } from "./tarifarios/seas2026.ts";
import { formatear } from "./money.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let estimar: typeof import("./service.ts").estimar;
let bloquear: typeof import("./service.ts").bloquear;
let finalizar: typeof import("./service.ts").finalizar;
let etapasDe: typeof import("./service.ts").etapasDe;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const VIERNES_NOCHE = Date.parse("2026-08-14T22:17:00+02:00");

let centroId = 0;
let clienteId = 0;
let empresaId = 0;
let tallerId = 0;
let partnerId = 0;

/** Asistencia nueva con la orden de salida ya dada a la hora que se pida. */
async function crearAsistencia(ordenSalidaMs: number | null): Promise<number> {
  const id = String(process.hrtime.bigint()).slice(-9);
  const r = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "controlCenterId", "clientId", "workshopId", status,
        "serviceType", vehicle, "serviceOrderedAtMs", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,'assigned','tyres',$6,$7,$8,$8) RETURNING id`,
    [`etapas-${id}`, partnerId, centroId, clienteId, tallerId,
     JSON.stringify({ type: "truck", plate: "1234ABC" }), ordenSalidaMs, now],
  );
  return r.rows[0].id;
}

describe.skipIf(!RUN)("Etapas de tarificación", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    ({ estimar, bloquear, finalizar, etapasDe } = await import("./service.ts"));
    const { cargarTarifario, publicarVersion } = await import("./tarifario.ts");

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`cc-et-${sufijo}`, `Central ${sufijo}`, now]);
    centroId = cc.rows[0].id;

    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`, [`pa-et-${sufijo}`, `Partner ${sufijo}`, centroId, now]);
    partnerId = p.rows[0].id;

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centroId, `Cliente ${sufijo}`, now]);
    clienteId = cl.rows[0].id;

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`pr-et-${sufijo}`, `Proveedora ${sufijo}`, now]);
    empresaId = em.rows[0].id;

    const w = await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", "createdAtMs", "updatedAtMs")
       VALUES ($1,41.1,1.2,$2,$3,$3) RETURNING id`, [`Taller ${sufijo}`, empresaId, now]);
    tallerId = w.rows[0].id;

    const r = await cargarTarifario(centroId, { ...SEAS_2026, code: `ET_${sufijo}` });
    await publicarVersion(r.tariffVersionId, null);

    for (const [role, columna, valor] of [
      ["sale", '"clientId"', clienteId],
      ["purchase", '"providerCompanyId"', empresaId],
    ] as const) {
      await db.query(
        `INSERT INTO connect_contracts
           ("controlCenterId", role, ${columna}, "tariffPlanId", name, status,
            "validFromMs", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$7)`,
        [centroId, role, valor, r.tariffPlanId, `Contrato ${role}`,
         Date.parse("2026-01-01T00:00:00Z"), now],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    await db.query(`DELETE FROM connect_assistances WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_contracts WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tariff_plans WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_calendars WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tariff_time_bands WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tariff_zones WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tire_brands WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tire_sizes WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_partners WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_clients WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_workshops WHERE id = $1`, [tallerId]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [empresaId]).catch(() => {});
    await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [centroId]).catch(() => {});
  }, 30_000);

  it("la estimación no guarda nada", async () => {
    const id = await crearAsistencia(VIERNES_NOCHE);
    const r = await estimar(id, { distanceKm: 76 });
    expect(formatear(r!.ventaTotal!)).toBe("331.00");
    const filas = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_pricings WHERE "assistanceId" = $1`, [id]);
    expect(filas.rows[0].n).toBe(0);
  });

  it("bloquear dos veces devuelve el mismo forfait y no crea dos filas", async () => {
    // Un doble clic no puede producir dos precios para el mismo servicio
    const id = await crearAsistencia(VIERNES_NOCHE);
    const a = await bloquear(id, { distanceKm: 76 });
    const b = await bloquear(id, { distanceKm: 999 });   // otra distancia a propósito
    expect(formatear(a!.ventaTotal!)).toBe("331.00");
    expect(formatear(b!.ventaTotal!)).toBe("331.00");

    const filas = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_pricings
        WHERE "assistanceId" = $1 AND stage = 'locked'`, [id]);
    expect(filas.rows[0].n).toBe(1);
  });

  it("dos bloqueos a la vez tampoco: gana uno y el otro se encuentra el suyo", async () => {
    // El caso de dos instancias procesando el mismo evento
    const id = await crearAsistencia(VIERNES_NOCHE);
    const [a, b] = await Promise.all([
      bloquear(id, { distanceKm: 76 }),
      bloquear(id, { distanceKm: 76 }),
    ]);
    expect(formatear(a!.ventaTotal!)).toBe("331.00");
    expect(formatear(b!.ventaTotal!)).toBe("331.00");
    const filas = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_pricings
        WHERE "assistanceId" = $1 AND stage = 'locked'`, [id]);
    expect(filas.rows[0].n).toBe(1);
  });

  it("el bloqueo registra el instante contractual si no estaba", async () => {
    const id = await crearAsistencia(null);
    await bloquear(id, { distanceKm: 76 });
    const r = await db.query(
      `SELECT "serviceOrderedAtMs" FROM connect_assistances WHERE id = $1`, [id]);
    expect(Number(r.rows[0].serviceOrderedAtMs)).toBeGreaterThan(0);
  });

  it("el cierre mantiene la tarifa bloqueada aunque se cierre otro día", async () => {
    const id = await crearAsistencia(VIERNES_NOCHE);
    await bloquear(id, { distanceKm: 76 });
    // Se cierra el sábado por la mañana, con más kilómetros
    const f = await finalizar(id, { distanceKm: 125, durationMin: 200 });
    expect(f!.venta?.regla?.code).toBe("NOCTURNO");
    // Forfait 331 + 25 km de más a 1,25
    expect(formatear(f!.ventaTotal!)).toBe("362.25");
    expect(f!.lineas.map((l) => l.tipo)).toEqual(["FORFAIT", "EXTRA_KM"]);
  });

  it("finalizar dos veces tampoco duplica", async () => {
    const id = await crearAsistencia(VIERNES_NOCHE);
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 125 });
    const segunda = await finalizar(id, { distanceKm: 500 });
    expect(formatear(segunda!.ventaTotal!)).toBe("362.25");
    const filas = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_pricings
        WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
    expect(filas.rows[0].n).toBe(1);
  });

  it("las etapas conviven: se ve qué se comprometió y qué se cobró", async () => {
    const id = await crearAsistencia(VIERNES_NOCHE);
    await bloquear(id, { distanceKm: 76 });
    await finalizar(id, { distanceKm: 125 });
    const etapas = await etapasDe(id);
    expect(etapas.map((e: any) => e.stage)).toEqual(["locked", "final"]);
    expect(String((etapas[0] as any).saleTotal)).toContain("331");
    expect(String((etapas[1] as any).saleTotal)).toContain("362.25");
    // Y el cierre trae sus líneas
    expect((etapas[1] as any).lines).toHaveLength(2);
  });

  it("el coste de la ficha se rellena solo, sin tocar la facturación actual", async () => {
    const id = await crearAsistencia(VIERNES_NOCHE);
    await bloquear(id, { distanceKm: 76 });
    const antes = await db.query(
      `SELECT "estimatedCost", "costDetail" FROM connect_assistances WHERE id = $1`, [id]);
    expect(Number(antes.rows[0].estimatedCost)).toBe(331);
    expect(antes.rows[0].costDetail).toContain("Nocturno");

    await finalizar(id, { distanceKm: 125 });
    const despues = await db.query(`SELECT "finalCost" FROM connect_assistances WHERE id = $1`, [id]);
    expect(Number(despues.rows[0].finalCost)).toBe(362.25);
  });

  it("la explicación se reconstruye del snapshot, no del tarifario de hoy", async () => {
    const id = await crearAsistencia(VIERNES_NOCHE);
    await bloquear(id, { distanceKm: 76 });

    // Se archiva la versión: el tarifario de hoy ya no sirve para explicarla
    await db.query(
      `UPDATE connect_tariff_versions SET status = 'archived'
        WHERE "controlCenterId" = $1`, [centroId]);

    const { leerEtapa } = await import("./service.ts");
    const r = await leerEtapa(id, "locked");
    expect(r!.explicacion.regla).toBe("Nocturno");
    expect(r!.explicacion.horaLocal).toBe("22:17");
    expect(formatear(r!.ventaTotal!)).toBe("331.00");

    // Se deja como estaba para no afectar a las demás pruebas del fichero
    await db.query(
      `UPDATE connect_tariff_versions SET status = 'published'
        WHERE "controlCenterId" = $1`, [centroId]);
  });

  it("sin contrato de compra la venta sale igual y el margen queda indeterminado", async () => {
    await db.query(
      `UPDATE connect_contracts SET status = 'ended' WHERE "controlCenterId" = $1 AND role = 'purchase'`,
      [centroId]);
    const id = await crearAsistencia(VIERNES_NOCHE);
    const r = await bloquear(id, { distanceKm: 76 });
    expect(formatear(r!.ventaTotal!)).toBe("331.00");
    expect(r!.compraTotal).toBeNull();
    expect(r!.margen).toBeNull();
    await db.query(
      `UPDATE connect_contracts SET status = 'active' WHERE "controlCenterId" = $1 AND role = 'purchase'`,
      [centroId]);
  });
});
