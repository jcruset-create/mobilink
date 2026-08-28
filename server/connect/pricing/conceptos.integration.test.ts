/**
 * Conceptos de la asistencia (neumáticos y materiales), contra PostgreSQL.
 * Diseño en docs/PROMPT_conceptos_asistencia.md.
 *
 * Lo que se fija aquí es el contrato económico del ciclo
 * previsto → confirmado | no_usado:
 *
 *   · Solo lo CONFIRMADO se factura, valorado por el tarifario congelado.
 *   · Lo previsto sin resolver NO se cobra por defecto: aviso y revisión.
 *   · Confirmar un neumático exige la foto de montaje, y de ESTA asistencia.
 *   · Un material confirmado sin precio en tarifa sale como línea con
 *     importes nulos y revisión manual, nunca cero y nunca invisible.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SEAS_2026_COMPRA, SEAS_2026_VENTA } from "./tarifarios/seas2026.ts";
import { formatear } from "./money.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../../db.ts").default;
let finalizar: typeof import("./service.ts").finalizar;
let con: typeof import("./concepts.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
// Viernes por la mañana: forfait diurno, sin festivos de por medio
const VIERNES_DIA = Date.parse("2026-08-14T10:17:00+02:00");

let centroId = 0;
let clienteId = 0;
let empresaId = 0;
let tallerId = 0;
let partnerId = 0;

async function asistencia(): Promise<number> {
  const uuid = String(process.hrtime.bigint()).slice(-9);
  const r = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "controlCenterId", "clientId", "workshopId", status,
        "serviceType", vehicle, "serviceOrderedAtMs", "odometerKm", "workedMinutes",
        "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$5,'finished','tyres',$6,$7,80,90,$8,$8) RETURNING id`,
    [`cpt-${uuid}`, partnerId, centroId, clienteId, tallerId,
     JSON.stringify({ type: "truck" }), VIERNES_DIA, now],
  );
  return Number(r.rows[0].id);
}

/** Foto de montaje subida a la asistencia, como haría la APK. */
async function foto(assistanceId: number): Promise<string> {
  const r = await db.query(
    `INSERT INTO connect_assistance_files
       ("assistanceId", "workshopId", category, url, "fileName", "createdAtMs")
     VALUES ($1,$2,'mounting','https://x/m.jpg','m.jpg',$3) RETURNING id`,
    [assistanceId, tallerId, Date.now()],
  );
  return `c${r.rows[0].id}`;
}

