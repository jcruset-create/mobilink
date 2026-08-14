/**
 * SEAS 2026 cargado como datos, leído de la base y calculado por el motor.
 *
 * Esto es lo que cierra la fase: no basta con que el motor sepa calcular ni
 * con que el fichero de datos exista. Hay que comprobar que el tarifario se
 * carga en PostgreSQL, se vuelve a leer y produce los importes esperados, con
 * las reglas resolviéndose desde las filas reales y no desde constantes de
 * una prueba.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026 } from "./tarifarios/seas2026.ts";
import { formatear } from "./money.ts";
import type { ContextoTarifa } from "./types.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let cargarTarifario: typeof import("./tarifario.ts").cargarTarifario;
let publicarVersion: typeof import("./tarifario.ts").publicarVersion;
let cargarConfiguracion: typeof import("./repository.ts").cargarConfiguracion;
let calcularTarifa: typeof import("./engine.ts").calcularTarifa;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centroId = 0;
let clienteId = 0;
let empresaId = 0;
let versionId = 0;

/** Tarifica un instante concreto con lo que hay cargado en la base. */
async function tarifar(p: {
  atMs: number; distanceKm?: number | null; durationMin?: number | null;
  conceptos?: ContextoTarifa["conceptos"]; municipio?: string; etapa?: "estimate" | "locked" | "final";
  cancelado?: boolean;
}) {
  const { configuracion, timezone } = await cargarConfiguracion({
    controlCenterId: centroId,
    clientId: clienteId,
    providerCompanyId: empresaId,
    workshopId: null,
    atMs: p.atMs,
    lugar: { country: "ES" },
  });
  const zoneIds = (configuracion as any).zoneIds ?? [];

  const ctx: ContextoTarifa = {
    assistanceId: 1, controlCenterId: centroId, clientId: clienteId,
    workshopId: null, providerCompanyId: empresaId,
    serviceTypeCode: "tyres", vehicleTypeCode: "truck",
    atMs: p.atMs, timezone,
    lugar: { municipality: p.municipio ?? "Tarragona" },
    zoneIds,
    distanceKm: p.distanceKm ?? 76,
    distanceSource: "routed",
    durationMin: p.durationMin ?? null,
    conceptos: p.conceptos,
    cancelado: p.cancelado,
  };
  return calcularTarifa(ctx, configuracion, {
    etapa: p.etapa ?? "locked",
    pricingRequestId: `test-${sufijo}`,
  });
}

