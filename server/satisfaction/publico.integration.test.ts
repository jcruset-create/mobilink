/**
 * La ruta pública de valoración, contra PostgreSQL real y Express real.
 *
 * Se levanta una aplicación mínima con solo este router: es lo que permite
 * probar los códigos de estado, el límite de peticiones y el cuerpo sin
 * arrastrar `server/index.ts` entero —que necesita Supabase, Twilio y media
 * docena de variables más.
 *
 * ── Cómo se consigue un token ───────────────────────────────────────────────
 *
 * Con `emitirToken`, la misma función que usará el envío real. NO hay ningún
 * endpoint que reparta tokens, ni lo habrá: eso convertiría la ruta pública en
 * su propia llave.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

let db: typeof import("../db.ts").default;
let svc: typeof import("./servicio.ts");
let limites: typeof import("./rateLimit.ts");
let servidor: import("http").Server;
let base = "";

const sufijo = String(process.hrtime.bigint()).slice(-9);
let n = 0;
const TENANT = `pub-${sufijo}`;

const ambito = (assistanceId: string) =>
  ({ sourceSystem: "assist" as const, tenantId: TENANT, assistanceId });

const BUENA_DRIVER = [
  { code: "overall_rating", value: 5 },
  { code: "professional_rating", value: 5 },
  { code: "resolution", value: "YES" },
];
const BUENA_CUSTOMER = [
  { code: "overall_rating", value: 4 },
  { code: "speed_rating", value: 4 },
  { code: "tracking_rating", value: 5 },
  { code: "resolution", value: "YES" },
];
const CON_DANOS = [
  ...BUENA_DRIVER,
  { code: "negative_reasons", value: ["VEHICLE_DAMAGE"] },
];

/**
 * Crea encuesta, emite token y devuelve las dos cosas.
 *
 * Para las caducadas se emite el token PRIMERO y se envejece la fila después:
 * es lo que ocurre de verdad —el enlace se mandó cuando valía y el plazo se
 * cumplió luego— y además `emitirToken` se niega, con razón, a emitir para una
 * encuesta ya vencida.
 */
async function conToken(rol: "DRIVER" | "CUSTOMER" = "DRIVER", o: { caducada?: boolean } = {}) {
  const a = `${sufijo}-${++n}`;
  const r = await svc.crearSurveyInstance({ ambito: ambito(a), recipientRole: rol });
  if (r.estado !== "created") throw new Error("no creada");
  const t = await svc.emitirToken(r.instancia.id, ambito(a));
  if (t.estado !== "emitido") throw new Error("no emitido");
  if (o.caducada) {
    await db.query(`UPDATE survey_instances SET "expiresAtMs" = $2 WHERE id = $1`,
      [r.instancia.id, Date.now() - 1000]);
  }
  return { a, id: r.instancia.id, token: t.token };
}

/** `Response.json()` devuelve `unknown`; aquí el cuerpo se lee tipado. */
/**
 * El cuerpo de una respuesta pública. Los campos se leen sueltos en las
 * pruebas, así que se tipan como opcionales en vez de recorrer una unión.
 */
type Cuerpo = {
  estado?: string;
  recipientRole?: string;
  preguntas?: { code: string }[];
  asistencia?: { referencia: string; matricula: string | null; finalizadaEnMs: number | null };
  campos?: string[];
  error?: string;
  yaEstaba?: boolean;
};
const cuerpo = async (r: Response): Promise<Cuerpo> => (await r.json()) as Cuerpo;

const GET = (token: string) => fetch(`${base}/api/public/satisfaction/${token}`);
const POST = (token: string, respuestas: unknown) =>
  fetch(`${base}/api/public/satisfaction/${token}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ respuestas }),
  });

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  svc = await import("./servicio.ts");
  limites = await import("./rateLimit.ts");

  const express = (await import("express")).default;
  const { createSatisfactionPublicRouter } = await import("./routerPublico.ts");
  const app = express();
  app.use("/api/public/satisfaction", createSatisfactionPublicRouter());
  await new Promise<void>((listo) => {
    servidor = app.listen(0, () => {
      const dir = servidor.address();
      base = `http://127.0.0.1:${typeof dir === "object" && dir ? dir.port : 0}`;
      listo();
    });
  });
});

beforeEach(() => { if (RUN) limites.reiniciarLimites(); });

afterAll(async () => {
  if (!RUN) return;
  await new Promise<void>((listo) => servidor.close(() => listo()));
  await db.end().catch(() => {});
});

