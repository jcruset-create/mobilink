/**
 * Puesta en marcha de una central desde cero, contra PostgreSQL.
 *
 * La prueba que da sentido al fichero es la última: se crea una central vacía,
 * se recorre la lista de lo que falta paso a paso y al terminar la central
 * tarifica. Si esa secuencia deja de funcionar, un cliente nuevo se queda
 * atascado y nadie lo sabe hasta que llama.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let ob: typeof import("./onboarding.ts");
let ta: typeof import("./pricing/tariffAdmin.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();
const ANIO = 2026;

const creados: number[] = [];

async function centroNuevo(etiqueta: string): Promise<number> {
  const r = await ob.crearCentro({
    nombre: `Central ${etiqueta} ${sufijo}`,
    emailAdmin: `admin-${etiqueta}-${sufijo}@example.com`,
    nombreAdmin: "Primer Administrador",
  });
  creados.push(r.controlCenterId);
  return r.controlCenterId;
}

describe.skipIf(!RUN)("Puesta en marcha de una central", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    ob = await import("./onboarding.ts");
    ta = await import("./pricing/tariffAdmin.ts");
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    for (const c of creados) {
      for (const sql of [
        `DELETE FROM connect_contracts WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_assistances WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_plans WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_calendars WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_time_bands WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_tariff_zones WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_clients WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_users WHERE "controlCenterId" = $1`,
        `DELETE FROM connect_control_centers WHERE id = $1`,
      ]) await db.query(sql, [c]).catch(() => {});
    }
  }, 30_000);

  it("crear una central deja dentro a su primer administrador", async () => {
    const centro = await centroNuevo("a");
    const u = await db.query(
      `SELECT email, role FROM connect_users WHERE "controlCenterId" = $1`, [centro]);
    expect(u.rows).toHaveLength(1);
    expect(u.rows[0].role).toBe("cc_admin");
  });

  it("un correo que ya es de otra central no se le roba: se avisa", async () => {
    const email = `repe-${sufijo}@example.com`;
    const a = await ob.crearCentro({ nombre: `Uno ${sufijo}`, emailAdmin: email });
    creados.push(a.controlCenterId);
    expect(a.adminCreado).toBe(true);

    const b = await ob.crearCentro({ nombre: `Dos ${sufijo}`, emailAdmin: email });
    creados.push(b.controlCenterId);
    expect(b.adminCreado).toBe(false);
    expect(b.aviso).toContain("otra central");

    // Y el usuario sigue siendo de la primera
    const u = await db.query(`SELECT "controlCenterId" FROM connect_users WHERE email = $1`, [email]);
    expect(Number(u.rows[0].controlCenterId)).toBe(a.controlCenterId);
  });

  it("sin correo de administrador no se crea la central", async () => {
    await expect(ob.crearCentro({ nombre: "Sin admin", emailAdmin: "" }))
      .rejects.toMatchObject({ codigo: "email_requerido" });
  });

  // ── Plantillas ───────────────────────────────────────────────────────────

  it("la plantilla monta la estructura entera con los importes a CERO", async () => {
    /*
     * Lo importante no es que cree filas: es que no invente precios. Una
     * plantilla con "precios orientativos" es un número que alguien publica
     * con prisa y acaba en una factura.
     */
    const centro = await centroNuevo("b");
    const r = await ob.aplicarPlantilla(centro, {
      plantilla: "CARRETERA_24H", code: "MI_TARIFA", nombre: "Mi tarifa", anio: ANIO,
    });

    expect(r.status).toBe("draft");
    expect(r.reglas).toBe(7);
    expect(r.franjas).toBe(4);
    expect(r.diasCalendario).toBe(10);

    const importes = await db.query(
      `SELECT DISTINCT amount FROM connect_tariff_rules WHERE "tariffVersionId" = $1`,
      [r.tariffVersionId]);
    expect(importes.rows.map((x: any) => Number(x.amount))).toEqual([0]);

    const extras = await db.query(
      `SELECT code, amount, percentage FROM connect_tariff_extras WHERE "tariffVersionId" = $1`,
      [r.tariffVersionId]);
    for (const e of extras.rows) {
      expect(Number(e.amount ?? e.percentage), e.code).toBe(0);
    }
  });

  it("la plantilla trae bien lo que cuesta acertar: la medianoche y las prioridades", async () => {
    const centro = await centroNuevo("c");
    const r = await ob.aplicarPlantilla(centro, {
      plantilla: "CARRETERA_24H", code: "T", nombre: "T", anio: ANIO,
    });
    const d = await ta.detalleVersion(centro, r.tariffVersionId);

    // El nocturno cruza la medianoche y se ancla al día en que empezó
    const nocturno = d.franjas.find((f: any) => f.code === "NOCTURNO");
    expect(nocturno).toMatchObject({ desde: "19:00", hasta: "08:00", weekdayAnchor: "band_start" });

    // El festivo gana al horario, y la Navidad al festivo
    const prio = (code: string) => d.reglas.find((x: any) => x.code === code).priority;
    expect(prio("FESTIVO_EXTRA")).toBeGreaterThan(prio("FESTIVO"));
    expect(prio("FESTIVO")).toBeGreaterThan(prio("NOCTURNO"));
    expect(prio("DIURNO_PROX")).toBeGreaterThan(prio("DIURNO"));

    // Y no hay dos reglas empatadas
    const prioridades = d.reglas.map((x: any) => x.priority);
    expect(new Set(prioridades).size).toBe(prioridades.length);

    // Los suplementos se disparan por umbral, no siempre
    expect(d.reglas.every((x: any) => x.extraTriggerType === "THRESHOLD_PERCENT")).toBe(true);
  });

  it("una plantilla que no existe se dice, no se ignora", async () => {
    const centro = await centroNuevo("d");
    await expect(ob.aplicarPlantilla(centro, { plantilla: "NO_EXISTE", code: "X", nombre: "X" }))
      .rejects.toMatchObject({ codigo: "plantilla_desconocida", estado: 404 });
  });

  it("no se puede aplicar dos veces con el mismo código", async () => {
    const centro = await centroNuevo("e");
    await ob.aplicarPlantilla(centro, { plantilla: "MINIMA", code: "DUP", nombre: "Dup", anio: ANIO });
    await expect(ob.aplicarPlantilla(centro, { plantilla: "MINIMA", code: "DUP", nombre: "Dup", anio: ANIO }))
      .rejects.toMatchObject({ codigo: "tarifario_duplicado", estado: 409 });
  });

  it("las tres plantillas se cargan y ninguna nace publicada", async () => {
    const centro = await centroNuevo("f");
    for (const p of ["CARRETERA_24H", "TALLER", "MINIMA"]) {
      const r = await ob.aplicarPlantilla(centro, {
        plantilla: p, code: `P_${p}`, nombre: p, anio: ANIO });
      expect(r.status, p).toBe("draft");
      expect(r.reglas, p).toBeGreaterThan(0);
    }
  });

  // ── La lista de lo que falta ─────────────────────────────────────────────

  it("una central recién creada lo tiene casi todo pendiente, pero ya con administrador", async () => {
    const centro = await centroNuevo("g");
    const e = await ob.estadoPuestaEnMarcha(centro);
    expect(e.listo).toBe(false);
    expect(e.pasos.find((p) => p.clave === "usuarios")!.hecho).toBe(true);
    expect(e.pasos.find((p) => p.clave === "tarifario")!.hecho).toBe(false);
    expect(e.pasos.find((p) => p.clave === "publicar")!.hecho).toBe(false);
    // Cada paso explica por qué hace falta: una lista sin el porqué se rellena a ciegas
    expect(e.pasos.every((p) => p.porQue.length > 10)).toBe(true);
  });

  it("los importes a cero NO cuentan como configurados", async () => {
    const centro = await centroNuevo("h");
    await ob.aplicarPlantilla(centro, { plantilla: "MINIMA", code: "T", nombre: "T", anio: ANIO });
    const e = await ob.estadoPuestaEnMarcha(centro);
    expect(e.pasos.find((p) => p.clave === "tarifario")!.hecho).toBe(true);
    expect(e.pasos.find((p) => p.clave === "importes")!.hecho).toBe(false);
    expect(e.pasos.find((p) => p.clave === "importes")!.detalle).toContain("cero");
  });

  // ── El recorrido completo ────────────────────────────────────────────────

  it("de central vacía a tarifa que factura, siguiendo la lista", async () => {
    const centro = await centroNuevo("z");

    // 1. Tarifario desde plantilla
    const t = await ob.aplicarPlantilla(centro, {
      plantilla: "CARRETERA_24H", code: "NACIONAL", nombre: "Nacional", anio: ANIO });

    // 2. Poner los importes
    await ta.guardarRegla(centro, t.tariffVersionId, {
      code: "DIURNO", name: "Diurno", amount: "150", priority: 40,
      timeBandId: (await ta.detalleVersion(centro, t.tariffVersionId))
        .franjas.find((f: any) => f.code === "DIURNO").id,
      includedDistanceKm: "100", includedDurationMin: 180,
      extraTriggerType: "THRESHOLD_PERCENT", extraThresholdPercent: "20",
    });
    let e = await ob.estadoPuestaEnMarcha(centro);
    expect(e.pasos.find((p) => p.clave === "importes")!.hecho).toBe(true);
    expect(e.pasos.find((p) => p.clave === "publicar")!.hecho).toBe(false);

    // 3. Publicar
    const pub = await ta.publicar(centro, t.tariffVersionId, null);
    expect(pub.publicada).toBe(true);

    // 4. Cliente y contrato de venta
    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centro, `Cliente ${sufijo}`, now]);
    await ob.guardarContrato(centro, {
      role: "sale", clientId: cl.rows[0].id, tariffPlanId: t.tariffPlanId,
      name: "Contrato de venta", status: "active",
      validFromMs: Date.parse(`${ANIO}-01-01T00:00:00Z`),
    });

    e = await ob.estadoPuestaEnMarcha(centro);
    expect(e.pasos.find((p) => p.clave === "contrato_venta")!.hecho).toBe(true);

    // 5. Y ahora tarifica de verdad
    const { cargarConfiguracion } = await import("./pricing/repository.ts");
    const { calcularTarifa } = await import("./pricing/engine.ts");
    const atMs = Date.parse(`${ANIO}-08-11T10:30:00+02:00`);   // martes por la mañana

    const { configuracion, timezone } = await cargarConfiguracion({
      controlCenterId: centro, clientId: Number(cl.rows[0].id),
      providerCompanyId: null, workshopId: null, atMs, lugar: { country: "ES" },
    });
    const r = calcularTarifa({
      assistanceId: 1, controlCenterId: centro, clientId: Number(cl.rows[0].id),
      workshopId: null, providerCompanyId: null,
      serviceTypeCode: "tyres", vehicleTypeCode: "truck",
      atMs, timezone, lugar: { municipality: null },
      zoneIds: (configuracion as any).zoneIds ?? [],
      distanceKm: 80, distanceSource: "routed", durationMin: null,
    }, configuracion, { etapa: "locked", pricingRequestId: "setup" });

    expect(r.venta?.regla?.code).toBe("DIURNO");
    expect(r.ventaTotal).toBe(1_500_000n);   // 150,00

    // Falta la compra, y la lista lo dice sin bloquear
    expect(r.compraTotal).toBeNull();
    e = await ob.estadoPuestaEnMarcha(centro);
    expect(e.pasos.find((p) => p.clave === "contrato_compra")!.hecho).toBe(false);
    expect(e.pasos.find((p) => p.clave === "contrato_compra")!.imprescindible).toBe(false);
  });

  // ── Contratos ────────────────────────────────────────────────────────────

  it("un contrato de venta sin cliente no se guarda, y uno de compra sin proveedora tampoco", async () => {
    const centro = await centroNuevo("i");
    const t = await ob.aplicarPlantilla(centro, {
      plantilla: "MINIMA", code: "T", nombre: "T", anio: ANIO });

    await expect(ob.guardarContrato(centro, { role: "sale", tariffPlanId: t.tariffPlanId }))
      .rejects.toMatchObject({ codigo: "cliente_requerido" });
    await expect(ob.guardarContrato(centro, { role: "purchase", tariffPlanId: t.tariffPlanId }))
      .rejects.toMatchObject({ codigo: "proveedor_requerido" });
  });

  it("no se puede colgar un contrato del tarifario de otro centro", async () => {
    const centroA = await centroNuevo("j");
    const centroB = await centroNuevo("k");
    const t = await ob.aplicarPlantilla(centroA, {
      plantilla: "MINIMA", code: "T", nombre: "T", anio: ANIO });
    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centroB, `Cliente B ${sufijo}`, now]);

    await expect(ob.guardarContrato(centroB, {
      role: "sale", clientId: cl.rows[0].id, tariffPlanId: t.tariffPlanId,
    })).rejects.toMatchObject({ codigo: "tarifario_no_encontrado", estado: 404 });
  });

  it("un contrato se termina, no se borra", async () => {
    /*
     * Borrarlo dejaría sin explicar las asistencias que se tarificaron con él.
     */
    const centro = await centroNuevo("l");
    const t = await ob.aplicarPlantilla(centro, {
      plantilla: "MINIMA", code: "T", nombre: "T", anio: ANIO });
    const cl = await db.query(
      `INSERT INTO connect_clients ("controlCenterId", name, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`, [centro, `Cliente ${sufijo}`, now]);
    const c = await ob.guardarContrato(centro, {
      role: "sale", clientId: cl.rows[0].id, tariffPlanId: t.tariffPlanId, status: "active" });

    expect(await ob.borrarContrato(centro, c.id)).toBe(true);
    const fila = await db.query(`SELECT status, "validToMs" FROM connect_contracts WHERE id = $1`, [c.id]);
    expect(fila.rows[0].status).toBe("ended");
    expect(Number(fila.rows[0].validToMs)).toBeGreaterThan(0);
  });
});
