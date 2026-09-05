/**
 * El cuadro de mando, contra PostgreSQL real.
 *
 * Lo que se fija aquí no es «que salgan números», es que no salgan números
 * FALSOS, que es el único daño que puede hacer una pantalla de métricas:
 *
 *  · conductor y cliente no se mezclan nunca en una media;
 *  · «sin datos» sale como `null` y jamás como cero;
 *  · un taller no ve ni una cifra de otro;
 *  · los límites del periodo son los que se piden, sin colarse un vecino;
 *  · un motivo de selección múltiple cuenta una vez por respuesta;
 *  · daño ALEGADO y daño CONFIRMADO son dos cifras distintas;
 *  · los normalizados «por cada 100» usan el denominador que dicen usar.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");
let met: typeof import("./metricas.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;

/**
 * Un taller nuevo para CADA test.
 *
 * Todo lo de aquí se agrega por tenant y por periodo, así que si dos tests
 * compartieran taller el segundo contaría también lo del primero y las cifras
 * dependerían del orden de ejecución. Un id por test deja cada uno con su
 * propia base vacía sin tener que borrar entre medias.
 */
const BASE_TALLER = 7_100_000;
let secuenciaTaller = 0;
let TALLER = BASE_TALLER;
let OTRO = BASE_TALLER;
/** Un taller que no se toca nunca: sirve para comprobar el «sin datos» limpio. */
let VACIO = BASE_TALLER;

const DIA = 86_400_000;
/** Un «ahora» fijo, para que el periodo del test no dependa del reloj. */
const AHORA = Date.UTC(2026, 4, 20, 12, 0, 0);
const PERIODO = { desdeMs: AHORA - 10 * DIA, hastaMs: AHORA };

const creadas: number[] = [];

async function crearCliente(nombre?: string) {
  const r = await db.query(
    `INSERT INTO connect_clients (name, "contactPhone", "createdAtMs", "updatedAtMs")
     VALUES ($1,'900111222',$2,$2) RETURNING id`,
    [nombre ?? `Cliente ${sufijo}-${++n}`, AHORA],
  );
  return Number(r.rows[0].id);
}

async function crearProveedor(nombre?: string) {
  const r = await db.query(
    `INSERT INTO connect_workshops (name, latitude, longitude, "createdAtMs", "updatedAtMs")
     VALUES ($1,41.1189,1.2445,$2,$2) RETURNING id`,
    [nombre ?? `Taller ${sufijo}-${++n}`, AHORA],
  );
  return Number(r.rows[0].id);
}

type OpcionesAsistencia = {
  tallerId?: number;
  clienteId?: number | null;
  proveedorId?: number | null;
  /** Cuándo se dio por terminada: es la fecha que filtra el periodo. */
  finishedAtMs?: number;
  /** Cuándo se pidió: es la que decide la franja horaria. */
  createdAtMs?: number;
};

async function crearAsistencia(o: OpcionesAsistencia = {}) {
  const fin = o.finishedAtMs ?? AHORA - DIA;
  const r = await db.query(
    `INSERT INTO roadside_assistances
       (status, priority, "customerName", "customerPhone", address, plate,
        "descripcionAveria", "trackingToken", "clienteFacturacionId", "proveedorTallerId",
        "tallerId", "createdAtMs", "finishedAtMs", "updatedAtMs")
     VALUES ('en_camino_base','normal','Contacto','600999888','AP-7','1234ABC','Rueda',
             $1,$2,$3,$4,$5,$6,$6)
     RETURNING id`,
    [`tok-met-${sufijo}-${++n}`, o.clienteId ?? null, o.proveedorId ?? null,
     o.tallerId ?? TALLER, o.createdAtMs ?? fin - 3_600_000, fin],
  );
  const id = Number(r.rows[0].id);
  creadas.push(id);
  return id;
}

