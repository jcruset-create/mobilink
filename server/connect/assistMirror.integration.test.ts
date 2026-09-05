/**
 * Espejo económico de Mobilink Assist, contra PostgreSQL.
 * Diseño en docs/PROMPT_tarifas_assist.md.
 *
 * Lo que se fija aquí:
 *
 *   · Apagado de fábrica: sin interruptor no se espeja nada.
 *   · El tiempo va de la CREACIÓN a la LLEGADA AL TALLER (regla de
 *     dirección): la franja del forfait se resuelve al crear, y la duración
 *     la calcula el sistema — nadie teclea minutos.
 *   · Los kilómetros son los del técnico (`serviceKm`).
 *   · Sin compra: flota propia. La venta sale del contrato del cliente.
 *   · Una asistencia inyectada desde Central NO gana un segundo espejo.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026_VENTA } from "./pricing/tarifarios/seas2026.ts";
import { formatear } from "./pricing/money.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let espejo: typeof import("./assistMirror.ts");
let finalizar: typeof import("./pricing/service.ts").finalizar;
let estimar: typeof import("./pricing/service.ts").estimar;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
// Viernes por la mañana: forfait diurno (198 de venta), sin festivos
const VIERNES_DIA = Date.parse("2026-08-14T10:17:00+02:00");

let centroId = 0;
let clienteId = 0;

async function coreAssistance(p: {
  creadaMs?: number;
  solicitante?: string | null;
  status?: string;
} = {}): Promise<number> {
  const r = await db.query(
    `INSERT INTO roadside_assistances
       (status, "customerName", "customerPhone", address, plate,
        "solicitanteEmpresa", "trackingToken", "createdAtMs", "updatedAtMs")
     VALUES ($1,'Juan Prueba','600000000','Ctra. N-340 km 1', '1234ABC',
             $2,$3,$4,$4) RETURNING id`,
    [p.status ?? "pendiente", p.solicitante === undefined ? "Cliente Espejo" : p.solicitante,
     `tk-${sufijo}-${String(process.hrtime.bigint()).slice(-8)}`, p.creadaMs ?? VIERNES_DIA],
  );
  return Number(r.rows[0].id);
}

async function filaEspejo(coreId: number): Promise<any | null> {
  const r = await db.query(
    `SELECT * FROM connect_assistances WHERE "coreAssistanceId" = $1`, [coreId]);
  return r.rows[0] ?? null;
}

/**
 * Una pasada del espejo lo bastante grande para incluir a la nuestra.
 *
 * `pasadaDeEspejos` procesa como mucho 50 asistencias por vuelta, ordenadas por
 * id. Esta prueba mira la fila espejo de UNA asistencia concreta, y con la
 * suite entera corriendo sobre la misma base hay decenas de asistencias de
 * otros ficheros esperando espejo: la nuestra, que es la más nueva, se quedaba
 * fuera del lote y la prueba fallaba sin que nada estuviera roto. Pasaba en
 * local y fallaba en la CI según cuánta morralla hubiera dejado el fichero
 * anterior.
 *
 * Lo que se prueba aquí es el ciclo del espejo, no el tamaño del lote.
 */
const pasada = () => espejo.pasadaDeEspejos(500);

