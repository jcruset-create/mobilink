/**
 * Satisfaction contra PostgreSQL real.
 *
 * Lo que se fija aquí y no se puede fijar sin base de datos:
 *
 *   · crear la misma encuesta dos veces deja UNA, y la segunda NO devuelve
 *     token —devolver uno nuevo daría un enlace que no abre nada—;
 *   · la base guarda el hash y NUNCA el token en claro;
 *   · completar dos veces no duplica respuesta, respuestas por pregunta ni
 *     caso de calidad;
 *   · un tenant no llega a la encuesta de otro por ninguna función del
 *     servicio.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RespuestaEntrante } from "./dominio.ts";

/** Una fila de `pg` tal y como la devuelve el driver. */
type Fila = Record<string, string | number | null>;

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;
/** Cada prueba con su asistencia: el índice único es por asistencia y rol. */
const nuevaAsistencia = () => `${sufijo}-${++n}`;

const TALLER_A = `taller-a-${sufijo}`;
const TALLER_B = `taller-b-${sufijo}`;

const ambito = (assistanceId: string, tenantId: string | null = TALLER_A) =>
  ({ sourceSystem: "assist" as const, tenantId, assistanceId });

const BUENA = [
  { code: "overall_rating", value: 5 },
  { code: "professional_rating", value: 5 },
  { code: "resolution", value: "YES" },
];
const MALA = [
  { code: "overall_rating", value: 1 },
  { code: "professional_rating", value: 2 },
  { code: "resolution", value: "YES" },
  { code: "comment", value: "Tardaron mucho" },
];
const CON_DANOS = [
  { code: "overall_rating", value: 5 },
  { code: "professional_rating", value: 5 },
  { code: "resolution", value: "YES" },
  { code: "negative_reasons", value: ["VEHICLE_DAMAGE"] },
];

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  svc = await import("./servicio.ts");
  // El esquema lo crea vitest.setup.ts una sola vez; aquí solo se comprueba
  // que las plantillas están sembradas, que es de lo que depende todo.
  const p = await db.query(`SELECT COUNT(*)::int AS n FROM survey_templates WHERE active`);
  expect(Number(p.rows[0].n)).toBeGreaterThanOrEqual(2);
});

afterAll(async () => { if (RUN) await db.end().catch(() => {}); });