/** Crea la encuesta del rol, la contesta y devuelve el id de la instancia. */
async function responder(
  assistanceId: number, rol: "DRIVER" | "CUSTOMER", respuestas: unknown[],
  opciones: { tallerId?: number; completedAtMs?: number } = {},
) {
  const tenantId = String(opciones.tallerId ?? TALLER);
  const ambito = { sourceSystem: "assist" as const, tenantId, assistanceId: String(assistanceId) };
  const c = await svc.crearSurveyInstance({ ambito, recipientRole: rol });
  if (c.estado !== "created") throw new Error(`no creada: ${c.estado}`);
  const r = await svc.completarSurvey({
    instanceId: c.instancia.id, ambito, respuestas: respuestas as never,
  });
  /*
   * `completedAtMs` se pone con el reloj real. Las métricas filtran por él, así
   * que se envejece a mano hasta dentro del periodo del test; si no, todo caería
   * fuera y las consultas devolverían cero sin que eso probara nada.
   */
  const cuando = opciones.completedAtMs ?? AHORA - DIA;
  await db.query(`UPDATE survey_responses SET "completedAtMs" = $1 WHERE "surveyInstanceId" = $2`,
                 [cuando, c.instancia.id]);
  await db.query(`UPDATE survey_instances SET "createdAtMs" = $1 WHERE id = $2`,
                 [cuando, c.instancia.id]);
  await db.query(`UPDATE quality_cases SET "createdAtMs" = $1 WHERE "surveyResponseId" = $2`,
                 [cuando, r.responseId]);
  return { instanceId: c.instancia.id, responseId: r.responseId, casoId: r.qualityCaseId };
}

/**
 * Una respuesta completa para el rol que toque.
 *
 * Cada plantilla tiene sus obligatorias —el conductor puntúa profesionalidad,
 * el cliente rapidez y seguimiento— y `completarSurvey` las exige, así que el
 * fixture las rellena en vez de rodear la validación.
 */
const notas = (
  rol: "DRIVER" | "CUSTOMER", overall: number, resolution = "YES", extra: unknown[] = [],
) => [
  { code: "overall_rating", value: overall },
  ...(rol === "DRIVER"
    ? [{ code: "professional_rating", value: overall }]
    : [{ code: "speed_rating", value: overall }, { code: "tracking_rating", value: overall }]),
  { code: "resolution", value: resolution },
  ...extra,
];

const metricas = (extra: Partial<import("./metricas.ts").Filtros> = {}, taller: string | null = String(TALLER)) =>
  met.calcularMetricas({ ...PERIODO, ...extra }, taller);

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  svc = await import("./servicio.ts");
  met = await import("./metricas.ts");
  await limpiar();
});

beforeEach(() => {
  if (!RUN) return;
  TALLER = BASE_TALLER + ++secuenciaTaller * 10;
  OTRO = TALLER + 1;
  VACIO = TALLER + 2;
});

/** Se lleva por delante todo lo que este fichero pueda haber dejado. */
async function limpiar() {
  const tope = BASE_TALLER + 100_000;
  const ids = await db.query(
    `SELECT id FROM roadside_assistances WHERE "tallerId" BETWEEN $1 AND $2`, [BASE_TALLER, tope]);
  const lista = ids.rows.map((r) => String(r.id));
  if (lista.length) {
    await db.query(`DELETE FROM quality_cases WHERE "assistanceId" = ANY($1)`, [lista]);
    await db.query(`DELETE FROM survey_instances WHERE "assistanceId" = ANY($1)`, [lista]);
  }
  await db.query(`DELETE FROM roadside_assistances WHERE "tallerId" BETWEEN $1 AND $2`,
                 [BASE_TALLER, tope]);
}

afterAll(async () => {
  if (!RUN) return;
  await limpiar();
  await db.end().catch(() => {});
});

