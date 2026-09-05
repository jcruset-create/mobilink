/**
 * El post-proceso del cambio de estado, contra PostgreSQL real.
 *
 * Este fichero existe para poder demostrar que el refactor no cambió nada. Lo
 * que había antes eran dos copias del mismo bloque dentro de dos rutas de
 * Express, imposibles de probar sin levantar el servidor; ahora es una función
 * con su contexto, y se le puede preguntar directamente.
 *
 * Y fija además la divergencia que salió al juntarlas: la ruta de la APK NO
 * anota el diario. Está probado a propósito, con su nombre, para que quede
 * claro que se conoce y que corregirlo es un cambio de comportamiento aparte.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Una fila de `pg` tal cual la devuelve el driver. */
type Fila = Record<string, string | number | null>;

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let mod: typeof import("./finalizacion.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;

/** Una asistencia recién finalizada, como la deja el UPDATE de la ruta. */
async function crearFinalizada(finishedAtMs: number | null = Date.now(), tallerId: number | null = null) {
  const r = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, plate,
        "descripcionAveria", "trackingToken", "assignedTechName",
        "finishedAtMs", "tallerId", "createdAtMs", "updatedAtMs")
     VALUES ($1,'normal','Cliente','600111222','AP-7 km 245','1234ABC','Rueda',$2,'Anthoni',
             $3,$4,$5,$5)
     RETURNING id`,
    [finishedAtMs ? "finalizada" : "en_punto", `tok-fin-${sufijo}-${++n}`,
     finishedAtMs, tallerId, Date.now()],
  );
  return Number(r.rows[0].id);
}

const fila = async (id: number) =>
  (await db.query(`SELECT * FROM roadside_assistances WHERE id = $1`, [id])).rows[0];

/** Espera a que corran los enganches que no se esperan. */
const respirar = () => new Promise((r) => setTimeout(r, 250));

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  mod = await import("./finalizacion.ts");
  const { initEventLog } = await import("../eventlog/schema.ts");
  const { initDocumentos } = await import("../documentos/schema.ts");
  const { initCorreo } = await import("../correo/schema.ts");
  await initEventLog();
  await initDocumentos();
  await initCorreo();
});

afterAll(async () => { if (RUN) await db.end().catch(() => {}); });

/* ── Elegibilidad ────────────────────────────────────────────────────────── */

describe("cuándo se considera terminado el servicio", () => {
  it("manda finishedAtMs, no el estado", () => {
    expect(mod.estaFinalizada({ finishedAtMs: 1 })).toBe(true);
    expect(mod.estaFinalizada({ finishedAtMs: 0 })).toBe(false);
    expect(mod.estaFinalizada({ finishedAtMs: null })).toBe(false);
    expect(mod.estaFinalizada({})).toBe(false);
    expect(mod.estaFinalizada(null)).toBe(false);
  });

  /*
   * LA prueba de este apartado. En la ruta de la APK el estado «finalizada»
   * dura un instante: la auto-transición lo deja en «en_camino_base». Quien
   * mire el estado un segundo después no vería ninguna finalizada.
   */
  it.skipIf(!RUN)("una asistencia en en_camino_base con finishedAtMs sigue siendo elegible", async () => {
    const id = await crearFinalizada();
    await mod.prepararRespuestaTrasCambio({
      assistanceId: id, estado: "finalizada", origen: "operario",
      actorNombre: "Anthoni", ahoraMs: Date.now(),
    });

    const f = await fila(id);
    expect(f.status).toBe("en_camino_base");          // el estado ya cambió…
    expect(Number(f.finishedAtMs)).toBeGreaterThan(0); // …pero el hecho sigue
    expect(await mod.asistenciaFinalizada(id)).toBe(true);
  });

  it.skipIf(!RUN)("una que no ha terminado no es elegible", async () => {
    const id = await crearFinalizada(null);
    expect(await mod.asistenciaFinalizada(id)).toBe(false);
  });

  it.skipIf(!RUN)("una que no existe devuelve null, no false", async () => {
    // Distinguirlo importa: «no existe» y «no ha terminado» piden respuestas
    // distintas a quien pregunta.
    expect(await mod.asistenciaFinalizada(99_000_000)).toBeNull();
  });

  it.skipIf(!RUN)("otro taller no la ve", async () => {
    const id = await crearFinalizada(Date.now(), 7777);
    expect(await mod.asistenciaFinalizada(id, 7777)).toBe(true);
    expect(await mod.asistenciaFinalizada(id, 8888)).toBeNull();
  });
});

/* ── Lo que cambia antes de contestar ────────────────────────────────────── */

describe.skipIf(!RUN)("preparación de la respuesta", () => {
  it("genera el token del informe una sola vez", async () => {
    const id = await crearFinalizada();
    const uno = await mod.prepararRespuestaTrasCambio({
      assistanceId: id, estado: "finalizada", origen: "oficina", ahoraMs: Date.now(),
    });
    const token = (uno as Fila).reportToken;
    expect(token).toBeTruthy();

    // Segunda pasada: NO lo cambia. Es el enlace que ya se le mandó al cliente.
    await mod.prepararRespuestaTrasCambio({
      assistanceId: id, estado: "finalizada", origen: "oficina", ahoraMs: Date.now(),
    });
    expect((await fila(id)).reportToken).toBe(token);
  });

  it("la APK pasa a «vuelta al taller» y deja su línea", async () => {
    const id = await crearFinalizada();
    const ahora = Date.now();
    const r = await mod.prepararRespuestaTrasCambio({
      assistanceId: id, estado: "finalizada", origen: "operario",
      actorNombre: "Anthoni", ahoraMs: ahora,
    });
    expect((r as Fila).status).toBe("en_camino_base");
    expect(Number((r as Fila).enCaminoBaseAtMs)).toBe(ahora + 1);

    const ev = await db.query(
      `SELECT status, note, "createdBy" FROM roadside_assistance_events
        WHERE "assistanceId" = $1 AND status = 'en_camino_base'`, [id]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].note).toBe("Vuelta al taller automática");
    expect(ev.rows[0].createdBy).toBe("Anthoni");
  });

  /*
   * Oficina NO auto-transiciona, y es correcto: desde el panel se puede estar
   * cerrando una asistencia de hace tres días, y decir que el técnico está
   * volviendo al taller sería mentira.
   */
  it("oficina no auto-transiciona", async () => {
    const id = await crearFinalizada();
    await mod.prepararRespuestaTrasCambio({
      assistanceId: id, estado: "finalizada", origen: "oficina", ahoraMs: Date.now(),
    });
    expect((await fila(id)).status).toBe("finalizada");
  });

  it("con otro estado no toca nada", async () => {
    const id = await crearFinalizada(null);
    expect(await mod.prepararRespuestaTrasCambio({
      assistanceId: id, estado: "en_camino", origen: "operario", ahoraMs: Date.now(),
    })).toBeNull();
    expect((await fila(id)).reportToken).toBeNull();
  });
});

/* ── Los enganches posteriores ───────────────────────────────────────────── */

describe.skipIf(!RUN)("enganches posteriores", () => {
  const diario = async (id: number) =>
    (await db.query(
      `SELECT "eventType", payload FROM assistance_events
        WHERE "sourceSystem" = 'assist' AND "assistanceId" = $1`, [String(id)])).rows;

  it("desde oficina se anota SERVICE_COMPLETED en el diario", async () => {
    const id = await crearFinalizada();
    mod.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "oficina",
      tenantId: null, actorNombre: "Oficina", tecnico: "Anthoni", ahoraMs: Date.now(),
    });
    await respirar();
    const ev = await diario(id);
    expect(ev.map((e: Fila) => e.eventType)).toContain("SERVICE_COMPLETED");
    expect(JSON.parse(ev[0].payload).tecnico).toBe("Anthoni");
  });

  /*
   * ── La divergencia ──────────────────────────────────────────────────────
   *
   * Esta prueba NO describe lo correcto: describe lo que hay. La ruta de la
   * APK nunca ha anotado el diario, así que una asistencia cerrada por el
   * técnico —el caso más frecuente— no deja SERVICE_COMPLETED.
   *
   * Se fija aquí para que el refactor sea demostrablemente equivalente. El día
   * que se arregle, esta prueba tiene que cambiar, y ese cambio será visible
   * en el diff en vez de colarse dentro de una extracción.
   */
  it("desde la APK NO se anota el diario (divergencia previa, pendiente de arreglar)", async () => {
    const id = await crearFinalizada();
    mod.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "operario",
      actorNombre: "Anthoni", tecnico: "Anthoni", ahoraMs: Date.now(),
    });
    await respirar();
    expect(await diario(id)).toHaveLength(0);
  });

  it("un estado sin evento de diario no anota nada", async () => {
    const id = await crearFinalizada(null);
    mod.engancharPosteriores({
      assistanceId: id, estado: "en_punto", origen: "oficina", ahoraMs: Date.now(),
    });
    await respirar();
    expect(await diario(id)).toHaveLength(0);
  });

  it("no espera a nadie: devuelve antes de que terminen los enganches", () => {
    const r = mod.engancharPosteriores({
      assistanceId: 1, estado: "finalizada", origen: "oficina", ahoraMs: Date.now(),
    });
    // Si devolviera una promesa, quien llama podría esperarla por descuido y
    // el técnico se quedaría mirando la pantalla.
    expect(r).toBeUndefined();
  });
});
