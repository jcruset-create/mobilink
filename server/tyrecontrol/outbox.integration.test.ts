/**
 * La cola de sincronización, contra PostgreSQL real.
 *
 * Las dos pruebas que justifican el fichero:
 *
 *  · Dos workers a la vez no pueden procesar la misma reparación. El claim
 *    atómico decide, no la suerte.
 *  · Una operación ya completada NUNCA se vuelve a encolar. Es la única
 *    barrera contra duplicados que tenemos, porque TyreControl no tiene
 *    idempotency key.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/** Qué devuelve la ejecución simulada. */
let desenlace: any = { estado: "COMPLETED", operacionTcId: "op-1", incidenciaId: "inc-1", camino: "en_sitio" };
let ejecuciones = 0;

vi.mock("./reparacionServicio.ts", () => ({
  ejecutarReparacion: async () => { ejecuciones++; return desenlace; },
  situacionDePosicion: async () => ({
    posicionId: "pos-1", montajeActualId: "mon-1", neumaticoId: "neu-1", estadoNeumatico: "montado",
  }),
}));

let db: typeof import("../db.ts").default;
let outbox: typeof import("./outbox.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let asistencia = 0;

const PLAN = {
  tcVehicleId: "veh-1", tcEmpresaId: `emp-${sufijo}`, posicionCodigo: "E2_IZQ_EXT",
  tipo: "pinchazo" as const, resultado: "reparado" as const, observaciones: "prueba",
};

describe.skipIf(!RUN)("Cola de reparaciones", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initIntegrationHub } = await import("../integration-hub/index.ts");
    const { initTyreControlAssist } = await import("./schema.ts");
    await initDb(); await initIntegrationHub(); await initTyreControlAssist();
    outbox = await import("./outbox.ts");

    const r = await db.query(
      `INSERT INTO roadside_assistances
         (status, priority, "customerName", "customerPhone", address, plate,
          "descripcionAveria", "trackingToken", "createdAtMs", "updatedAtMs")
       VALUES ('finalizada','normal','C','600','Calle','1234ABC','Pinchazo',$1,$2,$2)
       RETURNING id`,
      [`tok-obx-${sufijo}`, Date.now()]);
    asistencia = Number(r.rows[0].id);
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`DELETE FROM integration_operation_logs WHERE correlation_id LIKE $1`,
      [`assist:${asistencia}:%`]).catch(() => {});
    await db.query(`DELETE FROM integration_operations WHERE correlation_id LIKE $1`,
      [`assist:${asistencia}:%`]).catch(() => {});
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [asistencia]).catch(() => {});
  }, 30_000);

  beforeEach(async () => {
    ejecuciones = 0;
    desenlace = { estado: "COMPLETED", operacionTcId: "op-1", incidenciaId: "inc-1", camino: "en_sitio" };
    process.env.TYRE_CONTROL_WRITE_ENABLED = "true";
    process.env.TYRE_CONTROL_REPAIR_SYNC_ENABLED = "true";
    process.env.TYRE_CONTROL_SYNC_COMPANIES = PLAN.tcEmpresaId;
    await db.query(`DELETE FROM integration_operations WHERE correlation_id LIKE $1`,
      [`assist:${asistencia}:%`]).catch(() => {});
    await db.query(
      `UPDATE roadside_assistances SET "tcSyncEstado" = NULL, "tcSyncMotivo" = NULL,
              "tcIncidenciaId" = NULL WHERE id = $1`, [asistencia]);
  });

  afterEach(() => {
    delete process.env.TYRE_CONTROL_WRITE_ENABLED;
    delete process.env.TYRE_CONTROL_REPAIR_SYNC_ENABLED;
    delete process.env.TYRE_CONTROL_SYNC_COMPANIES;
  });

  /* ── Encolado e idempotencia ───────────────────────────────────────────── */

  it("encola una vez y con la correlación del hecho", async () => {
    const r = await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    expect(r.encolada).toBe(true);
    expect(r.correlationId).toBe(`assist:${asistencia}:tc:repair:E2_IZQ_EXT`);
  });

  it("no encola dos veces el mismo hecho", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    const segunda = await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    expect(segunda).toMatchObject({ encolada: false });
    expect((segunda as { motivo: string }).motivo).toContain("en curso");
  });

  /* Dos ruedas de la misma asistencia son dos hechos distintos. */
  it("dos ruedas distintas sí son dos operaciones", async () => {
    const a = await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    const b = await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_DER_EXT" });
    expect(a.encolada && b.encolada).toBe(true);
    expect(a.correlationId).not.toBe(b.correlationId);
  });

  /* ÉSTA es la barrera contra duplicados. */
  it("lo ya sincronizado no se vuelve a encolar NUNCA", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    const op = await outbox.reclamarSiguiente();
    await outbox.procesar(op);

    const otra = await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    expect(otra).toMatchObject({ encolada: false });
    expect((otra as { motivo: string }).motivo).toContain("Ya se sincronizó");
  });

  /* ── Doble ejecución ───────────────────────────────────────────────────── */

  /*
   * ÉSTA es la prueba del apartado 38. El claim atómico es lo que decide: el
   * segundo worker no encuentra ninguna fila que reclamar.
   */
  it("dos workers a la vez: solo uno la procesa", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });

    const [a, b] = await Promise.all([outbox.reclamarSiguiente(), outbox.reclamarSiguiente()]);
    const reclamadas = [a, b].filter(Boolean);
    expect(reclamadas).toHaveLength(1);

    await outbox.procesar(reclamadas[0]);
    expect(ejecuciones).toBe(1);
  });

  it("dos ciclos completos del worker no ejecutan dos veces", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    await Promise.all([outbox.cicloReparaciones(), outbox.cicloReparaciones()]);
    expect(ejecuciones).toBe(1);
  });

  /* ── Desenlaces ────────────────────────────────────────────────────────── */

  it("una sincronización correcta queda anotada en la asistencia", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    await outbox.procesar(await outbox.reclamarSiguiente());

    const a = await db.query(
      `SELECT "tcSyncEstado", "tcOperacionTcId", "tcIncidenciaId" FROM roadside_assistances WHERE id = $1`,
      [asistencia]);
    expect(a.rows[0].tcSyncEstado).toBe("SINCRONIZADA");
    expect(a.rows[0].tcOperacionTcId).toBe("op-1");
  });

  /* Un conflicto no es un fallo del canal: reintentarlo no arregla nada. */
  it("un conflicto queda como fallo permanente con su motivo", async () => {
    desenlace = { estado: "CONFLICT", motivo: "Alguien ha cambiado la rueda de E2_IZQ_EXT" };
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    expect(await outbox.procesar(await outbox.reclamarSiguiente())).toBe("FAILED");

    const a = await db.query(`SELECT "tcSyncEstado", "tcSyncMotivo" FROM roadside_assistances WHERE id = $1`,
      [asistencia]);
    expect(a.rows[0].tcSyncEstado).toBe("CONFLICTO");
    expect(a.rows[0].tcSyncMotivo).toContain("cambiado la rueda");
  });

  it("un resultado incierto va a revisión manual, no a reintento", async () => {
    desenlace = { estado: "MANUAL_REVIEW", motivo: "No se sabe si llegó", incidenciaId: "inc-9" };
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    expect(await outbox.procesar(await outbox.reclamarSiguiente())).toBe("MANUAL_REVIEW");

    // Y el worker NO la vuelve a coger: no está entre las reclamables.
    ejecuciones = 0;
    await outbox.cicloReparaciones();
    expect(ejecuciones).toBe(0);
  });

  it("un fallo transitorio queda pendiente de reintento", async () => {
    desenlace = { estado: "RETRY", codigo: "tc_unavailable", motivo: "sin red" };
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    expect(await outbox.procesar(await outbox.reclamarSiguiente())).toBe("RETRY_PENDING");
    // Y ésta SÍ se vuelve a coger.
    expect(await outbox.reclamarSiguiente()).toBeTruthy();
  });

  /* ── Las llaves, también al procesar ───────────────────────────────────── */

  /*
   * Entre encolar y procesar pueden pasar horas. Si alguien apagó el
   * interruptor mientras tanto, no se escribe.
   */
  it("si se apaga la sincronización, lo encolado espera en vez de ejecutarse", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    const op = await outbox.reclamarSiguiente();
    delete process.env.TYRE_CONTROL_REPAIR_SYNC_ENABLED;

    expect(await outbox.procesar(op)).toBe("RETRY_PENDING");
    expect(ejecuciones).toBe(0);
  });

  it("una empresa fuera del despliegue no se ejecuta", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    const op = await outbox.reclamarSiguiente();
    process.env.TYRE_CONTROL_SYNC_COMPANIES = "otra-empresa";

    expect(await outbox.procesar(op)).toBe("RETRY_PENDING");
    expect(ejecuciones).toBe(0);
  });

  it("con las llaves apagadas el ciclo no toca nada", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    delete process.env.TYRE_CONTROL_WRITE_ENABLED;
    expect(await outbox.cicloReparaciones()).toBe(0);
    expect(ejecuciones).toBe(0);
  });

  /* ── Reintento a mano ──────────────────────────────────────────────────── */

  /* Vuelve a pasar por el mismo camino: repite la lectura previa. */
  it("el reintento manual vuelve a ejecutar el flujo completo", async () => {
    desenlace = { estado: "FAILED", codigo: "tc_error", motivo: "algo" };
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    await outbox.procesar(await outbox.reclamarSiguiente());

    desenlace = { estado: "COMPLETED", operacionTcId: "op-2", incidenciaId: "inc-1", camino: "en_sitio" };
    ejecuciones = 0;
    const r = await outbox.reintentarAMano(`assist:${asistencia}:tc:repair:E2_IZQ_EXT`);
    expect(r).toBe("COMPLETED");
    expect(ejecuciones).toBe(1);
  });

  it("reintentar algo ya completado no lo ejecuta otra vez", async () => {
    await outbox.encolarReparacion({ assistanceId: asistencia, plan: PLAN, refRueda: "E2_IZQ_EXT" });
    await outbox.procesar(await outbox.reclamarSiguiente());
    ejecuciones = 0;

    expect(await outbox.reintentarAMano(`assist:${asistencia}:tc:repair:E2_IZQ_EXT`)).toBe("COMPLETED");
    expect(ejecuciones).toBe(0);
  });
});