/* ── Medias por rol ──────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("medias por rol", () => {
  it("conductor y cliente se calculan por separado y no se mezclan", async () => {
    const a1 = await crearAsistencia();
    const a2 = await crearAsistencia();
    await responder(a1, "DRIVER", notas("DRIVER", 5));
    await responder(a2, "DRIVER", notas("DRIVER", 3));
    await responder(a1, "CUSTOMER", notas("CUSTOMER", 1, "NO"));

    const m = await metricas();

    expect(m.driver.overall).toEqual({ media: 4, respuestas: 2 });
    expect(m.customer.overall).toEqual({ media: 1, respuestas: 1 });
    /*
     * Lo importante: NO existe una media única. Si alguien la calculara con
     * estas tres respuestas saldría 3,0, un número que no describe ni a los
     * conductores (4,0) ni al cliente (1,0).
     */
    expect(m).not.toHaveProperty("overall");
  });

  it("sin respuestas devuelve null, nunca cero", async () => {
    await crearAsistencia();
    const m = await metricas({}, String(VACIO));
    expect(m.driver.overall.media).toBeNull();
    expect(m.driver.overall.respuestas).toBe(0);
    expect(m.customer.overall.media).toBeNull();
    expect(m.driver.resolucion.siPct).toBeNull();
    expect(m.driver.negativasPct).toBeNull();
  });
});

/* ── Distribución ────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("distribución de estrellas", () => {
  it("cuenta cada estrella y los porcentajes suman 100", async () => {
    for (const nota of [5, 5, 4, 1]) {
      await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", nota));
    }
    const m = await metricas();
    const por = new Map(m.driver.distribucion.map((d) => [d.estrella, d.n]));
    expect(por.get(5)).toBe(2);
    expect(por.get(4)).toBe(1);
    expect(por.get(1)).toBe(1);
    expect(por.get(3)).toBe(0);
    expect(m.driver.distribucion).toHaveLength(5);
    const suma = m.driver.distribucion.reduce((t, d) => t + d.pct, 0);
    expect(Math.round(suma)).toBe(100);
  });
});

/* ── Resolución ──────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("resolución", () => {
  it("reparte sí / parcial / no sobre el total de respuestas", async () => {
    await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", 5, "YES"));
    await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", 4, "YES"));
    await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", 3, "PARTIAL"));
    await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", 2, "NO"));

    const m = await metricas();
    expect(m.driver.resolucion).toMatchObject({ si: 2, parcial: 1, no: 1, siPct: 50 });
    // Negativa = nota <= 2 O resolución NO. Aquí es la misma respuesta: una.
    expect(m.driver.negativasPct).toBe(25);
  });
});

/* ── Periodo ─────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("límites del periodo", () => {
  it("incluye los extremos y deja fuera lo de un milisegundo más allá", async () => {
    const dentroIni = await crearAsistencia({ finishedAtMs: PERIODO.desdeMs });
    const dentroFin = await crearAsistencia({ finishedAtMs: PERIODO.hastaMs });
    const fuera = await crearAsistencia({ finishedAtMs: PERIODO.desdeMs - 1 });
    await responder(dentroIni, "DRIVER", notas("DRIVER", 5), { completedAtMs: PERIODO.desdeMs });
    await responder(dentroFin, "DRIVER", notas("DRIVER", 5), { completedAtMs: PERIODO.hastaMs });
    await responder(fuera, "DRIVER", notas("DRIVER", 1), { completedAtMs: PERIODO.desdeMs - 1 });

    const m = await metricas();
    expect(m.resumen.asistenciasFinalizadas).toBe(2);
    expect(m.driver.overall).toEqual({ media: 5, respuestas: 2 });
  });
});

/* ── Aislamiento entre talleres ──────────────────────────────────────────── */

describe.skipIf(!RUN)("aislamiento por taller", () => {
  it("un taller no ve ni una cifra del otro", async () => {
    const mio = await crearAsistencia({ tallerId: TALLER });
    const suyo = await crearAsistencia({ tallerId: OTRO });
    await responder(mio, "DRIVER", notas("DRIVER", 5), { tallerId: TALLER });
    await responder(suyo, "DRIVER", notas("DRIVER", 1), { tallerId: OTRO });

    const a = await metricas({}, String(TALLER));
    const b = await metricas({}, String(OTRO));

    expect(a.driver.overall).toEqual({ media: 5, respuestas: 1 });
    expect(b.driver.overall).toEqual({ media: 1, respuestas: 1 });
    expect(a.resumen.asistenciasFinalizadas).toBe(1);
    expect(b.resumen.asistenciasFinalizadas).toBe(1);
  });
});

