/**
 * Ajustes manuales de importes y auditoría económica, contra PostgreSQL.
 *
 * Lo que se fija aquí:
 *
 *  - Que no se puede cambiar un importe sin motivo ni por encima del rol.
 *  - Que el ajuste NO reescribe el snapshot: la explicación tiene que seguir
 *    diciendo lo que dijo el tarifario, y la diferencia entre lo calculado y
 *    lo cobrado tiene que verse, no fundirse en un número nuevo.
 *  - Que lo ya exportado a facturación no se puede tocar por detrás.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026_COMPRA, SEAS_2026_VENTA } from "./tarifarios/seas2026.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let ov: typeof import("./overrides.ts");
let bloquear: typeof import("./service.ts").bloquear;
let finalizar: typeof import("./service.ts").finalizar;
let leerEtapa: typeof import("./service.ts").leerEtapa;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const VIERNES_NOCHE = Date.parse("2026-08-14T22:17:00+02:00");

let centroId = 0;
let clienteId = 0;
let empresaId = 0;
let tallerId = 0;
let partnerId = 0;

const ADMIN = { id: 1, nombre: "Ana Admin", role: "cc_admin" as const, controlCenterId: 0 };
const SUPER = { id: 2, nombre: "Sofía Supervisora", role: "supervisor" as const, controlCenterId: 0 };
const OPER = { id: 3, nombre: "Óscar Operador", role: "operator" as const, controlCenterId: 0 };

/** Asistencia con las dos etapas ya calculadas: 331 de venta, 275 de compra. */
async function conTarifa(): Promise<number> {
  const id = String(process.hrtime.bigint()).slice(-9);
  const r = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "controlCenterId", "clientId", "workshopId", status,
        "serviceType", vehicle, "serviceOrderedAtMs", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,'finished','tyres',$6,$7,$8,$8) RETURNING id`,
    [`ovr-${id}`, partnerId, centroId, clienteId, tallerId,
     JSON.stringify({ type: "truck", plate: "1234ABC" }), VIERNES_NOCHE, now]);
  const asistencia = Number(r.rows[0].id);
  await bloquear(asistencia, { distanceKm: 76 });
  await finalizar(asistencia, { distanceKm: 76 });
  return asistencia;
}

describe.skipIf(!RUN)("Ajustes manuales y auditoría económica", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    ov = await import("./overrides.ts");
    ({ bloquear, finalizar, leerEtapa } = await import("./service.ts"));
    const { cargarTarifario, publicarVersion } = await import("./tarifario.ts");

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`cc-ovr-${sufijo}`, `Central ${sufijo}`, now]);
    centroId = Number(cc.rows[0].id);
    for (const u of [ADMIN, SUPER, OPER]) u.controlCenterId = centroId;

    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`, [`pa-ovr-${sufijo}`, `Partner ${sufijo}`, centroId, now]);
    partnerId = Number(p.rows[0].id);

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centroId, `Cliente ${sufijo}`, now]);
    clienteId = Number(cl.rows[0].id);

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`pr-ovr-${sufijo}`, `Proveedora ${sufijo}`, now]);
    empresaId = Number(em.rows[0].id);

    const w = await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", "createdAtMs", "updatedAtMs")
       VALUES ($1,41.1,1.2,$2,$3,$3) RETURNING id`, [`Taller ${sufijo}`, empresaId, now]);
    tallerId = Number(w.rows[0].id);

    const v = await cargarTarifario(centroId, { ...SEAS_2026_VENTA, code: `OVRV_${sufijo}` });
    const c = await cargarTarifario(centroId, { ...SEAS_2026_COMPRA, code: `OVRC_${sufijo}` });
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
      `DELETE FROM connect_billing_marks WHERE "controlCenterId" = $1`,
      `DELETE FROM connect_pricing_overrides WHERE "controlCenterId" = $1`,
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

  it("un ajuste cambia el importe y recalcula margen y porcentaje", async () => {
    const id = await conTarifa();
    const r = await ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Acuerdo comercial con el cliente por el retraso",
    }, ADMIN);

    expect(r.anterior).toBe("331.00");
    expect(r.nuevo).toBe("300.00");
    expect(r.totales.venta).toBe("300.00");
    expect(r.totales.compra).toBe("275.00");
    expect(r.totales.margen).toBe("25.00");
    expect(r.totales.margenPct).toBe("8.33");
  });

  it("sin motivo no hay ajuste", async () => {
    const id = await conTarifa();
    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal", valorNuevo: "300", motivo: "",
    }, ADMIN)).rejects.toMatchObject({ codigo: "motivo_requerido" });

    // Y un motivo que no explica nada tampoco
    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal", valorNuevo: "300", motivo: "ok",
    }, ADMIN)).rejects.toMatchObject({ codigo: "motivo_requerido" });
  });

  it("un operador no puede tocar dinero", async () => {
    const id = await conTarifa();
    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Lo he hablado con el cliente",
    }, OPER)).rejects.toMatchObject({ codigo: "sin_permiso", estado: 403 });
  });

  it("un supervisor ajusta lo pequeño pero no lo grande", async () => {
    const id = await conTarifa();
    // 331 → 300 son 31 €, dentro de su límite
    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Descuento pactado por el retraso",
    }, SUPER)).resolves.toBeTruthy();

    // 300 → 100 son 200 €, por encima
    const grande = ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "100", motivo: "Descuento grande pactado por dirección",
    }, SUPER);
    await expect(grande).rejects.toMatchObject({ codigo: "sobre_limite", estado: 403 });
  });

  it("el límite del supervisor se puede subir por centro de control", async () => {
    await db.query(
      `UPDATE connect_control_centers SET settings = $1 WHERE id = $2`,
      [JSON.stringify({ pricing: { limiteAjusteSupervisor: 400 } }), centroId]);

    const id = await conTarifa();
    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "100", motivo: "Descuento grande autorizado por dirección",
    }, SUPER)).resolves.toBeTruthy();

    await db.query(`UPDATE connect_control_centers SET settings = '{}' WHERE id = $1`, [centroId]);
  });

  it("el snapshot NO se reescribe: sigue diciendo lo que dijo el tarifario", async () => {
    /*
     * Es lo que permite enseñar a la vez lo que calculó el motor y lo que
     * decidió una persona. Si el ajuste pisara el snapshot, la explicación
     * mentiría sobre el cálculo y la diferencia dejaría de ser visible.
     */
    const id = await conTarifa();
    await ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Acuerdo comercial por el retraso",
    }, ADMIN);

    const desdeSnapshot = await leerEtapa(id, "final");
    expect(desdeSnapshot!.ventaTotal).toBe(3_310_000n);   // 331,00 sin tocar

    const fila = await db.query(
      `SELECT "saleTotal", status, warnings FROM connect_assistance_pricings
        WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
    expect(Number(fila.rows[0].saleTotal)).toBe(300);
    expect(fila.rows[0].status).toBe("manual_review");
    expect(JSON.stringify(fila.rows[0].warnings)).toContain("MANUAL_OVERRIDE");
  });

  it("dos ajustes seguidos no duplican el aviso ni pierden el primero", async () => {
    const id = await conTarifa();
    await ov.ajustarImporte({ assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "320", motivo: "Primer ajuste por acuerdo" }, ADMIN);
    const segundo = await ov.ajustarImporte({ assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Segundo ajuste tras hablar con el cliente" }, ADMIN);

    expect(segundo.anterior).toBe("320.00");
    const ajustes = await ov.ajustesDe(id);
    expect(ajustes).toHaveLength(2);

    const fila = await db.query(
      `SELECT warnings FROM connect_assistance_pricings WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
    const avisos = JSON.parse(JSON.stringify(fila.rows[0].warnings)) as any[];
    expect(avisos.filter((a) => a.codigo === "MANUAL_OVERRIDE")).toHaveLength(1);
  });

  it("lo ya exportado a facturación no se toca por detrás", async () => {
    const id = await conTarifa();
    const { marcarExportadas } = await import("./billingRepo.ts");
    await marcarExportadas(centroId, "sale", [{ id, importe: "331.0000", currency: "EUR" }]);

    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Rectificación tras la factura",
    }, ADMIN)).rejects.toMatchObject({ codigo: "ya_facturado", estado: 409 });

    // Pero el lado de compra, que no se ha exportado, sí se puede ajustar
    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "purchaseTotal",
      valorNuevo: "260", motivo: "El taller factura menos de lo previsto",
    }, ADMIN)).resolves.toBeTruthy();
  });

  it("no se puede ajustar la tarifa de otro centro de control", async () => {
    const id = await conTarifa();
    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Intento desde otro centro",
    }, { ...ADMIN, controlCenterId: centroId + 9999 }))
      .rejects.toMatchObject({ codigo: "etapa_no_encontrada", estado: 404 });
  });

  it("una etapa que no existe se dice, no se inventa", async () => {
    const id = await conTarifa();
    await db.query(`DELETE FROM connect_assistance_pricings WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
    await expect(ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Ajuste sobre una etapa que no hay",
    }, ADMIN)).rejects.toMatchObject({ codigo: "etapa_no_encontrada", estado: 404 });
  });

  it("sin número de línea se ajusta el forfait, no una línea cualquiera", async () => {
    const id = await conTarifa();
    // Esta asistencia tiene una sola línea de forfait; se añade otra para que haya elección
    const p = await db.query(
      `SELECT id, "controlCenterId" FROM connect_assistance_pricings
        WHERE "assistanceId" = $1 AND stage = 'final'`, [id]);
    await db.query(
      `INSERT INTO connect_assistance_price_lines
         ("controlCenterId", "pricingId", "lineNumber", kind, description, quantity,
          "saleTotal", "purchaseTotal", "createdAtMs")
       VALUES ($1,$2,9,'MATERIAL','Fungibles',1,'10.0000','8.0000',$3)`,
      [p.rows[0].controlCenterId, p.rows[0].id, Date.now()]);

    const r = await ov.ajustarImporte({
      assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Acuerdo comercial sobre el forfait",
    }, ADMIN);
    expect(r.anterior).toBe("331.00");         // el forfait, no los 10 del material
    expect(r.totales.venta).toBe("310.00");    // 300 + 10
  });

  it("la auditoría suma DIFERENCIAS, no importes finales", async () => {
    /*
     * Lo que interesa no es cuánto se facturó sino cuánto se apartó de lo que
     * decía la tarifa. Un ajuste de 331 a 330 mueve un euro, no 330.
     */
    const desde = Date.now();
    const id = await conTarifa();
    await ov.ajustarImporte({ assistanceId: id, etapa: "final", campo: "saleTotal",
      valorNuevo: "300", motivo: "Acuerdo comercial por el retraso" }, ADMIN);

    const a = await ov.auditoriaEconomica({
      controlCenterId: centroId, desdeMs: desde, hastaMs: Date.now() + 1000 });

    expect(a.totales.ajustes).toBeGreaterThanOrEqual(1);
    expect(Number(a.totales.desviacionVenta)).toBe(-31);
    expect(a.ajustes[0]).toMatchObject({
      assistanceId: id, field: "saleTotal",
      originalValue: "331.00", newValue: "300.00", diferencia: "-31.00",
      authorizedByName: "Ana Admin",
    });
    expect(a.porUsuario.some((u: any) => u.usuario === "Ana Admin")).toBe(true);
  });
});