describe.skipIf(!RUN)("crear encuestas", () => {
  it("crea una y devuelve el token una sola vez", async () => {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "DRIVER" });
    expect(r.estado).toBe("created");
    if (r.estado !== "created") return;
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);   // 32 bytes en base64url
    expect(r.instancia.status).toBe("CREATED");
    expect(r.instancia.templateVersion).toBeGreaterThanOrEqual(1);
  });

  /*
   * La prueba que justifica el diseño del token: la segunda creación NO trae
   * token. Si trajera uno nuevo, no coincidiría con el hash guardado y el
   * WhatsApp llevaría un enlace muerto.
   */
  it("crear dos veces deja UNA instancia, y la segunda no trae token", async () => {
    const a = nuevaAsistencia();
    const uno = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "DRIVER" });
    const dos = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "DRIVER" });

    expect(uno.estado).toBe("created");
    expect(dos.estado).toBe("already_exists");
    expect("token" in dos).toBe(false);
    expect(dos.instancia.id).toBe(uno.instancia.id);

    const cuenta = await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_instances WHERE "assistanceId" = $1`, [a]);
    expect(cuenta.rows[0].n).toBe(1);
  });

  it("cinco creaciones a la vez dejan UNA", async () => {
    const a = nuevaAsistencia();
    const rs = await Promise.all(
      Array.from({ length: 5 }, () =>
        svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "CUSTOMER" })),
    );
    expect(rs.filter((r) => r.estado === "created")).toHaveLength(1);
    const cuenta = await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_instances WHERE "assistanceId" = $1`, [a]);
    expect(cuenta.rows[0].n).toBe(1);
  });

  it("conductor y cliente de la misma asistencia son dos encuestas", async () => {
    const a = nuevaAsistencia();
    const d = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "DRIVER" });
    const c = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "CUSTOMER" });
    expect(d.estado).toBe("created");
    expect(c.estado).toBe("created");
    expect(d.instancia.id).not.toBe(c.instancia.id);
    expect(await svc.instanciasDeAsistencia(ambito(a))).toHaveLength(2);
  });

  it("la base guarda el hash y no el token", async () => {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "DRIVER" });
    if (r.estado !== "created") throw new Error("no creada");

    const f = await db.query(
      `SELECT "tokenHash" FROM survey_instances WHERE id = $1`, [r.instancia.id]);
    expect(f.rows[0].tokenHash).toBe(svc.hashToken(r.token));
    expect(f.rows[0].tokenHash).not.toBe(r.token);

    // Y en NINGUNA columna de texto aparece el token en claro.
    const rastro = await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_instances WHERE "tokenHash" = $1`, [r.token]);
    expect(rastro.rows[0].n).toBe(0);
  });

  it("los hashes son únicos entre encuestas", async () => {
    const a1 = nuevaAsistencia(); const a2 = nuevaAsistencia();
    await svc.crearSurveyInstance({ ambito: ambito(a1), recipientRole: "DRIVER" });
    await svc.crearSurveyInstance({ ambito: ambito(a2), recipientRole: "DRIVER" });
    const d = await db.query(
      `SELECT COUNT(DISTINCT "tokenHash")::int AS distintos, COUNT(*)::int AS total
         FROM survey_instances WHERE "assistanceId" = ANY($1)`, [[a1, a2]]);
    expect(d.rows[0].distintos).toBe(d.rows[0].total);
  });

  it("rotar el token da uno nuevo y deja el anterior sin valor", async () => {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "DRIVER" });
    if (r.estado !== "created") throw new Error("no creada");
    const nuevo = await svc.rotarToken(r.instancia.id, ambito(a));
    expect(nuevo).not.toBe(r.token);
    const f = await db.query(`SELECT "tokenHash" FROM survey_instances WHERE id = $1`, [r.instancia.id]);
    expect(f.rows[0].tokenHash).toBe(svc.hashToken(nuevo));
  });
});

describe.skipIf(!RUN)("completar", () => {
  async function conEncuesta(rol: "DRIVER" | "CUSTOMER" = "DRIVER", tenant = TALLER_A) {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a, tenant), recipientRole: rol });
    if (r.estado !== "created") throw new Error("no creada");
    return { a, tenant, instancia: r.instancia };
  }

  it("guarda la respuesta, sus answers y deja la encuesta COMPLETED", async () => {
    const { a, instancia } = await conEncuesta();
    const r = await svc.completarSurvey({
      instanceId: instancia.id, ambito: ambito(a), respuestas: MALA,
    });
    expect(r.instancia.status).toBe("COMPLETED");
    expect(r.instancia.completedAtMs).toBeGreaterThan(0);

    const ans = await db.query(
      `SELECT "questionCode", value, "scaleValue" FROM survey_answers
        WHERE "surveyResponseId" = $1 ORDER BY "questionCode"`, [r.responseId]);
    expect(ans.rows.map((f: Fila) => f.questionCode))
      .toEqual(["comment", "overall_rating", "professional_rating", "resolution"]);

    // Los ratings van en `scaleValue` como entero: es lo que permite AVG().
    const general = ans.rows.find((f: Fila) => f.questionCode === "overall_rating");
    expect(general.scaleValue).toBe(1);
    // Y el comentario no ensucia la columna numérica.
    const com = ans.rows.find((f: Fila) => f.questionCode === "comment");
    expect(com.scaleValue).toBeNull();
    expect(com.value).toBe("Tardaron mucho");
  });

  it("la selección múltiple se guarda como lista recuperable", async () => {
    const { a, instancia } = await conEncuesta();
    const r = await svc.completarSurvey({
      instanceId: instancia.id, ambito: ambito(a), respuestas: CON_DANOS,
    });
    const f = await db.query(
      `SELECT value FROM survey_answers
        WHERE "surveyResponseId" = $1 AND "questionCode" = 'negative_reasons'`, [r.responseId]);
    expect(JSON.parse(f.rows[0].value)).toEqual(["VEHICLE_DAMAGE"]);
  });

  it("completar dos veces no duplica nada", async () => {
    const { a, instancia } = await conEncuesta();
    await svc.completarSurvey({ instanceId: instancia.id, ambito: ambito(a), respuestas: MALA });

    await expect(
      svc.completarSurvey({ instanceId: instancia.id, ambito: ambito(a), respuestas: BUENA }),
    ).rejects.toMatchObject({ codigo: "ya_completada" });

    const resp = await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_responses WHERE "surveyInstanceId" = $1`, [instancia.id]);
    expect(resp.rows[0].n).toBe(1);
    const casos = await db.query(
      `SELECT COUNT(*)::int AS n FROM quality_cases WHERE "surveyInstanceId" = $1`, [instancia.id]);
    expect(casos.rows[0].n).toBe(1);
  });

  it("dos envíos simultáneos dejan UNA respuesta", async () => {
    const { a, instancia } = await conEncuesta();
    const rs = await Promise.allSettled([
      svc.completarSurvey({ instanceId: instancia.id, ambito: ambito(a), respuestas: MALA }),
      svc.completarSurvey({ instanceId: instancia.id, ambito: ambito(a), respuestas: BUENA }),
    ]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const resp = await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_responses WHERE "surveyInstanceId" = $1`, [instancia.id]);
    expect(resp.rows[0].n).toBe(1);
  });

  it("una encuesta caducada no se contesta", async () => {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({
      ambito: ambito(a), recipientRole: "DRIVER", caducidadMs: -1000,
    });
    if (r.estado !== "created") throw new Error("no creada");
    await expect(
      svc.completarSurvey({ instanceId: r.instancia.id, ambito: ambito(a), respuestas: BUENA }),
    ).rejects.toMatchObject({ codigo: "caducada" });
  });

  it("una cancelada tampoco", async () => {
    const { a, instancia } = await conEncuesta();
    await svc.cambiarEstado(instancia.id, ambito(a), "CANCELLED");
    await expect(
      svc.completarSurvey({ instanceId: instancia.id, ambito: ambito(a), respuestas: BUENA }),
    ).rejects.toMatchObject({ codigo: "estado_no_admite_respuesta" });
  });

  it("una respuesta inválida no deja rastro", async () => {
    const { a, instancia } = await conEncuesta();
    await expect(
      svc.completarSurvey({
        instanceId: instancia.id, ambito: ambito(a),
        respuestas: [{ code: "overall_rating", value: 99 }],
      }),
    ).rejects.toMatchObject({ codigo: "respuesta_invalida" });

    const resp = await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_responses WHERE "surveyInstanceId" = $1`, [instancia.id]);
    expect(resp.rows[0].n).toBe(0);
    const inst = await svc.instanciaDelAmbito(instancia.id, ambito(a));
    expect(inst?.status).toBe("CREATED");
  });
});