/* ── Filtros ─────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("filtros de cliente y proveedor", () => {
  it("acotan las medias y las tablas", async () => {
    const c1 = await crearCliente();
    const c2 = await crearCliente();
    const p1 = await crearProveedor();
    const p2 = await crearProveedor();

    await responder(await crearAsistencia({ clienteId: c1, proveedorId: p1 }), "DRIVER", notas("DRIVER", 5));
    await responder(await crearAsistencia({ clienteId: c2, proveedorId: p2 }), "DRIVER", notas("DRIVER", 1));

    const soloC1 = await metricas({ clienteId: c1 });
    expect(soloC1.driver.overall).toEqual({ media: 5, respuestas: 1 });
    expect(soloC1.resumen.asistenciasFinalizadas).toBe(1);

    const soloP2 = await metricas({ proveedorTallerId: p2 });
    expect(soloP2.driver.overall).toEqual({ media: 1, respuestas: 1 });
  });
});

/* ── Proveedores ─────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("tabla de proveedores", () => {
  it("solo le atribuye la valoración del conductor", async () => {
    const p = await crearProveedor("Grúas Nervión");
    const a = await crearAsistencia({ proveedorId: p });
    await responder(a, "DRIVER", notas("DRIVER", 5));
    // El cliente valora otra cosa —la gestión— y no debe tocar la nota del taller.
    await responder(a, "CUSTOMER", notas("CUSTOMER", 1, "NO"));

    const m = await metricas();
    const fila = m.proveedores.find((x) => x.proveedorId === p)!;
    expect(fila.nombre).toBe("Grúas Nervión");
    expect(fila.respuestasDriver).toBe(1);
    expect(fila.satisfaccionDriver).toBe(5);
  });

  it("sin respuestas la satisfacción es null y no cero", async () => {
    const p = await crearProveedor();
    await crearAsistencia({ proveedorId: p });
    const m = await metricas();
    const fila = m.proveedores.find((x) => x.proveedorId === p)!;
    expect(fila.asistencias).toBe(1);
    expect(fila.satisfaccionDriver).toBeNull();
    expect(fila.suficiente).toBe(false);
  });

  it("marca como suficiente a partir del mínimo de respuestas", async () => {
    const p = await crearProveedor();
    for (let i = 0; i < met.MINIMO_RESPUESTAS_RANKING; i++) {
      await responder(await crearAsistencia({ proveedorId: p }), "DRIVER", notas("DRIVER", 4));
    }
    const m = await metricas();
    const fila = m.proveedores.find((x) => x.proveedorId === p)!;
    expect(fila.respuestasDriver).toBe(met.MINIMO_RESPUESTAS_RANKING);
    expect(fila.suficiente).toBe(true);
  });

  it("varios expedientes en una asistencia no multiplican sus respuestas", async () => {
    const p = await crearProveedor();
    const a = await crearAsistencia({ proveedorId: p });
    // Una respuesta mala abre su expediente…
    const { casoId } = await responder(a, "DRIVER", notas("DRIVER", 1, "NO"));
    expect(casoId).toBeTruthy();
    // …y se añade otro a mano sobre la misma asistencia.
    await db.query(
      `INSERT INTO quality_cases
         ("sourceSystem","tenantId","assistanceId",reason,priority,status,"createdAtMs","updatedAtMs")
       VALUES ('assist',$1,$2,'LOW_RATING','HIGH','NEW',$3,$3)`,
      [String(TALLER), String(a), AHORA - DIA],
    );

    const m = await metricas();
    const fila = m.proveedores.find((x) => x.proveedorId === p)!;
    // Sin pre-agregar por asistencia, el producto cartesiano la contaría dos veces.
    expect(fila.respuestasDriver).toBe(1);
    expect(fila.casos).toBe(2);
    expect(fila.asistencias).toBe(1);
  });
});

/* ── Clientes ────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("tabla de clientes", () => {
  it("guarda las dos notas por separado", async () => {
    const c = await crearCliente("Seguros Levante");
    const a = await crearAsistencia({ clienteId: c });
    await responder(a, "DRIVER", notas("DRIVER", 4));
    await responder(a, "CUSTOMER", notas("CUSTOMER", 2, "PARTIAL"));

    const m = await metricas();
    const fila = m.clientes.find((x) => x.clienteId === c)!;
    expect(fila.nombre).toBe("Seguros Levante");
    expect(fila.satisfaccionDriver).toBe(4);
    expect(fila.satisfaccionCustomer).toBe(2);
    expect(fila.asistencias).toBe(1);
  });
});

/* ── Motivos negativos ───────────────────────────────────────────────────── */

