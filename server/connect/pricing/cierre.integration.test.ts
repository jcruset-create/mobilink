/**
 * El cierre de la tarifa, manual y automático, contra PostgreSQL.
 *
 * Dos cosas se fijan aquí:
 *
 *  1. Que el cierre **cobra los kilómetros de más**. Hasta ahora el botón
 *     mandaba la petición vacía y el cierre producía solo el forfait: en un
 *     tarifario que incluye 100 km, cada servicio que se pasaba se facturaba
 *     de menos y nadie lo veía.
 *  2. Que el cierre automático **no se enciende solo** y que, cuando se
 *     enciende, respeta la espera. La etapa de cierre es irreversible.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026_COMPRA, SEAS_2026_VENTA } from "./tarifarios/seas2026.ts";
import { formatear } from "./money.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let bloquear: typeof import("./service.ts").bloquear;
let finalizar: typeof import("./service.ts").finalizar;
let ca: typeof import("./cierreAutomatico.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const VIERNES_NOCHE = Date.parse("2026-08-14T22:17:00+02:00");

let centroId = 0;
let clienteId = 0;
let empresaId = 0;
let tallerId = 0;
let partnerId = 0;

/**
 * Asistencia terminada, con lo que el taller dejó anotado al cerrar y con su
 * transición registrada en el historial: la espera se mide desde ahí y no
 * desde `updatedAtMs`, que lo reescribe cualquier cambio.
 */
async function terminada(p: {
  odometerKm?: number | null; workedMinutes?: number | null;
  terminadaHaceMin?: number; estado?: string;
} = {}): Promise<number> {
  const uuid = String(process.hrtime.bigint()).slice(-9);
  const r = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "controlCenterId", "clientId", "workshopId", status,
        "serviceType", vehicle, "serviceOrderedAtMs", "odometerKm", "workedMinutes",
        "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,'tyres',$7,$8,$9,$10,$11,$12) RETURNING id`,
    [`cierre-${uuid}`, partnerId, centroId, clienteId, tallerId, p.estado ?? "finished",
     JSON.stringify({ type: "truck" }), VIERNES_NOCHE,
     p.odometerKm ?? null, p.workedMinutes ?? null, now,
     Date.now() - (p.terminadaHaceMin ?? 0) * 60_000],
  );
  const id = Number(r.rows[0].id);

  await db.query(
    `INSERT INTO connect_status_history ("assistanceId", "fromStatus", "toStatus", "occurredAtMs")
     VALUES ($1,'in_progress',$2,$3)`,
    [id, p.estado ?? "finished", Date.now() - (p.terminadaHaceMin ?? 0) * 60_000]);

  return id;
}

