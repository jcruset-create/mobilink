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
import { SEAS_2026_COMPRA, SEAS_2026_VENTA } from "./tarifarios/seas2026.ts";
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
let versionCompraId = 0;
let partnerId = 0;

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

    // Hace falta para poder crear asistencias de verdad en las pruebas de abajo
    const pa = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`,
      [`pa-seas-${sufijo}`, `Partner ${sufijo}`, centroId, now]);
    partnerId = Number(pa.rows[0].id);

    /*
     * Los dos tarifarios del documento: la tabla de venta y la de compra. No
     * coinciden, y por eso son dos planes. Se cargan con un código propio de
     * la prueba para no chocar con lo que pueda existir ya en la base.
     */
    const v = await cargarTarifario(centroId, { ...SEAS_2026_VENTA, code: `SEASV_${sufijo}` });
    const c = await cargarTarifario(centroId, { ...SEAS_2026_COMPRA, code: `SEASC_${sufijo}` });
    versionId = v.tariffVersionId;
    versionCompraId = c.tariffVersionId;

    // Cada contrato a su lado: el de venta al tarifario de venta y el de
    // compra al de compra.
    for (const [role, columna, valor, planId] of [
      ["sale", '"clientId"', clienteId, v.tariffPlanId],
      ["purchase", '"providerCompanyId"', empresaId, c.tariffPlanId],
    ] as const) {
      await db.query(
        `INSERT INTO connect_contracts
           ("controlCenterId", role, ${columna}, "tariffPlanId", name, status,
            "validFromMs", "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,'active',$6,$7,$7)`,
        [centroId, role, valor, planId, `Contrato ${role}`, Date.parse("2026-01-01T00:00:00Z"), now],
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    await db.query(`DELETE FROM connect_workshop_holidays WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_assistances WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_partners WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
    await db.query(`DELETE FROM connect_provider_authorizations WHERE "controlCenterId" = $1`, [centroId]).catch(() => {});
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
    expect(await publicarVersion(versionCompraId, null)).toBe(true);
    // Y solo se puede publicar una vez
    expect(await publicarVersion(versionId, null)).toBe(false);
  });

  it("volver a cargar el tarifario no toca una versión publicada", async () => {
    // Si la tocara, cambiaría el precio de asistencias ya facturadas con ella
    const r = await cargarTarifario(centroId, { ...SEAS_2026_VENTA, code: `SEASV_${sufijo}` });
    expect(r.status).toBe("published");
    expect(r.tariffVersionId).toBe(versionId);
    const reglas = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_tariff_rules WHERE "tariffVersionId" = $1`, [versionId]);
    expect(reglas.rows[0].n).toBe(SEAS_2026_VENTA.reglas.length);
  });

  it("viernes 22:17 es fin de semana, no nocturno: la ventana empieza el viernes a las 19:00", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-08-14T22:17:00+02:00") });
    expect(r.venta?.regla?.code).toBe("FESTIVO_ENTRADA");
    expect(formatear(r.ventaTotal!)).toBe("331.00");
    expect(r.explicacion.tarifario).toBe("SEAS Nacional (venta)");
    expect(r.explicacion.version).toBe("2026");
    expect(r.explicacion.zona).toBe("España");
  });

  it("jueves 22:00 sí es nocturno", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-08-13T22:00:00+02:00") });
    expect(r.venta?.regla?.code).toBe("NOCTURNO");
    expect(formatear(r.ventaTotal!)).toBe("331.00");
  });

  it("lunes a las 03:00 sigue siendo fin de semana: la ventana acaba a las 08:00", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-08-17T03:00:00+02:00") });
    expect(r.venta?.regla?.code).toBe("FESTIVO_SALIDA");
    expect(formatear(r.ventaTotal!)).toBe("331.00");
  });

  it("viernes a las 10:00 es diurno: el fin de semana no se come el día", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-08-14T10:00:00+02:00") });
    expect(r.venta?.regla?.code).toBe("DIURNO");
    expect(formatear(r.ventaTotal!)).toBe("198.00");
  });

  it("compra y venta son tarifas distintas: el margen del nocturno es 56 €", async () => {
    // Venta 331, compra 275. No coinciden, y por eso son dos planes.
    const r = await tarifar({ atMs: Date.parse("2026-08-14T22:17:00+02:00") });
    expect(formatear(r.ventaTotal!)).toBe("331.00");
    expect(formatear(r.compraTotal!)).toBe("275.00");
    expect(formatear(r.margen!)).toBe("56.00");
    expect(formatear(r.margenPct!)).toBe("16.92");
  });

  it("el diurno proximidad va invertido respecto al PDF: 125 de venta y 110 de compra", async () => {
    /*
     * El documento publica 110 de venta y 125 de compra. Se señaló como lo que
     * era —las dos columnas cambiadas en esa fila— y la dirección lo resolvió
     * invirtiéndolas. Es el único importe cargado que no coincide con el PDF.
     */
    const r = await tarifar({
      atMs: Date.parse("2026-08-11T10:30:00+02:00"), distanceKm: 22, durationMin: 60,
    });
    expect(r.venta?.regla?.code).toBe("DIURNO_PROX");
    expect(formatear(r.ventaTotal!)).toBe("125.00");
    expect(formatear(r.compraTotal!)).toBe("110.00");
    expect(formatear(r.margen!)).toBe("15.00");
  });

  it("martes a 76 km: diurno a 198 € de venta y 170 € de compra", async () => {
    const r = await tarifar({ atMs: Date.parse("2026-08-11T10:30:00+02:00"), distanceKm: 76 });
    expect(r.venta?.regla?.code).toBe("DIURNO");
    expect(formatear(r.ventaTotal!)).toBe("198.00");
    expect(formatear(r.compraTotal!)).toBe("170.00");
    expect(formatear(r.margen!)).toBe("28.00");
  });

  it("festivo nacional a las 10:00: festivo a 331 €, no diurno", async () => {
    // 15 de agosto de 2026, Asunción (y además sábado)
    const r = await tarifar({ atMs: Date.parse("2026-08-15T10:00:00+02:00") });
    expect(r.venta?.regla?.code).toBe("FESTIVO");
    expect(formatear(r.ventaTotal!)).toBe("331.00");
  });

  it("Navidad a las 22:00: festivos extra a 424 €, no fin de semana", async () => {
    // El 25 de diciembre de 2026 cae en viernes: la regla más excepcional gana
    const r = await tarifar({ atMs: Date.parse("2026-12-25T22:00:00+01:00") });
    expect(r.venta?.regla?.code).toBe("FESTIVO_EXTRA");
    expect(formatear(r.ventaTotal!)).toBe("424.00");
    expect(formatear(r.compraTotal!)).toBe("400.00");
    expect(r.explicacion.tipoDia).toBe("Navidad (día especial)");
  });

  it("el servicio completo cuadra con las dos tablas del documento", async () => {
    /*
     * Venta:  331 + 25 km × 1,25 + Bridgestone 315/70 dirección 485,49 + 60
     * Compra: 275 + 25 km × 1,10 + el mismo neumático a 460 + 50
     */
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
    expect(formatear(r.compraTotal!)).toBe("812.50");
  });

  it("un neumático de grupo se cobra por su columna, no por la de la marca", async () => {
    // Falken es 1ª Europeas: 436,17 de venta y 410 de compra en 315/70
    const r = await tarifar({
      atMs: Date.parse("2026-08-14T22:17:00+02:00"), etapa: "final", distanceKm: 76,
      conceptos: [
        { tipo: "TIRE", neumatico: { medida: "315/70R22.5", marca: "Falken", posicion: "STEER" } },
      ],
    });
    const linea = r.lineas.find((l) => l.tipo === "TIRE")!;
    expect(formatear(linea.ventaTotal!)).toBe("436.17");
    expect(formatear(linea.compraTotal!)).toBe("410.00");
  });

  it("una celda vacía del documento no se carga como un precio de cero", async () => {
    /*
     * En el PDF hay celdas en blanco y celdas con "0,00 €". Las dos significan
     * que no hay precio, no que el neumático sea gratis. Si alguna se hubiera
     * cargado tal cual, se facturaría un neumático de camión a cero euros.
     */
    const ceros = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_tariff_tire_prices
        WHERE "tariffVersionId" IN ($1, $2)
          AND "priceModel" = 'NET_PRICE' AND "netAmount" <= 0`,
      [versionId, versionCompraId]);
    expect(ceros.rows[0].n).toBe(0);
  });

  it("sin precio neto se cae al descuento sobre baremo, que es lo que dice el documento", async () => {
    /*
     * 295/80R22.5 en tracción no tiene precio neto de Bridgestone en ninguna
     * de las dos tablas, así que entra por la puerta de atrás: "condiciones
     * aplicables a todos los neumáticos que no figuran con precio neto"
     * (página 5), o sea el baremo del fabricante menos el descuento.
     *
     * Como aquí no hay ningún baremo cargado, el importe sale NULO con el
     * motivo, no cero. Cargar el baremo de Bridgestone es lo que le pondría
     * precio, y hasta entonces esto va a revisión manual.
     */
    const r = await tarifar({
      atMs: Date.parse("2026-08-14T22:17:00+02:00"), etapa: "final", distanceKm: 76,
      conceptos: [
        { tipo: "TIRE", neumatico: { medida: "295/80R22.5", marca: "Bridgestone", posicion: "DRIVE" } },
      ],
    });
    const linea = r.lineas.find((l) => l.tipo === "TIRE")!;
    expect(linea.ventaTotal).toBeNull();
    expect(r.avisos.map((a) => a.codigo)).toContain("MANUFACTURER_LIST_NOT_FOUND");
    expect(r.estado).toBe("manual_review");
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
    expect(formatear(r.compraTotal!)).toBe("137.50");
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


  it("la fiesta local del taller sube su compra, y la venta al cliente no se mueve", async () => {
    /*
     * Un martes de agosto: para el cliente de la central es un día laborable y
     * paga el diurno. Pero si en el pueblo del taller es fiesta local, ese día
     * el taller trabaja en festivo y lo factura como tal.
     *
     * Es la única asimetría deliberada entre los dos lados del motor, y aquí se
     * comprueba de punta a punta: el festivo está en la base, no en el contexto
     * de la prueba.
     */
    const w = await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", province, city,
                                      "createdAtMs", "updatedAtMs")
       VALUES ($1,41.6,-0.9,$2,'Zaragoza','Zaragoza',$3,$3) RETURNING id`,
      [`Taller festivo ${sufijo}`, empresaId, now]);
    const tallerId = Number(w.rows[0].id);

    await db.query(
      `INSERT INTO connect_provider_authorizations ("controlCenterId", "providerCompanyId", "createdAtMs")
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [centroId, empresaId, now]).catch(() => {});

    const { guardarFestivos } = await import("../workshopCalendar.ts");
    await guardarFestivos(centroId, [
      { scope: "local", workshopId: tallerId, date: "2026-08-11", name: "Fiesta del barrio" },
    ]);

    const MARTES = Date.parse("2026-08-11T10:30:00+02:00");
    const a = await db.query(
      `INSERT INTO connect_assistances
         (uuid, "partnerId", "controlCenterId", "clientId", "workshopId", status,
          "serviceType", vehicle, "serviceOrderedAtMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,'assigned','tyres',$6,$7,$8,$8) RETURNING id`,
      [`fest-${sufijo}`, partnerId, centroId, clienteId, tallerId,
       JSON.stringify({ type: "truck" }), MARTES, now]);

    const { estimar } = await import("./service.ts");
    const r = await estimar(Number(a.rows[0].id), { distanceKm: 76 });

    // El cliente paga su martes; el taller cobra festivo
    expect(r!.venta?.regla?.code).toBe("DIURNO");
    expect(formatear(r!.ventaTotal!)).toBe("198.00");
    expect(r!.compra?.regla?.code).toBe("FESTIVO");
    expect(formatear(r!.compraTotal!)).toBe("275.00");

    // Y el margen negativo que sale de ahí se ve, con su motivo
    expect(formatear(r!.margen!)).toBe("-77.00");
    expect(r!.avisos.map((x) => x.codigo)).toContain("WORKSHOP_HOLIDAY");

    await db.query(`DELETE FROM connect_assistances WHERE id = $1`, [a.rows[0].id]);
    await db.query(`DELETE FROM connect_workshop_holidays WHERE "workshopId" = $1`, [tallerId]);
    await db.query(`DELETE FROM connect_workshops WHERE id = $1`, [tallerId]);
  });

  it("el mismo taller un martes sin fiesta cobra diurno como todos", async () => {
    const w = await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", province, city,
                                      "createdAtMs", "updatedAtMs")
       VALUES ($1,41.6,-0.9,$2,'Zaragoza','Zaragoza',$3,$3) RETURNING id`,
      [`Taller normal ${sufijo}`, empresaId, now]);
    const tallerId = Number(w.rows[0].id);

    const a = await db.query(
      `INSERT INTO connect_assistances
         (uuid, "partnerId", "controlCenterId", "clientId", "workshopId", status,
          "serviceType", vehicle, "serviceOrderedAtMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$5,'assigned','tyres',$6,$7,$8,$8) RETURNING id`,
      [`nofest-${sufijo}`, partnerId, centroId, clienteId, tallerId,
       JSON.stringify({ type: "truck" }), Date.parse("2026-08-11T10:30:00+02:00"), now]);

    const { estimar } = await import("./service.ts");
    const r = await estimar(Number(a.rows[0].id), { distanceKm: 76 });
    expect(r!.compra?.regla?.code).toBe("DIURNO");
    expect(formatear(r!.compraTotal!)).toBe("170.00");
    expect(r!.avisos.map((x) => x.codigo)).not.toContain("WORKSHOP_HOLIDAY");

    await db.query(`DELETE FROM connect_assistances WHERE id = $1`, [a.rows[0].id]);
    await db.query(`DELETE FROM connect_workshops WHERE id = $1`, [tallerId]);
  });
});