describe.skipIf(!RUN)("motivos negativos", () => {
  it("cuenta cada motivo una vez por respuesta aunque se marquen varios", async () => {
    await responder(await crearAsistencia(), "DRIVER",
      notas("DRIVER", 1, "NO", [{ code: "negative_reasons", value: ["LONG_WAIT", "VEHICLE_DAMAGE"] }]));
    await responder(await crearAsistencia(), "DRIVER",
      notas("DRIVER", 2, "NO", [{ code: "negative_reasons", value: ["LONG_WAIT"] }]));

    const m = await metricas();
    const por = new Map(m.motivosNegativos.map((x) => [x.motivo, x]));
    expect(por.get("LONG_WAIT")!.n).toBe(2);
    expect(por.get("VEHICLE_DAMAGE")!.n).toBe(1);
    // Es selección múltiple: la suma de porcentajes puede pasar del 100 %.
    expect(por.get("LONG_WAIT")!.pctSobreRespuestas).toBe(100);
    expect(por.get("VEHICLE_DAMAGE")!.pctSobreRespuestas).toBe(50);
  });
});

/* ── Calidad ─────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("expedientes de calidad", () => {
  it("separa el daño alegado del confirmado", async () => {
    const alegado = await responder(await crearAsistencia(), "DRIVER",
      notas("DRIVER", 1, "NO", [{ code: "negative_reasons", value: ["VEHICLE_DAMAGE"] }]));
    const confirmado = await responder(await crearAsistencia(), "DRIVER",
      notas("DRIVER", 1, "NO", [{ code: "negative_reasons", value: ["VEHICLE_DAMAGE"] }]));
    await db.query(
      `UPDATE quality_cases SET status = 'CLOSED', resolution = 'DAMAGE_CONFIRMED',
              "resolvedAtMs" = $2, "closedAtMs" = $2 WHERE id = $1`,
      [confirmado.casoId, AHORA - DIA + 3_600_000],
    );

    const m = await metricas();
    expect(m.calidad.danos.alegados).toBe(2);
    /*
     * Dos alegaciones, UN daño confirmado. Enseñar «Daños: 2» convertiría una
     * queja sin comprobar en una culpa del proveedor.
     */
    expect(m.calidad.danos.confirmados).toBe(1);
    expect(m.calidad.danos.sinCerrar).toBe(1);
    expect(alegado.casoId).toBeTruthy();
  });

  it("los tiempos solo cuentan lo que ya se cerró", async () => {
    const abierto = await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", 1, "NO"));
    const cerrado = await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", 1, "NO"));
    await db.query(
      `UPDATE quality_cases SET status = 'RESOLVED', resolution = 'PROVIDER_WARNED',
              "resolvedAtMs" = "createdAtMs" + 7200000 WHERE id = $1`,
      [cerrado.casoId],
    );

    const m = await metricas();
    // Media de los resueltos: 2 h. El caso abierto NO entra como cero.
    expect(m.calidad.tiempos.resueltos).toBe(1);
    expect(m.calidad.tiempos.hastaResolverMs).toBe(7_200_000);
    expect(m.calidad.tiempos.hastaCerrarMs).toBeNull();
    expect(abierto.casoId).toBeTruthy();
  });

  it("los «por cada 100» usan el denominador que dicen", async () => {
    // Cuatro asistencias, cuatro respuestas, dos de ellas malas → dos casos.
    for (const nota of [5, 5, 1, 1]) {
      await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", nota, nota === 1 ? "NO" : "YES"));
    }
    const m = await metricas();
    expect(m.resumen.asistenciasFinalizadas).toBe(4);
    expect(m.calidad.creados).toBe(2);
    expect(m.calidad.porCada100Respuestas).toBe(50);
    expect(m.calidad.porCada100Asistencias).toBe(50);
  });

  it("sin nada en el periodo los normalizados son null, no cero", async () => {
    const m = await metricas({}, String(VACIO));
    expect(m.calidad.creados).toBe(0);
    expect(m.calidad.porCada100Respuestas).toBeNull();
    expect(m.calidad.porCada100Asistencias).toBeNull();
  });
});