describe.skipIf(!RUN)("Cierre de la tarifa", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    ({ bloquear, finalizar } = await import("./service.ts"));
    ca = await import("./cierreAutomatico.ts");
    const { cargarTarifario, publicarVersion } = await import("./tarifario.ts");

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`cc-ci-${sufijo}`, `Central ${sufijo}`, now]);
    centroId = Number(cc.rows[0].id);

    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`, [`pa-ci-${sufijo}`, `Partner ${sufijo}`, centroId, now]);
    partnerId = Number(p.rows[0].id);

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centroId, `Cliente ${sufijo}`, now]);
    clienteId = Number(cl.rows[0].id);

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`pr-ci-${sufijo}`, `Proveedora ${sufijo}`, now]);
    empresaId = Number(em.rows[0].id);

    const w = await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", "createdAtMs", "updatedAtMs")
       VALUES ($1,41.1,1.2,$2,$3,$3) RETURNING id`, [`Taller ${sufijo}`, empresaId, now]);
    tallerId = Number(w.rows[0].id);

    const v = await cargarTarifario(centroId, { ...SEAS_2026_VENTA, code: `CIV_${sufijo}` });
    const c = await cargarTarifario(centroId, { ...SEAS_2026_COMPRA, code: `CIC_${sufijo}` });
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
    for (const sql of [
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
    ]) await db.query(sql, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_workshops WHERE id = $1`, [tallerId]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [empresaId]).catch(() => {});
  }, 30_000);

  // ── El cierre cobra lo que el taller anotó ───────────────────────────────

  it("cerrar sin pasar nada usa los kilómetros que dejó el taller", async () => {
    /*
     * Este es el fallo que había: el botón manda la petición vacía y el cierre
     * salía solo con el forfait. Con 125 km sobre 100 incluidos son 25 km a
     * 1,25 € que no se estaban cobrando.
     */
    const id = await terminada({ odometerKm: 125, workedMinutes: 200 });
    await bloquear(id, { distanceKm: 76 });

    const r = await finalizar(id);
    expect(r!.lineas.map((l) => l.tipo)).toEqual(["FORFAIT", "EXTRA_KM"]);
    expect(formatear(r!.ventaTotal!)).toBe("362.25");   // 331 + 25 × 1,25
    expect(formatear(r!.compraTotal!)).toBe("302.50");  // 275 + 25 × 1,10
  });

  it("lo que se pasa a mano manda sobre lo que anotó el taller", async () => {
    const id = await terminada({ odometerKm: 125 });
    await bloquear(id, { distanceKm: 76 });

    const r = await finalizar(id, { distanceKm: 100 });
    // 100 km es justo lo incluido: no hay suplemento
    expect(r!.lineas.map((l) => l.tipo)).toEqual(["FORFAIT"]);
  });

  it("sin kilómetros anotados el cierre sale solo con el forfait, como antes", async () => {
    const id = await terminada({});
    await bloquear(id, { distanceKm: 76 });

    const r = await finalizar(id);
    expect(r!.lineas.map((l) => l.tipo)).toEqual(["FORFAIT"]);
    expect(formatear(r!.ventaTotal!)).toBe("331.00");
  });

  it("una lectura de cuentakilómetros NO se cobra como distancia", async () => {
    /*
     * El campo se llama odometerKm y en la app del taller solo pone
     * "Kilómetros". Si alguien anota ahí los 234.567 del cuentakilómetros, a
     * 1,25 €/km serían casi trescientos mil euros en una factura.
     *
     * Cobrar de menos se arregla; emitir esa factura, no.
     */
    const id = await terminada({ odometerKm: 234_567 });
    await bloquear(id, { distanceKm: 76 });

    const r = await finalizar(id);
    expect(r!.lineas.map((l) => l.tipo)).toEqual(["FORFAIT"]);
    expect(formatear(r!.ventaTotal!)).toBe("331.00");
  });

  it("2.000 km pasan y 2.001 no: el corte está donde dice", async () => {
    const a = await terminada({ odometerKm: 2000 });
    await bloquear(a, { distanceKm: 76 });
    expect((await finalizar(a))!.lineas.some((l) => l.tipo === "EXTRA_KM")).toBe(true);

    const b = await terminada({ odometerKm: 2001 });
    await bloquear(b, { distanceKm: 76 });
    expect((await finalizar(b))!.lineas.some((l) => l.tipo === "EXTRA_KM")).toBe(false);
  });

  // ── El cierre automático ─────────────────────────────────────────────────

  it("de fábrica NO cierra nada: el interruptor está apagado", async () => {
    const id = await terminada({ odometerKm: 125, terminadaHaceMin: 60 * 48 });
    await bloquear(id, { distanceKm: 76 });

    const r = await ca.pasadaDeCierreAutomatico();
    expect(r.centros).toBe(0);

    const filas = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_pricings
        WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
    expect(filas.rows[0].n).toBe(0);
  });

  it("encendido con espera, respeta la espera", async () => {
    await ca.guardarAjustesCierre(centroId, { activo: true, esperaMin: 24 * 60 });

    const reciente = await terminada({ odometerKm: 125, terminadaHaceMin: 60 });      // 1 h
    const vieja = await terminada({ odometerKm: 125, terminadaHaceMin: 60 * 30 });    // 30 h
    await bloquear(reciente, { distanceKm: 76 });
    await bloquear(vieja, { distanceKm: 76 });

    await ca.pasadaDeCierreAutomatico();

    const cerrada = async (id: number) => {
      const f = await db.query(
        `SELECT COUNT(*)::int AS n FROM connect_assistance_pricings
          WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
      return f.rows[0].n === 1;
    };
    expect(await cerrada(vieja)).toBe(true);
    expect(await cerrada(reciente)).toBe(false);

    await ca.guardarAjustesCierre(centroId, { activo: false, esperaMin: 24 * 60 });
  });

  it("al cerrar solo también cobra los kilómetros del taller", async () => {
    await ca.guardarAjustesCierre(centroId, { activo: true, esperaMin: 0 });
    const id = await terminada({ odometerKm: 125, terminadaHaceMin: 5 });
    await bloquear(id, { distanceKm: 76 });

    await ca.pasadaDeCierreAutomatico();

    const f = await db.query(
      `SELECT "saleTotal" FROM connect_assistance_pricings
        WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
    expect(Number(f.rows[0].saleTotal)).toBe(362.25);

    await ca.guardarAjustesCierre(centroId, { activo: false, esperaMin: 24 * 60 });
  });

  it("no cierra lo que no tiene forfait comprometido", async () => {
    /*
     * Sin forfait comprometido no hay nada que regularizar, y cerrar ahí
     * produciría una tarifa desde cero con la configuración de hoy en lugar de
     * con la que se pactó. Se quedan para que las mire una persona.
     */
    await ca.guardarAjustesCierre(centroId, { activo: true, esperaMin: 0 });
    const id = await terminada({ terminadaHaceMin: 60 });   // sin bloquear()

    await ca.pasadaDeCierreAutomatico();

    const f = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_pricings WHERE "assistanceId" = $1`, [id]);
    expect(f.rows[0].n).toBe(0);

    await ca.guardarAjustesCierre(centroId, { activo: false, esperaMin: 24 * 60 });
  });

  it("pasar dos veces no cierra dos veces", async () => {
    await ca.guardarAjustesCierre(centroId, { activo: true, esperaMin: 0 });
    const id = await terminada({ odometerKm: 125, terminadaHaceMin: 5 });
    await bloquear(id, { distanceKm: 76 });

    const a = await ca.pasadaDeCierreAutomatico();
    const b = await ca.pasadaDeCierreAutomatico();
    expect(a.cerradas).toBeGreaterThanOrEqual(1);
    expect(b.detalle.some((d) => d.assistanceId === id)).toBe(false);

    await ca.guardarAjustesCierre(centroId, { activo: false, esperaMin: 24 * 60 });
  });

  it("guardar el interruptor no pisa el resto de ajustes del centro", async () => {
    await db.query(
      `UPDATE connect_control_centers SET settings = $1 WHERE id = $2`,
      [JSON.stringify({ pais: "ES", pricing: { limiteAjusteSupervisor: 400 } }), centroId]);

    await ca.guardarAjustesCierre(centroId, { activo: true, esperaMin: 120 });

    const r = await db.query(`SELECT settings FROM connect_control_centers WHERE id = $1`, [centroId]);
    const s = typeof r.rows[0].settings === "string" ? JSON.parse(r.rows[0].settings) : r.rows[0].settings;
    expect(s.pais).toBe("ES");
    expect(s.pricing.limiteAjusteSupervisor).toBe(400);
    expect(s.pricing.cierreAutomatico).toBe(true);
    expect(s.pricing.cierreAutomaticoEsperaMin).toBe(120);

    await db.query(`UPDATE connect_control_centers SET settings = '{}' WHERE id = $1`, [centroId]);
  });

  it("la simulación cuenta sin cerrar nada", async () => {
    const id = await terminada({ odometerKm: 125, terminadaHaceMin: 60 * 30 });
    await bloquear(id, { distanceKm: 76 });

    const antes = await ca.simularCierre(centroId, 24 * 60);
    expect(antes.cerrariaAhora).toBeGreaterThanOrEqual(1);

    const f = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistance_pricings
        WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
    expect(f.rows[0].n).toBe(0);

    // Con una espera mayor, esa misma todavía no entraría
    const conMas = await ca.simularCierre(centroId, 60 * 24 * 7);
    expect(conMas.cerrariaAhora).toBeLessThanOrEqual(antes.cerrariaAhora);
  });
});