/* ── Resolver ────────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("GET por token", () => {
  it("un token válido devuelve ACTIVE con sus preguntas", async () => {
    const { token } = await conToken("DRIVER");
    const r = await GET(token);
    expect(r.status).toBe(200);
    const b = await cuerpo(r);
    expect(b.estado).toBe("ACTIVE");
    expect(b.recipientRole).toBe("DRIVER");
    expect(b.preguntas.map((p: { code: string }) => p.code))
      .toEqual(["overall_rating", "professional_rating", "resolution",
                "negative_reasons", "comment"]);
    expect(b.asistencia.referencia).toMatch(/^AST-/);
  });

  it("el de cliente trae SUS preguntas", async () => {
    const { token } = await conToken("CUSTOMER");
    const b = await cuerpo(await GET(token));
    expect(b.preguntas.map((p: { code: string }) => p.code)).toContain("speed_rating");
    expect(b.preguntas.map((p: { code: string }) => p.code)).toContain("tracking_rating");
  });

  /*
   * Un token que no existe y uno mal formado contestan IGUAL. Distinguirlos
   * diría si ese token existió alguna vez.
   */
  it("token inexistente y token mal formado dan lo mismo", async () => {
    const inexistente = "a".repeat(43);
    const malo = "esto-no-es-un-token";
    const uno = await cuerpo(await GET(inexistente));
    const dos = await cuerpo(await GET(malo));
    expect(uno).toEqual({ estado: "INVALID" });
    expect(dos).toEqual({ estado: "INVALID" });
  });

  it("nunca contesta 404 al resolver: el estado va dentro", async () => {
    expect((await GET("a".repeat(43))).status).toBe(200);
  });

  /*
   * El worker pasa cada cinco minutos. Entre que una encuesta vence y él la
   * marca, la fila sigue diciendo QUEUED — y no se puede contestar por ganarle
   * la carrera a un temporizador.
   */
  it("una caducada lo está aunque el worker no haya pasado", async () => {
    const { id, token } = await conToken("DRIVER", { caducada: true });
    expect((await db.query(`SELECT status FROM survey_instances WHERE id=$1`, [id]))
      .rows[0].status).toBe("CREATED");
    const b = await cuerpo(await GET(token));
    expect(b.estado).toBe("EXPIRED");
    // Y de paso la deja marcada, para que el worker no tenga que volver.
    expect((await db.query(`SELECT status FROM survey_instances WHERE id=$1`, [id]))
      .rows[0].status).toBe("EXPIRED");
  });

  it("una completada dice COMPLETED y NO devuelve lo contestado", async () => {
    const { a, id, token } = await conToken("DRIVER");
    await svc.completarSurvey({ instanceId: id, ambito: ambito(a), respuestas: BUENA_DRIVER });
    const b = await cuerpo(await GET(token));
    expect(b.estado).toBe("COMPLETED");
    expect(b.preguntas).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain("overall_rating");
  });

  it("una cancelada dice UNAVAILABLE, sin contar por qué", async () => {
    const { a, id, token } = await conToken("DRIVER");
    await svc.cambiarEstado(id, ambito(a), "CANCELLED");
    const b = await cuerpo(await GET(token));
    expect(b).toEqual({ estado: "UNAVAILABLE" });
  });

  it("abrir el enlace marca STARTED una sola vez", async () => {
    const { id, token } = await conToken("DRIVER");
    await GET(token);
    const uno = (await db.query(
      `SELECT status, "startedAtMs" FROM survey_instances WHERE id=$1`, [id])).rows[0];
    expect(uno.status).toBe("STARTED");
    expect(Number(uno.startedAtMs)).toBeGreaterThan(0);

    await GET(token); await GET(token);
    const dos = (await db.query(
      `SELECT "startedAtMs" FROM survey_instances WHERE id=$1`, [id])).rows[0];
    // Interesa cuándo lo vio, no cuándo lo volvió a mirar.
    expect(dos.startedAtMs).toBe(uno.startedAtMs);
  });

  it("no expone nada interno", async () => {
    const { token } = await conToken("DRIVER");
    const texto = await (await GET(token)).text();
    for (const prohibido of ["tenantId", "surveyInstanceId", "tokenHash", TENANT]) {
      expect(texto).not.toContain(prohibido);
    }
  });
});

/* ── Completar ───────────────────────────────────────────────────────────── */