/* ── Tasa de respuesta ───────────────────────────────────────────────────── */

describe.skipIf(!RUN)("tasa de respuesta", () => {
  it("es null mientras no se haya entregado ninguna encuesta de verdad", async () => {
    await responder(await crearAsistencia(), "DRIVER", notas("DRIVER", 5));
    const m = await metricas();
    expect(m.resumen.envio.hayEntregas).toBe(false);
    /*
     * Hay una respuesta y una encuesta generada: la división daría 100 %. Se
     * devuelve null porque ese 100 % mediría accesos manuales de prueba, no la
     * eficacia de un envío que todavía no existe.
     */
    expect(m.resumen.tasaRespuestaPct).toBeNull();
    expect(m.resumen.envio.motivo).toBeTruthy();
  });
});

/* ── Tendencia y franjas ─────────────────────────────────────────────────── */

describe.skipIf(!RUN)("tendencia", () => {
  it("agrupa por día en periodos cortos y separa los roles", async () => {
    const dia1 = AHORA - 3 * DIA;
    const dia2 = AHORA - 2 * DIA;
    await responder(await crearAsistencia({ finishedAtMs: dia1 }), "DRIVER", notas("DRIVER", 5),
                    { completedAtMs: dia1 });
    await responder(await crearAsistencia({ finishedAtMs: dia2 }), "CUSTOMER", notas("CUSTOMER", 3),
                    { completedAtMs: dia2 });

    const m = await metricas();
    expect(m.tendencia.granularidad).toBe("dia");
    expect(m.tendencia.puntos.length).toBeGreaterThanOrEqual(2);
    const conDriver = m.tendencia.puntos.filter((p) => p.driver.respuestas > 0);
    const conCustomer = m.tendencia.puntos.filter((p) => p.customer.respuestas > 0);
    expect(conDriver).toHaveLength(1);
    expect(conCustomer).toHaveLength(1);
    // El tramo del cliente no inventa una media de conductor a cero.
    expect(conCustomer[0].driver.media).toBeNull();
  });

  it("un periodo largo se agrupa más grueso", async () => {
    const m = await met.calcularMetricas(
      { desdeMs: AHORA - 200 * DIA, hastaMs: AHORA }, String(TALLER));
    expect(m.tendencia.granularidad).toBe("semana");
    expect(m.periodo.dias).toBe(200);
  });
});

describe.skipIf(!RUN)("franjas horarias", () => {
  it("clasifica por la hora de la solicitud", async () => {
    const base = Date.UTC(2026, 4, 18);
    await crearAsistencia({ createdAtMs: base + 3 * 3600_000, finishedAtMs: base + 5 * 3600_000 });
    await crearAsistencia({ createdAtMs: base + 14 * 3600_000, finishedAtMs: base + 15 * 3600_000 });

    const m = await metricas();
    const por = new Map(m.franjas.map((f) => [f.franja, f.asistencias]));
    expect(por.get("00-06")).toBe(1);
    expect(por.get("12-18")).toBe(1);
  });
});

/* ── Limitaciones ────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("limitaciones", () => {
  it("las declara el propio servidor, para que la pantalla las enseñe", async () => {
    const m = await metricas();
    expect(m.limitaciones.length).toBeGreaterThan(0);
    expect(m.limitaciones.join(" ")).toMatch(/tipo de asistencia/i);
    expect(m.limitaciones.join(" ")).toMatch(/geográfica/i);
  });
});