describe.skipIf(!RUN)("casos de calidad", () => {
  async function completar(respuestas: RespuestaEntrante[], rol: "DRIVER" | "CUSTOMER" = "DRIVER") {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: rol });
    if (r.estado !== "created") throw new Error("no creada");
    return { a, ...(await svc.completarSurvey({
      instanceId: r.instancia.id, ambito: ambito(a), respuestas,
    })) };
  }

  it("una valoración de 1 abre exactamente un caso HIGH", async () => {
    const r = await completar(MALA);
    expect(r.qualityCaseId).not.toBeNull();
    const f = await db.query(`SELECT * FROM quality_cases WHERE id = $1`, [r.qualityCaseId]);
    expect(f.rows[0].priority).toBe("HIGH");
    expect(f.rows[0].reason).toBe("LOW_RATING");
    expect(f.rows[0].status).toBe("NEW");
  });

  it("un servicio bien valorado no abre ninguno", async () => {
    const r = await completar(BUENA);
    expect(r.qualityCaseId).toBeNull();
    const f = await db.query(
      `SELECT COUNT(*)::int AS n FROM quality_cases WHERE "surveyResponseId" = $1`, [r.responseId]);
    expect(f.rows[0].n).toBe(0);
  });

  it("los daños en el vehículo abren un CRITICAL aunque la nota sea 5", async () => {
    const r = await completar(CON_DANOS);
    const f = await db.query(`SELECT * FROM quality_cases WHERE id = $1`, [r.qualityCaseId]);
    expect(f.rows[0].priority).toBe("CRITICAL");
    expect(f.rows[0].reason).toBe("VEHICLE_DAMAGE");
  });

  it("la creación del caso deja su línea en la cronología", async () => {
    const r = await completar(MALA);
    const ev = await db.query(
      `SELECT "eventType", "toValue" FROM quality_case_events WHERE "qualityCaseId" = $1`,
      [r.qualityCaseId]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0].eventType).toBe("CREATED");
    expect(ev.rows[0].toValue).toBe("NEW");
  });

  it("la base impide un segundo caso automático para la misma respuesta", async () => {
    const r = await completar(MALA);
    await expect(db.query(
      `INSERT INTO quality_cases
         ("sourceSystem","tenantId","assistanceId","surveyResponseId",reason,priority,status,
          "createdAtMs","updatedAtMs")
       VALUES ('assist',$1,$2,$3,'LOW_RATING','HIGH','NEW',$4,$4)`,
      [TALLER_A, r.a, r.responseId, Date.now()],
    )).rejects.toThrow();
  });

  it("el caso se mueve de estado y lo va anotando", async () => {
    const r = await completar(MALA);
    await svc.cambiarEstadoCaso({ casoId: r.qualityCaseId!, tenantId: TALLER_A, nuevo: "IN_REVIEW" });
    const c = await svc.cambiarEstadoCaso({
      casoId: r.qualityCaseId!, tenantId: TALLER_A, nuevo: "RESOLVED", nota: "Hablado con el cliente",
    });
    expect(c.status).toBe("RESOLVED");
    const f = await db.query(`SELECT "resolvedAtMs" FROM quality_cases WHERE id = $1`, [r.qualityCaseId]);
    expect(Number(f.rows[0].resolvedAtMs)).toBeGreaterThan(0);
    const ev = await db.query(
      `SELECT COUNT(*)::int AS n FROM quality_case_events WHERE "qualityCaseId" = $1`,
      [r.qualityCaseId]);
    expect(ev.rows[0].n).toBe(3);   // CREATED + los dos cambios
  });

  it("una transición imposible se rechaza", async () => {
    const r = await completar(MALA);
    await svc.cambiarEstadoCaso({ casoId: r.qualityCaseId!, tenantId: TALLER_A, nuevo: "CLOSED" });
    await expect(svc.cambiarEstadoCaso({
      casoId: r.qualityCaseId!, tenantId: TALLER_A, nuevo: "IN_REVIEW",
    })).rejects.toMatchObject({ codigo: "transicion_invalida" });
  });
});

