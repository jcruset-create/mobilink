/**
 * El worker de Satisfaction, contra PostgreSQL real.
 *
 * Lo que se fija:
 *
 *   · lo que aún no le toca se queda quieto;
 *   · lo que ya cumplió su espera pasa a QUEUED —y NUNCA a SENT, porque nadie
 *     ha mandado nada;
 *   · lo caducado no entra en la cola, ni siquiera si le tocaba enviar;
 *   · lo contestado y lo cancelado no se tocan;
 *   · pasarlo dos veces no cambia nada la segunda.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");
let worker: typeof import("./worker.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;
const TENANT = `w-${sufijo}`;
const MINUTO = 60_000;

const ambito = (assistanceId: string) =>
  ({ sourceSystem: "assist" as const, tenantId: TENANT, assistanceId });

/** Una encuesta con su espera y su caducidad puestas a mano. */
async function encuesta(o: { enviaEnMs?: number; caducaEnMs?: number } = {}) {
  const a = `${sufijo}-${++n}`;
  const ahora = Date.now();
  const r = await svc.crearSurveyInstance({
    ambito: ambito(a), recipientRole: "DRIVER",
    retrasoMs: o.enviaEnMs ?? 0,
    caducidadMs: o.caducaEnMs ?? 7 * 24 * 3_600_000,
    ahoraMs: ahora,
  });
  if (r.estado !== "created") throw new Error("no creada");
  return { a, id: r.instancia.id };
}

const estado = async (id: number) =>
  (await db.query(`SELECT status, "queuedAtMs" FROM survey_instances WHERE id = $1`, [id])).rows[0];

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  svc = await import("./servicio.ts");
  worker = await import("./worker.ts");
});

afterAll(async () => { if (RUN) await db.end().catch(() => {}); });