describe.skipIf(!RUN)("POST completar", () => {
  const respuestas = async (id: number) =>
    (await db.query(
      `SELECT COUNT(*)::int AS n FROM survey_responses WHERE "surveyInstanceId" = $1`, [id]))
      .rows[0].n;

  it("una valoración de conductor se guarda", async () => {
    const { id, token } = await conToken("DRIVER");
    const r = await POST(token, BUENA_DRIVER);
    expect(r.status).toBe(200);
    expect(await cuerpo(r)).toEqual({ estado: "COMPLETED" });
    expect(await respuestas(id)).toBe(1);
  });

  it("una de cliente también", async () => {
    const { id, token } = await conToken("CUSTOMER");
    expect((await POST(token, BUENA_CUSTOMER)).status).toBe(200);
    expect(await respuestas(id)).toBe(1);
  });

  /*
   * El segundo clic de alguien con mala cobertura NO es un error: la respuesta
   * ya está guardada y la página tiene que enseñar el agradecimiento.
   */
  it("enviar dos veces deja UNA respuesta y contesta 200", async () => {
    const { id, token } = await conToken("DRIVER");
    await POST(token, BUENA_DRIVER);
    const segunda = await POST(token, BUENA_DRIVER);
    expect(segunda.status).toBe(200);
    expect(await cuerpo(segunda)).toMatchObject({ estado: "COMPLETED", yaEstaba: true });
    expect(await respuestas(id)).toBe(1);
  });

  it("dos envíos a la vez: una sola respuesta y un solo caso", async () => {
    const { id, token } = await conToken("DRIVER");
    const [a, b] = await Promise.all([POST(token, CON_DANOS), POST(token, CON_DANOS)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await respuestas(id)).toBe(1);
    const casos = await db.query(
      `SELECT COUNT(*)::int AS n FROM quality_cases WHERE "surveyInstanceId" = $1`, [id]);
    expect(casos.rows[0].n).toBe(1);
  });

  it("una valoración fuera de escala da 400 y dice qué campo", async () => {
    const { token } = await conToken("DRIVER");
    const r = await POST(token, [{ code: "overall_rating", value: 9 }]);
    expect(r.status).toBe(400);
    const b = await cuerpo(r);
    expect(b.estado).toBe("ERROR");
    expect(b.campos).toContain("overall_rating");
  });

  it("una pregunta que no es de la plantilla se rechaza", async () => {
    const { token } = await conToken("DRIVER");
    const r = await POST(token, [...BUENA_DRIVER, { code: "cuanto_cobras", value: "mucho" }]);
    expect(r.status).toBe(400);
    expect((await cuerpo(r)).campos).toContain("cuanto_cobras");
  });

  it("sin respuestas es 400, no 500", async () => {
    const { token } = await conToken("DRIVER");
    const r = await fetch(`${base}/api/public/satisfaction/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    expect(r.status).toBe(400);
  });

  it("una caducada da 410 y no guarda nada", async () => {
    const { id, token } = await conToken("DRIVER", { caducada: true });
    const r = await POST(token, BUENA_DRIVER);
    expect(r.status).toBe(410);
    expect(await cuerpo(r)).toEqual({ estado: "EXPIRED" });
    expect(await respuestas(id)).toBe(0);
  });

  it("un token inexistente da 404 sin contar nada", async () => {
    const r = await POST("a".repeat(43), BUENA_DRIVER);
    expect(r.status).toBe(404);
    expect(await cuerpo(r)).toEqual({ estado: "INVALID" });
  });

  /*
   * Los daños abren un expediente CRÍTICO, y al que valora no se le dice: se
   * le agradece igual que a cualquiera.
   */
  it("unos daños abren caso crítico y la respuesta pública no lo menciona", async () => {
    const { id, token } = await conToken("DRIVER");
    const r = await POST(token, CON_DANOS);
    expect(await cuerpo(r)).toEqual({ estado: "COMPLETED" });

    const caso = await db.query(
      `SELECT priority, reason FROM quality_cases WHERE "surveyInstanceId" = $1`, [id]);
    expect(caso.rows[0]).toMatchObject({ priority: "CRITICAL", reason: "VEHICLE_DAMAGE" });
  });

  it("el cliente no puede colar un tenant: el ámbito sale de la fila", async () => {
    const { id, token } = await conToken("DRIVER");
    const r = await fetch(`${base}/api/public/satisfaction/${token}/complete`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ respuestas: BUENA_DRIVER, tenantId: "otro", instanceId: 1 }),
    });
    expect(r.status).toBe(200);
    expect(await respuestas(id)).toBe(1);
  });
});

/* ── Límite de peticiones ────────────────────────────────────────────────── */

describe.skipIf(!RUN)("límite de peticiones", () => {
  /*
   * Con el mismo token, el que salta primero es el límite POR ENCUESTA (30),
   * antes que el de IP (60). Es lo buscado: nadie contesta la misma encuesta
   * treinta veces, y así una red compartida —un polígono, la wifi de una
   * empresa— no se queda sin cupo por culpa de un solo enlace.
   */
  it("dentro del límite funciona; pasarse da 429 sin filtrar nada", async () => {
    const { token } = await conToken("DRIVER");
    for (let i = 0; i < limites.LIMITE_POR_ENCUESTA.peticiones; i++) {
      expect((await GET(token)).status).toBe(200);
    }
    const r = await GET(token);
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    const b = await cuerpo(r);
    expect(Object.keys(b)).toEqual(["error"]);
    expect(JSON.stringify(b)).not.toContain(token);
  });

  it("enviar tiene su propio límite, más estrecho", async () => {
    const { token } = await conToken("DRIVER");
    for (let i = 0; i < limites.LIMITE_ENVIO.peticiones; i++) {
      await POST(token, [{ code: "overall_rating", value: 3 }]);   // 400, pero cuenta
    }
    expect((await POST(token, BUENA_DRIVER)).status).toBe(429);
    // Y no le impide seguir leyendo la página.
    expect((await GET(token)).status).toBe(200);
  });
});
