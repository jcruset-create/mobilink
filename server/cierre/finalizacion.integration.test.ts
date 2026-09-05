/**
 * El post-proceso del cambio de estado, contra PostgreSQL real.
 *
 * Este fichero existe para poder demostrar que el refactor no cambió nada. Lo
 * que había antes eran dos copias del mismo bloque dentro de dos rutas de
 * Express, imposibles de probar sin levantar el servidor; ahora es una función
 * con su contexto, y se le puede preguntar directamente.
 *
 * Y fija que las dos rutas hacen ya LO MISMO. Hubo una fase en que no: la de
 * la APK se saltaba el diario, el estado administrativo y la revisión de
 * documentación. La prueba que lo documentaba está ahora invertida, que es
 * como tenía que verse el arreglo.
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
/**
 * Las asistencias creadas aquí, para poder borrar lo que dejan.
 *
 * `revisarDocumentacionAlFinalizar` programa recordatorios de albarán, y el
 * worker de `correo` —que corre en OTRO fichero contra la misma base— procesa
 * todo lo pendiente que encuentre, sean suyos o no. Sin esta limpieza, sus
 * cuentas salen infladas por asistencias de aquí.
 */
const creadas: number[] = [];

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
  const id = Number(r.rows[0].id);
  creadas.push(id);
  return id;
}

const fila = async (id: number) =>
  (await db.query(`SELECT * FROM roadside_assistances WHERE id = $1`, [id])).rows[0];

/**
 * Espera a que se cumpla una condición, no a que pase un rato.
 *
 * `engancharPosteriores` no devuelve promesa a propósito, así que la prueba
 * tiene que esperar por fuera. Aquí había 250 ms fijos y era una apuesta: el
 * primer enganche es el de TyreControl, que sin red tarda SIETE SEGUNDOS en
 * darse por vencido, y hasta que no termina no se escribe el diario. La prueba
 * pasaba o fallaba según el orden de los ficheros —añadir uno nuevo la
 * rompía—, que es justo lo que no puede hacer una prueba.
 *
 * Sondeando, el caso bueno sigue tardando milisegundos y el malo falla con un
 * mensaje que dice qué se esperaba.
 */
async function hasta<T>(
  descripcion: string, f: () => Promise<T>, ok: (v: T) => boolean, topeMs = 20_000,
): Promise<T> {
  const limite = Date.now() + topeMs;
  let ultimo = await f();
  while (!ok(ultimo) && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 50));
    ultimo = await f();
  }
  if (!ok(ultimo)) throw new Error(`Se agotó la espera de ${descripcion}`);
  return ultimo;
}

/**
 * Para los casos en los que se comprueba que NO se anota nada: no hay
 * condición que esperar, así que se le da margen a la cadena de enganches.
 */
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