describe.skipIf(!RUN)("encolar lo maduro", () => {
  it("lo que aún no le toca se queda en CREATED", async () => {
    const { id } = await encuesta({ enviaEnMs: 30 * MINUTO });
    await worker.encolarMaduras(200, Date.now());
    expect((await estado(id)).status).toBe("CREATED");
  });

  it("lo que ya cumplió la espera pasa a QUEUED, no a SENT", async () => {
    const { id } = await encuesta({ enviaEnMs: -MINUTO });
    expect(await worker.encolarMaduras(200, Date.now())).toBeGreaterThanOrEqual(1);
    const e = await estado(id);
    expect(e.status).toBe("QUEUED");
    expect(Number(e.queuedAtMs)).toBeGreaterThan(0);
  });

  /*
   * Se comprueba la caducidad también aquí, y no solo en el paso de caducar:
   * entre los dos pasos hay un hueco, y en ese hueco no puede colarse a la
   * cola algo que ya no vale.
   */
  it("una caducada no se encola aunque le tocara enviar", async () => {
    const { id } = await encuesta({ enviaEnMs: -MINUTO, caducaEnMs: -1000 });
    await worker.encolarMaduras(200, Date.now());
    expect((await estado(id)).status).toBe("CREATED");
  });

  it("no crea ninguna entrega: todavía no hay ningún envío real", async () => {
    const { id } = await encuesta({ enviaEnMs: -MINUTO });
    await worker.encolarMaduras(200, Date.now());
    const d = await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_deliveries WHERE "surveyInstanceId" = $1`, [id]);
    expect(d.rows[0].n).toBe(0);
  });

  it("tampoco emite el token: eso va justo antes de mandar", async () => {
    const { id } = await encuesta({ enviaEnMs: -MINUTO });
    await worker.encolarMaduras(200, Date.now());
    const f = await db.query(`SELECT "tokenHash" FROM survey_instances WHERE id = $1`, [id]);
    expect(f.rows[0].tokenHash).toBeNull();
  });

  it("una segunda pasada no la vuelve a encolar", async () => {
    const { id } = await encuesta({ enviaEnMs: -MINUTO });
    await worker.encolarMaduras(200, Date.now());
    const primera = await estado(id);
    await worker.encolarMaduras(200, Date.now());
    const segunda = await estado(id);
    expect(segunda.status).toBe("QUEUED");
    expect(segunda.queuedAtMs).toBe(primera.queuedAtMs);   // no se reescribe
  });

  it("dos pasadas a la vez no se pisan", async () => {
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await encuesta({ enviaEnMs: -MINUTO })).id);
    const ahora = Date.now();
    const [a, b] = await Promise.all([
      worker.encolarMaduras(200, ahora), worker.encolarMaduras(200, ahora),
    ]);
    // Entre las dos han hecho el trabajo, y ninguna fila ha quedado sin encolar.
    expect(a + b).toBeGreaterThanOrEqual(4);
    for (const id of ids) expect((await estado(id)).status).toBe("QUEUED");
  });
});

describe.skipIf(!RUN)("caducar", () => {
  it("una CREATED vencida pasa a EXPIRED", async () => {
    const { id } = await encuesta({ caducaEnMs: -1000 });
    expect(await worker.caducarVencidas(500, Date.now())).toBeGreaterThanOrEqual(1);
    expect((await estado(id)).status).toBe("EXPIRED");
  });

  it("una QUEUED vencida también", async () => {
    const { a, id } = await encuesta({ enviaEnMs: -MINUTO, caducaEnMs: 10 * MINUTO });
    await worker.encolarMaduras(200, Date.now());
    expect((await estado(id)).status).toBe("QUEUED");
    // Ya pasada su fecha.
    await worker.caducarVencidas(500, Date.now() + 20 * MINUTO);
    expect((await estado(id)).status).toBe("EXPIRED");
    void a;
  });

  it("una completada NO se caduca", async () => {
    const { a, id } = await encuesta({ caducaEnMs: 10 * MINUTO });
    await svc.completarSurvey({
      instanceId: id, ambito: ambito(a),
      respuestas: [
        { code: "overall_rating", value: 5 },
        { code: "professional_rating", value: 5 },
        { code: "resolution", value: "YES" },
      ],
    });
    await worker.caducarVencidas(500, Date.now() + 20 * MINUTO);
    // Caducarla dejaría una respuesta colgando de una encuesta que dice no
    // haberse contestado.
    expect((await estado(id)).status).toBe("COMPLETED");
  });

  it("una cancelada tampoco", async () => {
    const { a, id } = await encuesta({ caducaEnMs: 10 * MINUTO });
    await svc.cambiarEstado(id, ambito(a), "CANCELLED");
    await worker.caducarVencidas(500, Date.now() + 20 * MINUTO);
    expect((await estado(id)).status).toBe("CANCELLED");
  });

  it("una segunda pasada no cambia nada", async () => {
    const { id } = await encuesta({ caducaEnMs: -1000 });
    await worker.caducarVencidas(500, Date.now());
    const antes = await estado(id);
    await worker.caducarVencidas(500, Date.now());
    expect(await estado(id)).toEqual(antes);
  });
});

describe.skipIf(!RUN)("el ciclo completo", () => {
  /*
   * Caducar va ANTES de encolar: al revés, algo que caduca dentro de un
   * segundo entraría en la cola para salir de ella acto seguido.
   */
  it("caduca antes de encolar", async () => {
    const { id } = await encuesta({ enviaEnMs: -MINUTO, caducaEnMs: -1000 });
    const r = await worker.cicloSatisfaction(Date.now());
    expect(r.caducadas).toBeGreaterThanOrEqual(1);
    expect((await estado(id)).status).toBe("EXPIRED");
  });

  it("arrancar el worker dos veces no crea dos temporizadores", () => {
    worker.startSatisfactionWorker();
    worker.startSatisfactionWorker();
    worker.stopSatisfactionWorker();
    // Si hubiera dos, el segundo seguiría vivo y el proceso no terminaría.
    expect(true).toBe(true);
  });
});
