/**
 * De una asistencia finalizada a sus encuestas, contra PostgreSQL real.
 *
 * Se prueba el orquestador directamente y no a través del cierre: es la misma
 * función que llama `cierre/finalizacion.ts`, y así estas pruebas no dependen
 * de que los otros cuatro enganches funcionen.
 *
 * Hay además una prueba que SÍ pasa por el cierre entero, porque lo que de
 * verdad puede romperse es el enganche: que la condición sea `finishedAtMs` y
 * no el estado, que para entonces ya es `en_camino_base`.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let cfg: typeof import("./config.ts");
let post: typeof import("./postFinalizacion.ts");
let cierre: typeof import("../cierre/finalizacion.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;
const TALLER = 7070;
const creadas: number[] = [];

type Alta = {
  finalizada?: boolean;
  telConductor?: string | null;
  telCliente?: string | null;
};

async function crear(o: Alta = {}): Promise<{ id: number; clienteId: number | null }> {
  const ahora = Date.now();
  const finalizada = o.finalizada !== false;

  let clienteId: number | null = null;
  if (o.telCliente !== undefined) {
    const c = await db.query(
      `INSERT INTO connect_clients (name, "contactPhone", "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [`Cliente ${sufijo}-${++n}`, o.telCliente, ahora],
    );
    clienteId = Number(c.rows[0].id);
  }

  const a = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, plate,
        "descripcionAveria", "trackingToken", "clienteFacturacionId", "tallerId",
        "finishedAtMs", "assignedTechName", "createdAtMs", "updatedAtMs")
     VALUES ($1,'normal','Contacto','600999888','AP-7','1234ABC','Rueda',$2,$3,$4,$5,'Anthoni',$6,$6)
     RETURNING id`,
    [finalizada ? "en_camino_base" : "en_punto", `tok-pf-${sufijo}-${++n}`,
     clienteId, TALLER, finalizada ? ahora : null, ahora],
  );
  const id = Number(a.rows[0].id);
  creadas.push(id);

  if (o.telConductor !== undefined) {
    await db.query(
      `INSERT INTO roadside_backoffice ("assistanceId","conductorTelefono","createdAtMs","updatedAtMs")
       VALUES ($1,$2,$3,$3)`,
      [id, o.telConductor, ahora],
    );
  }
  return { id, clienteId };
}

const encuestas = async (id: number) =>
  (await db.query(
    `SELECT "recipientRole", status, "sendAfterMs", "expiresAtMs", "tokenHash"
       FROM survey_instances WHERE "assistanceId" = $1 ORDER BY "recipientRole"`,
    [String(id)])).rows;

async function encender(extra: Record<string, unknown> = {}) {
  await cfg.guardarConfigGlobal({ activo: true, conductor: true, cliente: true, ...extra });
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  cfg = await import("./config.ts");
  post = await import("./postFinalizacion.ts");
  cierre = await import("../cierre/finalizacion.ts");
  await cfg.initSatisfactionConfig();
  const { initEventLog } = await import("../eventlog/schema.ts");
  const { initDocumentos } = await import("../documentos/schema.ts");
  const { initCorreo } = await import("../correo/schema.ts");
  await initEventLog(); await initDocumentos(); await initCorreo();
});

afterAll(async () => {
  if (!RUN) return;
  if (creadas.length) {
    await db.query(`DELETE FROM assistance_reminders WHERE "assistanceId" = ANY($1)`,
      [creadas.map(String)]).catch(() => {});
  }
  await db.end().catch(() => {});
});

describe.skipIf(!RUN)("generación de encuestas", () => {
  it("con los dos teléfonos distintos crea las dos", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "900222222" });
    const r = await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    expect(r.procesada).toBe(true);
    expect(r.resultados.filter((x) => x.estado === "created")).toHaveLength(2);
    expect((await encuestas(id)).map((e) => e.recipientRole)).toEqual(["CUSTOMER", "DRIVER"]);
  });

  it("procesar dos veces deja UNA por rol", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "900222222" });
    await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    const dos = await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    expect(dos.resultados.every((x) => x.estado === "already_exists")).toBe(true);
    expect(await encuestas(id)).toHaveLength(2);
  });

  it("solo conductor: una encuesta", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111" });
    await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    const e = await encuestas(id);
    expect(e).toHaveLength(1);
    expect(e[0].recipientRole).toBe("DRIVER");
  });

  it("solo cliente: una encuesta", async () => {
    await encender();
    const { id } = await crear({ telCliente: "900222222" });
    await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    const e = await encuestas(id);
    expect(e).toHaveLength(1);
    expect(e[0].recipientRole).toBe("CUSTOMER");
  });

  /*
   * La política provisional: si son el mismo número no se manda NADA. Elegir
   * cuál sin haber mirado cuántas asistencias reales caen aquí sería
   * inventarse la política.
   */
  it("el mismo número: cero encuestas y conflicto registrado", async () => {
    await encender();
    const { id } = await crear({ telConductor: "+34 600 11 22 33", telCliente: "0034600112233" });
    const r = await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    expect(await encuestas(id)).toHaveLength(0);
    expect(r.motivos).toContain("same_recipient_conflict");
    expect(r.resultados.every((x) => x.estado === "skipped")).toBe(true);
  });

  it("sin teléfonos: cero", async () => {
    await encender();
    const { id } = await crear({});
    await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    expect(await encuestas(id)).toHaveLength(0);
  });

  it("Satisfaction apagado: cero", async () => {
    await cfg.guardarConfigGlobal({ activo: false, conductor: true, cliente: true });
    const { id } = await crear({ telConductor: "600111111", telCliente: "900222222" });
    const r = await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    expect(await encuestas(id)).toHaveLength(0);
    expect(r.motivos).toContain("satisfaction_disabled");
  });

  it("el override del cliente se respeta", async () => {
    await encender();
    const { id, clienteId } = await crear({ telConductor: "600111111", telCliente: "900222222" });
    await cfg.guardarOverrideCliente({
      sourceSystem: "assist", tenantId: String(TALLER), clientId: clienteId!,
      valores: { conductor: false },
    });
    await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    const e = await encuestas(id);
    expect(e).toHaveLength(1);
    expect(e[0].recipientRole).toBe("CUSTOMER");
  });

  it("sin finalizar: cero", async () => {
    await encender();
    const { id } = await crear({ finalizada: false, telConductor: "600111111", telCliente: "900222222" });
    const r = await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    expect(await encuestas(id)).toHaveLength(0);
    expect(r.motivos).toContain("not_finished");
  });

  it("la encuesta nace en CREATED, sin token, con sus dos fechas congeladas", async () => {
    await encender({ caducidadHoras: 48, retrasoMinutos: 30 });
    const { id } = await crear({ telConductor: "600111111" });
    const ahora = Date.now();
    await post.procesarSatisfactionTrasFinalizacion({
      assistanceId: id, tenantId: TALLER, ahoraMs: ahora,
    });
    const [e] = await encuestas(id);
    expect(e.status).toBe("CREATED");
    expect(e.tokenHash).toBeNull();
    expect(Number(e.sendAfterMs)).toBe(ahora + 30 * 60_000);
    expect(Number(e.expiresAtMs)).toBe(ahora + 48 * 3_600_000);
  });

  /*
   * Cambiar la configuración DESPUÉS no puede mover de hora una encuesta ya
   * creada: sus fechas están guardadas, no se derivan al leer.
   */
  it("cambiar la configuración no mueve las encuestas ya creadas", async () => {
    await encender({ caducidadHoras: 48, retrasoMinutos: 30 });
    const { id } = await crear({ telConductor: "600111111" });
    await post.procesarSatisfactionTrasFinalizacion({ assistanceId: id, tenantId: TALLER });
    const antes = (await encuestas(id))[0];

    await encender({ caducidadHoras: 1, retrasoMinutos: 999 });
    const despues = (await encuestas(id))[0];
    expect(despues.sendAfterMs).toBe(antes.sendAfterMs);
    expect(despues.expiresAtMs).toBe(antes.expiresAtMs);
  });
});

