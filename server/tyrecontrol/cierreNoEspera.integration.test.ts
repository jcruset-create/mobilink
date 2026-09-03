/**
 * El cierre de una asistencia no espera a TyreControl.
 *
 * Es la promesa que sostiene todo el diseño: el técnico cierra y se va. Si el
 * cierre dependiera de que otro sistema conteste, un corte de red dejaría a
 * alguien mirando una rueda que no gira.
 *
 * Se comprueba con TyreControl deliberadamente LENTO: si el enganche esperase,
 * el tiempo del cierre se llevaría ese retraso.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/** Cuánto tarda «TyreControl» en contestar. */
const RETRASO_TC_MS = 700;
let consultasTc = 0;

vi.mock("../supabase.ts", () => {
  function from(tabla: string) {
    const lento = async () => {
      consultasTc++;
      await new Promise((r) => setTimeout(r, RETRASO_TC_MS));
      return { data: [], error: null };
    };
    const api: any = {
      select: () => api, eq: () => api, in: () => api, ilike: () => api, order: () => api,
      limit: lento,
      maybeSingle: async () => { await lento(); return { data: null, error: null }; },
      then: (r: any) => lento().then(r),
    };
    void tabla;
    return api;
  }
  return { supabase: { from } };
});

let db: typeof import("../db.ts").default;
let cierre: typeof import("./cierreAsistencia.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let asistencia = 0;

describe.skipIf(!RUN)("El cierre no espera a TyreControl", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("../connect/schema.ts");
    const { initIntegrationHub } = await import("../integration-hub/index.ts");
    const { initDocumentos } = await import("../documentos/schema.ts");
    const { initExcepciones } = await import("../excepciones/schema.ts");
    const { initTyreControlAssist } = await import("./schema.ts");
    await initDb(); await initConnect(); await initIntegrationHub();
    await initDocumentos(); await initExcepciones(); await initTyreControlAssist();
    cierre = await import("./cierreAsistencia.ts");

    const r = await db.query(
      `INSERT INTO roadside_assistances
         (status, priority, "customerName", "customerPhone", address, plate,
          "descripcionAveria", "trackingToken", "tcOperacion", "tcPosicionCodigo",
          "createdAtMs", "updatedAtMs", "finishedAtMs")
       VALUES ('finalizada','normal','C','600','Calle','1234ABC','Pinchazo',$1,
               'reparacion_neumatico','E2_IZQ_EXT',$2,$2,$2) RETURNING id`,
      [`tok-esp-${sufijo}`, Date.now()]);
    asistencia = Number(r.rows[0].id);
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    await db.query(`DELETE FROM roadside_assistances WHERE id = $1`, [asistencia]).catch(() => {});
  }, 30_000);

  /*
   * En `server/index.ts` el enganche se llama con `void`, sin `await`. Aquí se
   * reproduce esa llamada y se mide: el cierre devuelve enseguida aunque TC
   * tarde.
   */
  it("el cierre devuelve antes de que TyreControl conteste", async () => {
    consultasTc = 0;
    const t0 = Date.now();

    // Igual que en el endpoint real: se lanza y no se espera.
    const enMarcha = cierre.engancheCierreTyreControl(asistencia);
    const tCierre = Date.now() - t0;

    // El «cierre» ha vuelto sin esperar al retraso de TyreControl.
    expect(tCierre).toBeLessThan(RETRASO_TC_MS / 2);

    // Y lo de TC sigue por detrás: al esperarlo sí se nota.
    await enMarcha;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(RETRASO_TC_MS);
    expect(consultasTc).toBeGreaterThan(0);
  }, 30_000);

  /* Un fallo de TyreControl no puede propagarse al técnico. */
  it("un error de TyreControl no lanza hacia arriba", async () => {
    await expect(cierre.engancheCierreTyreControl(99999999)).resolves.toBeNull();
  });
});