describe.skipIf(!RUN)("Conceptos de la asistencia", () => {
  beforeAll(async () => {
    db = (await import("../../db.ts")).default;
    ({ finalizar } = await import("./service.ts"));
    con = await import("./concepts.ts");
    const { cargarTarifario, publicarVersion } = await import("./tarifario.ts");

    const cc = await db.query(
      `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`cc-cp-${sufijo}`, `Central ${sufijo}`, now]);
    centroId = Number(cc.rows[0].id);

    const p = await db.query(
      `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$4,$4) RETURNING id`, [`pa-cp-${sufijo}`, `Partner ${sufijo}`, centroId, now]);
    partnerId = Number(p.rows[0].id);

    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centroId, `Cliente ${sufijo}`, now]);
    clienteId = Number(cl.rows[0].id);

    const em = await db.query(
      `INSERT INTO connect_provider_companies (uuid, name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [`pr-cp-${sufijo}`, `Proveedora ${sufijo}`, now]);
    empresaId = Number(em.rows[0].id);

    const w = await db.query(
      `INSERT INTO connect_workshops (name, latitude, longitude, "providerCompanyId", "createdAtMs", "updatedAtMs")
       VALUES ($1,41.1,1.2,$2,$3,$3) RETURNING id`, [`Taller ${sufijo}`, empresaId, now]);
    tallerId = Number(w.rows[0].id);

    const v = await cargarTarifario(centroId, { ...SEAS_2026_VENTA, code: `CPV_${sufijo}` });
    const c = await cargarTarifario(centroId, { ...SEAS_2026_COMPRA, code: `CPC_${sufijo}` });

    // Material de catálogo en las dos tarifas: la reparación de pinchazo.
    // Es un suplemento PER_UNIT, que es exactamente lo que edita el panel.
    for (const [versionId, importe] of [[v.tariffVersionId, "35"], [c.tariffVersionId, "22"]] as const) {
      await db.query(
        `INSERT INTO connect_tariff_extras
           ("controlCenterId", "tariffVersionId", code, name, "calculationType",
            amount, "appliesTo", "lineKind", "createdAtMs")
         VALUES ($1,$2,'REPARACION','Reparación de pinchazo','PER_UNIT',$3,'assistance','MATERIAL',$4)`,
        [centroId, versionId, importe, now]);
    }

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
      `DELETE FROM connect_assistance_concepts WHERE "controlCenterId" = $1`,
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

  // ── Caso A: cambio previsto, confirmado con foto ─────────────────────────

  it("previsto por Central + confirmado con foto = línea valorada a venta y compra", async () => {
    const id = await asistencia();
    const previsto = await con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "315/80 R 22,5", brand: "hankook", position: "STEER",
      quantity: 2, actor: "Operador Prueba",
    });
    expect(previsto.status).toBe("previsto");
    // La medida y la marca quedan normalizadas al guardar, no al leer
    expect(previsto.size).toBe("315/80R22.5");

    const ref = await foto(id);
    await con.confirmarConcepto(id, previsto.id, centroId, {
      actor: "Taller (Lite)", via: "lite", evidenceRef: ref,
    });

    const r = await finalizar(id, { distanceSource: "routed" });
    expect(r).not.toBeNull();
    const linea = r!.lineas.find((l) => l.tipo === "TIRE");
    expect(linea).toBeDefined();
    // SEAS 315/80R22.5 STEER Hankook: venta 506,60 y compra 480,00 por unidad
    expect(formatear(linea!.ventaUnitaria!, 2)).toBe("506.60");
    expect(formatear(linea!.compraUnitaria!, 2)).toBe("480.00");
    expect(formatear(linea!.ventaTotal!, 2)).toBe("1013.20");
    expect(r!.estado).toBe("ok");
  });

  it("previsto sin confirmar NO se cobra por defecto: aviso y revisión manual", async () => {
    const id = await asistencia();
    await con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "315/80R22.5", brand: "Hankook", position: "DRIVE",
      actor: "Operador Prueba",
    });

    const r = await finalizar(id, { distanceSource: "routed" });
    expect(r!.lineas.some((l) => l.tipo === "TIRE")).toBe(false);
    expect(r!.avisos.some((a) => a.codigo === "CONCEPT_NOT_CONFIRMED")).toBe(true);
    expect(r!.estado).toBe("manual_review");
  });

  it("lo marcado como no usado ni se cobra ni ensucia el cierre", async () => {
    const id = await asistencia();
    const c = await con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "315/80R22.5", brand: "Hankook", position: "STEER",
      actor: "Operador Prueba",
    });
    await con.marcarNoUsado(id, c.id, centroId, {
      actor: "Taller", motivo: "Se pudo reparar el pinchazo",
    });

    const r = await finalizar(id, { distanceSource: "routed" });
    expect(r!.lineas.some((l) => l.tipo === "TIRE")).toBe(false);
    expect(r!.avisos.some((a) => a.codigo === "CONCEPT_NOT_CONFIRMED")).toBe(false);
    expect(r!.estado).toBe("ok");
  });

  // ── Caso B2: el taller declara lo que montó ──────────────────────────────

  it("declarar+confirmar del catálogo (reparación fallida) factura el montado", async () => {
    const id = await asistencia();
    const ref = await foto(id);
    const c = await con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "315/80R22.5", brand: "Hankook", position: "DRIVE",
      confirmar: true, evidenceRef: ref, via: "lite", actor: "Taller (Lite)",
    });
    expect(c.status).toBe("confirmado");

    const r = await finalizar(id, { distanceSource: "routed" });
    expect(formatear(r!.lineas.find((l) => l.tipo === "TIRE")!.ventaUnitaria!, 2)).toBe("506.60");
  });

  it("confirmar un neumático SIN foto se rechaza; con foto de OTRA asistencia, también", async () => {
    const id = await asistencia();
    const otra = await asistencia();
    const c = await con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "315/80R22.5", brand: "Hankook", position: "STEER",
      actor: "Operador",
    });

    await expect(con.confirmarConcepto(id, c.id, centroId, {
      actor: "Taller", via: "lite",
    })).rejects.toMatchObject({ codigo: "evidencia_requerida" });

    const ajena = await foto(otra);
    await expect(con.confirmarConcepto(id, c.id, centroId, {
      actor: "Taller", via: "lite", evidenceRef: ajena,
    })).rejects.toMatchObject({ codigo: "evidencia_invalida" });
  });

  // ── Materiales ───────────────────────────────────────────────────────────

  it("la reparación es facturable: material del catálogo, sin foto", async () => {
    const id = await asistencia();
    await con.crearConcepto(id, centroId, {
      kind: "MATERIAL", conceptCode: "reparacion", quantity: 1,
      confirmar: true, via: "lite", actor: "Taller (Lite)",
    });

    const r = await finalizar(id, { distanceSource: "routed" });
    const linea = r!.lineas.find((l) => l.tipo === "MATERIAL");
    expect(linea).toBeDefined();
    expect(formatear(linea!.ventaTotal!, 2)).toBe("35.00");
    expect(formatear(linea!.compraTotal!, 2)).toBe("22.00");
    expect(r!.estado).toBe("ok");
  });

  it("material confirmado sin precio en tarifa: línea nula y revisión, nunca cero", async () => {
    const id = await asistencia();
    await con.crearConcepto(id, centroId, {
      kind: "MATERIAL", conceptCode: "ECOTASA_INVENTADA", quantity: 2,
      confirmar: true, via: "panel", actor: "Operador",
    });

    const r = await finalizar(id, { distanceSource: "routed" });
    const linea = r!.lineas.find((l) => l.tipo === "MATERIAL");
    expect(linea).toBeDefined();
    expect(linea!.ventaTotal).toBeNull();
    expect(linea!.compraTotal).toBeNull();
    expect(r!.avisos.some((a) => a.codigo === "MATERIAL_PRICE_NOT_FOUND")).toBe(true);
    expect(r!.estado).toBe("manual_review");
  });

  // ── Idempotencia y candados ──────────────────────────────────────────────

  it("el mismo clientActionId no crea dos apuntes (cola offline de Lite)", async () => {
    const id = await asistencia();
    const ref = await foto(id);
    const alta = {
      kind: "TIRE", size: "315/80R22.5", brand: "Hankook", position: "STEER" as const,
      confirmar: true, evidenceRef: ref, via: "lite" as const, actor: "Taller",
      clientActionId: `accion-${sufijo}`,
    };
    const c1 = await con.crearConcepto(id, centroId, alta);
    const c2 = await con.crearConcepto(id, centroId, alta);
    expect(c2.id).toBe(c1.id);
    expect((await con.listarConceptos(id, centroId)).length).toBe(1);
  });

  it("con la tarifa cerrada la lista no se toca: el camino es el ajuste manual", async () => {
    const id = await asistencia();
    await finalizar(id, { distanceSource: "routed" });
    await expect(con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "315/80R22.5", brand: "Hankook", actor: "Operador",
    })).rejects.toMatchObject({ codigo: "tarifa_cerrada", estado: 409 });
  });

  it("la cantidad corregida por el operador es la que se factura", async () => {
    const id = await asistencia();
    const ref = await foto(id);
    const c = await con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "315/80R22.5", brand: "Hankook", position: "STEER",
      quantity: 3, confirmar: true, evidenceRef: ref, via: "lite", actor: "Taller",
    });
    await con.corregirCantidad(id, c.id, centroId, 1);

    const r = await finalizar(id, { distanceSource: "routed" });
    expect(formatear(r!.lineas.find((l) => l.tipo === "TIRE")!.ventaTotal!, 2)).toBe("506.60");
  });

  it("el alta con conceptos los deja previstos, listos para que el taller confirme", async () => {
    const id = await asistencia();
    // Lo que hace la ruta de alta: un concepto por cada linea del formulario
    for (const c of [
      { kind: "TIRE", size: "315/80R22.5", brand: "Hankook", position: "STEER", quantity: 2 },
      { kind: "MATERIAL", conceptCode: "REPARACION", quantity: 1 },
    ]) {
      await con.crearConcepto(id, centroId, { ...c, actor: "Operador de alta" } as any);
    }
    const lista = await con.listarConceptos(id, centroId);
    expect(lista.length).toBe(2);
    expect(lista.every((c) => c.status === "previsto")).toBe(true);
    expect(lista.every((c) => c.plannedBy === "Operador de alta")).toBe(true);
  });

  it("un concepto sin medida se rechaza y no deja fila a medias", async () => {
    // La asistencia manda: en el alta esto sale como aviso y no la tumba,
    // pero el concepto NO puede quedar guardado sin medida.
    const id = await asistencia();
    await expect(con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "   ", actor: "Operador",
    })).rejects.toMatchObject({ codigo: "medida_requerida" });
    expect((await con.listarConceptos(id, centroId)).length).toBe(0);
  });

  it("marcar no usado sin motivo se rechaza: la pregunta llegará al cuadrar", async () => {
    const id = await asistencia();
    const c = await con.crearConcepto(id, centroId, {
      kind: "TIRE", size: "315/80R22.5", brand: "Hankook", actor: "Operador",
    });
    await expect(con.marcarNoUsado(id, c.id, centroId, { actor: "X", motivo: "  " }))
      .rejects.toMatchObject({ codigo: "motivo_requerido" });
  });
});