/* ── Por el cierre entero ────────────────────────────────────────────────── */

describe.skipIf(!RUN)("enganchado al cierre", () => {
  /*
   * Se espera a la condición, no a un rato fijo.
   *
   * `engancharPosteriores` no devuelve promesa a propósito y Satisfaction es
   * el ÚLTIMO de la cadena: por delante va TyreControl, que sin red tarda unos
   * siete segundos en rendirse. Con 400 ms fijos, esta prueba pasaba o fallaba
   * según el orden de los ficheros del día.
   */
  const CON_ENGANCHES = 30_000;

  async function esperarEncuestas(id: number, n: number) {
    const limite = Date.now() + 20_000;
    let filas = await encuestas(id);
    while (filas.length < n && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 50));
      filas = await encuestas(id);
    }
    return filas;
  }

  /** Solo donde se comprueba que NO se genera nada: a una ausencia no se le sondea. */
  const respirar = () => new Promise((r) => setTimeout(r, 400));

  /*
   * LA prueba del enganche. Cuando esto corre, la ruta de la APK ya ha dejado
   * la asistencia en `en_camino_base`: si la condición fuera el estado, no se
   * generaría ninguna encuesta desde la APK, que es el caso más frecuente.
   */
  it("desde la APK se generan aunque el estado ya sea en_camino_base", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "900222222" });
    cierre.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "operario",
      actorNombre: "Anthoni", ahoraMs: Date.now(),
    });
    expect(await esperarEncuestas(id, 2)).toHaveLength(2);
    expect((await db.query(`SELECT status FROM roadside_assistances WHERE id = $1`, [id]))
      .rows[0].status).toBe("en_camino_base");
  }, CON_ENGANCHES);

  it("desde oficina se generan las mismas", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "900222222" });
    cierre.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "oficina", ahoraMs: Date.now(),
    });
    expect((await esperarEncuestas(id, 2)).map((e) => e.recipientRole))
      .toEqual(["CUSTOMER", "DRIVER"]);
  }, CON_ENGANCHES);

  it("un cambio de estado que no es finalizar no genera nada", async () => {
    await encender();
    const { id } = await crear({ telConductor: "600111111", telCliente: "900222222" });
    cierre.engancharPosteriores({
      assistanceId: id, estado: "en_camino", origen: "oficina", ahoraMs: Date.now(),
    });
    await respirar();
    expect(await encuestas(id)).toHaveLength(0);
  }, CON_ENGANCHES);
});