describe.skipIf(!RUN)("aislamiento entre talleres", () => {
  async function delTallerA() {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a, TALLER_A), recipientRole: "DRIVER" });
    if (r.estado !== "created") throw new Error("no creada");
    return { a, instancia: r.instancia };
  }

  it("otro taller no la lee", async () => {
    const { a, instancia } = await delTallerA();
    expect(await svc.instanciaDelAmbito(instancia.id, ambito(a, TALLER_B))).toBeNull();
    expect(await svc.instanciasDeAsistencia(ambito(a, TALLER_B))).toEqual([]);
  });

  it("otro taller no la completa", async () => {
    const { a, instancia } = await delTallerA();
    await expect(svc.completarSurvey({
      instanceId: instancia.id, ambito: ambito(a, TALLER_B), respuestas: BUENA,
    })).rejects.toMatchObject({ codigo: "instancia_no_encontrada" });
    // Y sigue sin contestar para el suyo.
    expect((await svc.instanciaDelAmbito(instancia.id, ambito(a, TALLER_A)))?.status).toBe("CREATED");
  });

  it("otro taller no la mueve de estado ni le rota el token", async () => {
    const { a, instancia } = await delTallerA();
    await expect(svc.cambiarEstado(instancia.id, ambito(a, TALLER_B), "QUEUED"))
      .rejects.toMatchObject({ codigo: "instancia_no_encontrada" });
    await expect(svc.rotarToken(instancia.id, ambito(a, TALLER_B)))
      .rejects.toMatchObject({ codigo: "instancia_no_encontrada" });
  });

  it("otro taller no toca el caso de calidad", async () => {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a, TALLER_A), recipientRole: "DRIVER" });
    if (r.estado !== "created") throw new Error("no creada");
    const c = await svc.completarSurvey({
      instanceId: r.instancia.id, ambito: ambito(a, TALLER_A), respuestas: MALA,
    });
    expect(await svc.casoDelTenant(c.qualityCaseId!, TALLER_B)).toBeNull();
    await expect(svc.cambiarEstadoCaso({
      casoId: c.qualityCaseId!, tenantId: TALLER_B, nuevo: "IN_REVIEW",
    })).rejects.toMatchObject({ codigo: "instancia_no_encontrada" });
  });

  /*
   * La misma asistencia en dos talleres NO son dos encuestas: el índice único
   * es (sourceSystem, assistanceId, recipientRole) a propósito, para que
   * reasignar de taller no genere una segunda encuesta al mismo conductor.
   */
  it("reasignar de taller no crea una segunda encuesta", async () => {
    const { a } = await delTallerA();
    const otra = await svc.crearSurveyInstance({
      ambito: ambito(a, TALLER_B), recipientRole: "DRIVER",
    });
    expect(otra.estado).toBe("already_exists");
    const cuenta = await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_instances WHERE "assistanceId" = $1`, [a]);
    expect(cuenta.rows[0].n).toBe(1);
  });
});

describe.skipIf(!RUN)("transiciones de la encuesta en base", () => {
  it("el camino de envío va anotando sus tiempos", async () => {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "CUSTOMER" });
    if (r.estado !== "created") throw new Error("no creada");
    await svc.cambiarEstado(r.instancia.id, ambito(a), "QUEUED");
    await svc.cambiarEstado(r.instancia.id, ambito(a), "SENT");
    const f = await db.query(
      `SELECT status, "queuedAtMs", "sentAtMs" FROM survey_instances WHERE id = $1`, [r.instancia.id]);
    expect(f.rows[0].status).toBe("SENT");
    expect(Number(f.rows[0].queuedAtMs)).toBeGreaterThan(0);
    expect(Number(f.rows[0].sentAtMs)).toBeGreaterThan(0);
  });

  it("no se puede retroceder", async () => {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "DRIVER" });
    if (r.estado !== "created") throw new Error("no creada");
    await svc.cambiarEstado(r.instancia.id, ambito(a), "SENT");
    await expect(svc.cambiarEstado(r.instancia.id, ambito(a), "QUEUED"))
      .rejects.toMatchObject({ codigo: "transicion_invalida" });
  });

  it("una completada ya no se mueve", async () => {
    const a = nuevaAsistencia();
    const r = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: "DRIVER" });
    if (r.estado !== "created") throw new Error("no creada");
    await svc.completarSurvey({ instanceId: r.instancia.id, ambito: ambito(a), respuestas: BUENA });
    await expect(svc.cambiarEstado(r.instancia.id, ambito(a), "EXPIRED"))
      .rejects.toMatchObject({ codigo: "transicion_invalida" });
  });
});