afterAll(async () => {
  if (!RUN) return;
  if (creadas.length) {
    await db.query(`DELETE FROM assistance_reminders WHERE "assistanceId" = ANY($1)`,
      [creadas.map(String)]).catch(() => {});
    await db.query(`DELETE FROM roadside_assistances WHERE id = ANY($1)`,
      [creadas]).catch(() => {});
  }
  await db.end().catch(() => {});
});

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

  /*
   * Margen amplio para las que esperan a los enganches.
   *
   * El primero de la cadena es TyreControl y, sin red, tarda unos siete
   * segundos en rendirse; hasta que no vuelve no se escribe el diario. Los
   * 5 s por defecto de vitest se quedan cortos. En un entorno con red el caso
   * bueno sigue tardando milisegundos: esto es techo, no espera.
   */
  const CON_ENGANCHES = 30_000;

  /** Espera a que el diario de una asistencia tenga al menos `n` líneas. */
  const esperarDiario = (id: number, n = 1): Promise<Fila[]> =>
    hasta(`${n} línea(s) de diario de la asistencia ${id}`,
          () => diario(id) as Promise<Fila[]>, (ev) => ev.length >= n);

  it("desde oficina se anota SERVICE_COMPLETED en el diario", async () => {
    const id = await crearFinalizada();
    mod.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "oficina",
      tenantId: null, actorNombre: "Oficina", tecnico: "Anthoni", ahoraMs: Date.now(),
    });
    const ev = await esperarDiario(id);
    expect(ev.map((e: Fila) => e.eventType)).toContain("SERVICE_COMPLETED");
    expect(JSON.parse(String(ev[0].payload)).tecnico).toBe("Anthoni");
  }, CON_ENGANCHES);

  /*
   * Ésta era la prueba de la divergencia, invertida. Antes decía que la APK NO
   * anotaba el diario; ahora dice que sí, que es lo que tenía que pasar desde
   * el principio: el técnico cierra la mayoría de las asistencias.
   */
  it("desde la APK TAMBIÉN se anota SERVICE_COMPLETED", async () => {
    const id = await crearFinalizada();
    mod.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "operario",
      actorNombre: "Anthoni", tecnico: "Anthoni", ahoraMs: Date.now(),
    });
    expect((await esperarDiario(id)).map((e: Fila) => e.eventType)).toContain("SERVICE_COMPLETED");
  }, CON_ENGANCHES);

  it("las dos rutas anotan exactamente lo mismo", async () => {
    const ahora = Date.now();
    const apk = await crearFinalizada();
    const ofi = await crearFinalizada();
    mod.engancharPosteriores({
      assistanceId: apk, estado: "finalizada", origen: "operario",
      actorNombre: "Anthoni", tecnico: "Anthoni", ahoraMs: ahora,
    });
    mod.engancharPosteriores({
      assistanceId: ofi, estado: "finalizada", origen: "oficina",
      actorNombre: "Oficina", tecnico: "Anthoni", ahoraMs: ahora,
    });
    const tipos = (f: Fila[]) => f.map((e) => e.eventType).sort();
    expect(tipos(await esperarDiario(apk))).toEqual(tipos(await esperarDiario(ofi)));
  }, CON_ENGANCHES);

  /*
   * ── La prueba del reintento ─────────────────────────────────────────────
   *
   * Antes esto habría dejado DOS líneas: la clave de deduplicación llevaba la
   * hora, así que dos intentos separados por un milisegundo eran dos claves
   * distintas y el índice único no veía ningún conflicto. Ahora la clave de la
   * finalización se construye con `finishedAtMs`, que se pone una vez.
   */
  it("anotar dos veces la misma finalización deja UNA línea", async () => {
    const id = await crearFinalizada();
    mod.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "operario",
      actorNombre: "Anthoni", ahoraMs: Date.now(),
    });
    await esperarDiario(id);
    mod.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "oficina",
      actorNombre: "Oficina", ahoraMs: Date.now() + 5_000,
    });
    // Aquí sí toca esperar a ciegas: lo que se comprueba es que NO aparece una
    // segunda línea, y a una ausencia no se le puede sondear.
    await respirar();

    const ev = (await diario(id)).filter((e: Fila) => e.eventType === "SERVICE_COMPLETED");
    expect(ev).toHaveLength(1);
  }, CON_ENGANCHES);

  /*
   * Y lo contrario, que también tiene que seguir funcionando: una asistencia
   * puede ir y volver entre dos estados, y esas líneas salen las dos porque
   * pasaron las dos.
   */
  it("un ida y vuelta entre estados SÍ deja las dos líneas", async () => {
    const id = await crearFinalizada(null);
    mod.engancharPosteriores({
      assistanceId: id, estado: "en_camino", origen: "oficina", ahoraMs: Date.now(),
    });
    await esperarDiario(id);
    mod.engancharPosteriores({
      assistanceId: id, estado: "en_camino", origen: "oficina", ahoraMs: Date.now() + 60_000,
    });
    await esperarDiario(id, 2);
    expect((await diario(id)).filter((e: Fila) => e.eventType === "EN_ROUTE")).toHaveLength(2);
  }, CON_ENGANCHES);

  /*
   * El taller sale de la asistencia, no de quien cierra: la sesión de la APK
   * no lleva taller, y en oficina es `null` cuando cierra un administrador.
   * Sin esto, dos asistencias del mismo taller acababan con tenants distintos
   * según quién las hubiera cerrado.
   */
  it("el tenant sale de la asistencia aunque quien cierra no lo aporte", async () => {
    const id = await crearFinalizada(Date.now(), 5150);
    mod.engancharPosteriores({
      assistanceId: id, estado: "finalizada", origen: "operario",
      actorNombre: "Anthoni", ahoraMs: Date.now(),
    });
    await esperarDiario(id);
    const r = await db.query(
      `SELECT "tenantId" FROM assistance_events
        WHERE "sourceSystem" = 'assist' AND "assistanceId" = $1`, [String(id)]);
    expect(r.rows[0].tenantId).toBe("5150");
  }, CON_ENGANCHES);

  it("un estado sin evento de diario no anota nada", async () => {
    const id = await crearFinalizada(null);
    mod.engancharPosteriores({
      assistanceId: id, estado: "en_punto", origen: "oficina", ahoraMs: Date.now(),
    });
    await respirar();
    expect(await diario(id)).toHaveLength(0);
  }, CON_ENGANCHES);

  it("no espera a nadie: devuelve antes de que terminen los enganches", () => {
    const r = mod.engancharPosteriores({
      assistanceId: 1, estado: "finalizada", origen: "oficina", ahoraMs: Date.now(),
    });
    // Si devolviera una promesa, quien llama podría esperarla por descuido y
    // el técnico se quedaría mirando la pantalla.
    expect(r).toBeUndefined();
  });
});