describe.skipIf(!RUN)("SEAS 2026 cargado desde la base", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    ({ cargarTarifario, publicarVersion } = await import("./tarifario.ts"));
    ({ cargarConfiguracion } = await import("./repository.ts"));
    ({ calcularTarifa } = await import("./engine.ts"));

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`cc-seas-${sufijo}`, `Central SEAS ${sufijo}`, now],
    );
    centroId = cc.rows[0].id;

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [centroId, `Cliente de SEAS ${sufijo}`, now],
    );
    clienteId = cl.rows[0].id;

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`prov-seas-${sufijo}`, `Taller colaborador ${sufijo}`, now],
    );
    empresaId = em.rows[0].id;

    // Se carga el tarifario con un código propio de la prueba para no chocar
    // con el que pueda existir ya en la base.
    const r = await cargarTarifario(centroId, { ...SEAS_2026, code: `SEAS_${sufijo}` });
    versionId = r.tariffVersionId;

    /*
     * Los dos contratos apuntan a la MISMA versión: la central compra al
     * taller y vende a su cliente con el mismo tarifario. Es el caso real.
     */
    for (const [role, columna, valor] of [
      ["sale", '"clientId"', clienteId],
      ["purchase", '"providerCompanyId"', empresaId],
    ] as const) {
      await db.query(
        `INSERT INTO connect_contracts
           ("controlCenterId", role, ${columna}, "tariffPlanId", name, status,
            "validFromMs", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$7)`,
        [centroId, role, valor, r.tariffPlanId, `Contrato ${role}`, Date.parse("2026-01-01T00:00:00Z"), now],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    await db.query(`DELETE FROM connect_contracts WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tariff_plans WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_calendars WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tariff_time_bands WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tariff_zones WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tire_brands WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_tire_sizes WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_clients WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [empresaId]).catch(() => {});
    await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [centroId]).catch(() => {});
  }, 30_000);

  it("un tarifario recién cargado no factura: nace como borrador", async () => {
    // Un fichero de datos que se convierte solo en tarifa activa es
    // exactamente lo que no se quiere.
    const v = await db.query(`SELECT status FROM connect_tariff_versions WHERE id = $1`, [versionId]);
    expect(v.rows[0].status).toBe("draft");

    const r = await tarifar({ atMs: Date.parse("2026-08-14T22:17:00+02:00") });
    expect(r.ventaTotal).toBeNull();
    expect(r.avisos.map((a) => a.codigo)).toContain("SALE_TARIFF_NOT_FOUND");
  });

  it("publicarlo es un acto aparte y deliberado", async () => {
    expect(await publicarVersion(versionId, null)).toBe(true);
    // Y solo se puede publicar una vez
    expect(await publicarVersion(versionId, null)).toBe(false);
  });

  it("volver a cargar el tarifario no toca una versión publicada", async () => {
    // Si la tocara, cambiaría el precio de asistencias ya facturadas con ella
    const r = await cargarTarifario(centroId, { ...SEAS_2026, code: `SEAS_${sufijo}` });
    expect(r.status).toBe("published");
    expect(r.tariffVersionId).toBe(versionId);
    const reglas = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_tariff_rules WHERE "tariffVersionId" = $1`, [versionId]);
    expect(reglas.rows[0].n).toBe(SEAS_2026.reglas.length);
  });

  it("viernes 22:17: nocturno a 331 €, leído de la base", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-08-14T22:17:00+02:00") });
    expect(r.venta?.regla?.code).toBe("NOCTURNO");
    expect(formatear(r.ventaTotal!)).toBe("331.00");
    expect(r.explicacion.tarifario).toBe("SEAS Nacional");
    expect(r.explicacion.version).toBe("2026");
    expect(r.explicacion.zona).toBe("España");
  });

  it("la central compra y vende con el mismo tarifario: margen cero", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-08-14T22:17:00+02:00") });
    expect(formatear(r.compraTotal!)).toBe("331.00");
    expect(formatear(r.margen!)).toBe("0.00");
  });

  it("martes a 22 km: proximidad a 110 €", async () => {
    const r = await tarifar({
      atMs: Date.parse("2026-08-11T10:30:00+02:00"), distanceKm: 22, durationMin: 60,
    });
    expect(r.venta?.regla?.code).toBe("DIURNO_PROX");
    expect(formatear(r.ventaTotal!)).toBe("110.00");
  });

  it("martes a 76 km: diurno a 198 €", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-08-11T10:30:00+02:00"), distanceKm: 76 });
    expect(r.venta?.regla?.code).toBe("DIURNO");
    expect(formatear(r.ventaTotal!)).toBe("198.00");
  });

  it("festivo nacional a las 10:00: festivo a 331 €, no diurno", async () => {
    // 15 de agosto de 2026, Asunción
    const r = await tarifar({ atMs: Date.parse("2026-08-15T10:00:00+02:00") });
    expect(r.venta?.regla?.code).toBe("FESTIVO");
    expect(formatear(r.ventaTotal!)).toBe("331.00");
  });

  it("Navidad a las 22:00: festivos extra a 424 €, no nocturno", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-12-25T22:00:00+01:00") });
    expect(r.venta?.regla?.code).toBe("FESTIVO_EXTRA");
    expect(formatear(r.ventaTotal!)).toBe("424.00");
    expect(r.explicacion.tipoDia).toBe("Navidad (día especial)");
  });

  it("el ejemplo completo del encargo cuadra con los datos cargados", async () => {
    // Forfait 331 + 25 km de más a 1,25 + neumático 485,49 + adicional 60
    const r = await tarifar({
      atMs: Date.parse("2026-08-14T22:17:00+02:00"),
      distanceKm: 125,
      etapa: "final",
      conceptos: [
        { tipo: "TIRE", neumatico: { medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER" } },
        { tipo: "ADDITIONAL_TIRE", extraCode: "ADDITIONAL_TIRE", cantidad: 1 },
      ],
    });
    expect(r.lineas.map((l) => l.tipo)).toEqual(["FORFAIT", "EXTRA_KM", "TIRE", "ADDITIONAL_TIRE"]);
    expect(formatear(r.ventaTotal!)).toBe("907.74");
  });

  it("115 km con 100 incluidos no llegan al 20 %: no hay suplemento", async () => {
    const r = await tarifar({
      atMs: Date.parse("2026-08-14T22:17:00+02:00"), distanceKm: 115, etapa: "final",
    });
    expect(r.lineas.map((l) => l.tipo)).toEqual(["FORFAIT"]);
  });

  it("una anulación con salida cobra el 50 %", async () => {
    const r = await tarifar({
      atMs: Date.parse("2026-08-14T22:17:00+02:00"), etapa: "final", cancelado: true,
    });
    expect(formatear(r.ventaTotal!)).toBe("165.50");
  });

  it("un servicio de 2025 no encuentra tarifa: el de 2026 no vale para atrás", async () => {
    const r = await tarifar({ atMs: Date.parse("2025-08-14T22:17:00+02:00") });
    expect(r.ventaTotal).toBeNull();
    expect(r.estado).toBe("manual_review");
  });

  it("en el código del motor no aparece ningún cliente por su nombre", async () => {
    // El criterio de éxito nº 1: SEAS solo existe en su fichero de datos.
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = new URL(".", import.meta.url).pathname;
    const ficheros = (await readdir(dir)).filter((f) => f.endsWith(".ts") && !f.includes("test"));
    const culpables: string[] = [];
    for (const f of ficheros) {
      const contenido = await readFile(`${dir}${f}`, "utf8");
      if (/\bSEAS\b/i.test(contenido)) culpables.push(f);
    }
    expect(culpables).toEqual([]);
  });
});