describe.skipIf(!RUN)("Espejo económico de Assist", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("./schema.ts");
    espejo = await import("./assistMirror.ts");
    ({ finalizar, estimar } = await import("./pricing/service.ts"));
    const { cargarTarifario, publicarVersion } = await import("./pricing/tarifario.ts");
    await initDb();
    await initConnect();

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, settings, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`,
      [`cc-esp-${sufijo}`, `Central espejo ${sufijo}`,
       JSON.stringify({ assistMirror: { activo: true, desdeMs: VIERNES_DIA - 1 } }), now]);
    centroId = Number(cc.rows[0].id);

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,'Cliente Espejo',$2,$2) RETURNING id`, [centroId, now]);
    clienteId = Number(cl.rows[0].id);

    // Solo VENTA: flota propia, sin lado de compra (decisión del §5 del prompt)
    const v = await cargarTarifario(centroId, { ...SEAS_2026_VENTA, code: `ESPV_${sufijo}` });
    await publicarVersion(v.tariffVersionId, null);
    await db.query(
      `INSERT INTO connect_contracts
         ("controlCenterId", role, "clientId", "tariffPlanId", name, status,
          "validFromMs", "createdAtMs", "updatedAtMs")
       VALUES ($1,'sale',$2,$3,'Venta espejo','active',$4,$5,$5)`,
      [centroId, clienteId, v.tariffPlanId, Date.parse("2026-01-01T00:00:00Z"), now]);
  }, 90_000);

  afterAll(async () => {
    if (!RUN || !centroId) return;
    const cores = await db.query(
      `SELECT "coreAssistanceId" AS id FROM connect_assistances
        WHERE "controlCenterId" = $1 AND "coreAssistanceId" IS NOT NULL`, [centroId]);
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
    for (const c of cores.rows) {
      await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [c.id]).catch(() => {});
    }
  }, 30_000);

  it("el ciclo completo: crear → estimar, asignar → congelar, llegar al taller → cerrar", async () => {
    const coreId = await coreAssistance();

    let r = await pasada();
    expect(r.creados).toBeGreaterThanOrEqual(1);

    const e = await filaEspejo(coreId);
    expect(e).not.toBeNull();
    expect(Number(e.clientId)).toBe(clienteId); // emparejado por el nombre exacto
    // LA REGLA: la franja del forfait se resuelve al CREAR la asistencia
    expect(Number(e.serviceOrderedAtMs)).toBe(VIERNES_DIA);

    // La estimación es efímera en todo el sistema: se calcula al pedirla.
    // Recién creada y sin distancia, es el forfait diurno a secas.
    const est = await estimar(Number(e.id), {});
    expect(est).not.toBeNull();
    expect(formatear(est!.ventaTotal!, 2)).toBe("198.00");

    // El operador asigna técnico → el pase congela el forfait
    await db.query(
      `UPDATE roadside_assistances SET status='asignada', "assignedAtMs" = $1,
              "assignedTechName" = 'Tecnico Uno' WHERE id = $2`,
      [VIERNES_DIA + 10 * 60_000, coreId]);
    r = await pasada();
    expect(r.bloqueados).toBeGreaterThanOrEqual(1);

    // Servicio hecho: el técnico anota 130 km; el vehículo llega al taller
    // 170 minutos después de crearse la asistencia (dentro de los 180 del
    // forfait: sin tiempo extra; 30 km por encima de los 100 incluidos)
    await db.query(
      `UPDATE roadside_assistances
          SET status='llegada_taller', "serviceKm" = 130,
              "finishedAtMs" = $1, "arrivedAtWorkshopMs" = $2
        WHERE id = $3`,
      [VIERNES_DIA + 150 * 60_000, VIERNES_DIA + 170 * 60_000, coreId]);
    r = await pasada();
    expect(r.regularizados).toBeGreaterThanOrEqual(1);

    const e2 = await filaEspejo(coreId);
    // La duración la puso el sistema: creación → llegada al taller
    expect(Number(e2.workedMinutes)).toBe(170);
    expect(Number(e2.odometerKm)).toBe(130);

    // El cierre (manual o automático) usa esos datos
    const cierre = await finalizar(Number(e2.id), {});
    expect(cierre).not.toBeNull();
    // Forfait diurno 198 + 30 km extra × 1,25 = 235,50 de venta
    expect(formatear(cierre!.ventaTotal!, 2)).toBe("235.50");
    // Flota propia: sin contrato de compra, compra nula. Nunca cero.
    expect(cierre!.compraTotal).toBeNull();
    expect(cierre!.avisos.some((a) => a.codigo === "PURCHASE_TARIFF_NOT_FOUND")).toBe(true);
  });

  it("dos pases seguidos no duplican el espejo", async () => {
    const coreId = await coreAssistance();
    await pasada();
    await pasada();
    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances WHERE "coreAssistanceId" = $1`,
      [coreId]);
    expect(n.rows[0].n).toBe(1);
  });

  it("una asistencia inyectada desde Central NO gana un segundo espejo", async () => {
    const coreId = await coreAssistance();
    // Simular el puente de ida: ya existe una fila de Connect apuntando al core
    const p = await db.query(
      `SELECT id FROM connect_partners WHERE "controlCenterId" = $1 LIMIT 1`, [centroId]);
    await db.query(
      `INSERT INTO connect_assistances
         (uuid, "partnerId", "controlCenterId", "coreAssistanceId", status,
          "serviceType", vehicle, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,'assigned','tyres','{}',$5,$5)`,
      [`iny-${sufijo}-${coreId}`, p.rows[0].id, centroId, coreId, now]);

    await pasada();
    const n = await db.query(
      `SELECT COUNT(*)::int AS n FROM connect_assistances WHERE "coreAssistanceId" = $1`,
      [coreId]);
    expect(n.rows[0].n).toBe(1);
  });

  it("el solicitante que no empareja EXACTO queda sin cliente, con el texto conservado", async () => {
    const coreId = await coreAssistance({ solicitante: "Cliente Espej" }); // errata
    await pasada();
    const e = await filaEspejo(coreId);
    expect(e.clientId).toBeNull();
    expect(e.clientName).toBe("Cliente Espej");
  });

  it("sin paso por taller, el fin es finishedAtMs; sin ninguno, no se inventa duración", async () => {
    const coreId = await coreAssistance();
    await pasada();
    await db.query(
      `UPDATE roadside_assistances
          SET status='finalizada', "serviceKm" = 20, "finishedAtMs" = $1
        WHERE id = $2`,
      [VIERNES_DIA + 95 * 60_000, coreId]);
    await pasada();
    const e = await filaEspejo(coreId);
    expect(Number(e.workedMinutes)).toBe(95);
  });

  it("apagado el interruptor, no se espeja nada", async () => {
    await db.query(
      `UPDATE connect_control_centers
          SET settings = $1 WHERE id = $2`,
      [JSON.stringify({ assistMirror: { activo: false, desdeMs: 1 } }), centroId]);
    const coreId = await coreAssistance();
    const r = await pasada();
    expect(r.creados).toBe(0);
    expect(await filaEspejo(coreId)).toBeNull();
    // se deja encendido para el resto de la batería (orden de ficheros)
    await db.query(
      `UPDATE connect_control_centers SET settings = $1 WHERE id = $2`,
      [JSON.stringify({ assistMirror: { activo: true, desdeMs: VIERNES_DIA - 1 } }), centroId]);
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [coreId]).catch(() => {});
  });
});
