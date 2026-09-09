/**
 * La cara pública de una encuesta: lo que se puede contar sin saber quién mira.
 *
 * ── Todo entra por el token, y solo por el token ────────────────────────────
 *
 * No hay ninguna función aquí que acepte un id de encuesta. Quien abre el
 * enlace no está autenticado y no pertenece a ningún taller, así que el token
 * es lo único que le da derecho a ver algo — y como se busca por su sha256,
 * ni siquiera hace falta que el servidor conozca el valor en claro más allá
 * del instante en que lo recibe.
 *
 * ── Y se cuenta lo mínimo ───────────────────────────────────────────────────
 *
 * La página tiene que dar contexto suficiente para que quien responde sepa de
 * qué asistencia se trata. Nada más. Ni proveedor, ni costes, ni teléfonos, ni
 * cliente de facturación, ni identificadores internos: la referencia, la
 * matrícula y la fecha, que es exactamente lo que ya enseñan el seguimiento
 * público y el informe.
 */

import pool from "../db.ts";
import { plantillaDeRol, puedeResponderse, type EstadoEncuesta, type Plantilla,
         type RolDestinatario } from "./dominio.ts";
import { hashToken } from "./servicio.ts";

/* ── Estados de cara afuera ──────────────────────────────────────────────── */

/**
 * Lo que la página necesita saber.
 *
 * `UNAVAILABLE` junta cancelada y fallida a propósito: al que responde no le
 * sirve de nada la diferencia, y contarla sería contar cómo funciona esto por
 * dentro.
 */
export type EstadoPublico = "ACTIVE" | "COMPLETED" | "EXPIRED" | "UNAVAILABLE" | "INVALID";

export type ContextoAsistencia = {
  referencia: string;
  matricula: string | null;
  finalizadaEnMs: number | null;
};

export type SurveyPublica =
  | {
      estado: "ACTIVE";
      recipientRole: RolDestinatario;
      preguntas: Plantilla["preguntas"];
      asistencia: ContextoAsistencia;
      expiraEnMs: number;
    }
  | { estado: "COMPLETED"; asistencia: ContextoAsistencia }
  | { estado: "EXPIRED"; asistencia: ContextoAsistencia }
  | { estado: "UNAVAILABLE" }
  | { estado: "INVALID" };

/* ── Validación del token ────────────────────────────────────────────────── */

/**
 * ¿Tiene pinta de token?
 *
 * 32 bytes en base64url son 43 caracteres exactos. Comprobarlo antes de tocar
 * la base evita convertir en consultas todo lo que un escáner tire contra la
 * ruta. Un token mal formado y uno inexistente contestan lo mismo —`INVALID`—
 * porque decir cuál de las dos cosas es sería decir si existió alguna vez.
 */
export function pareceToken(valor: unknown): boolean {
  return typeof valor === "string" && /^[A-Za-z0-9_-]{43}$/.test(valor);
}

/* ── Resolución ──────────────────────────────────────────────────────────── */

type Fila = {
  id: number; sourceSystem: string; tenantId: string | null; assistanceId: string;
  recipientRole: string; status: string; expiresAtMs: string; startedAtMs: string | null;
};

const CAMPOS = `id, "sourceSystem", "tenantId", "assistanceId", "recipientRole",
                status, "expiresAtMs", "startedAtMs"`;

/**
 * Resuelve una encuesta por su token público.
 *
 * **La caducidad se comprueba aquí y ahora, no se confía en el worker.** Éste
 * pasa cada cinco minutos, así que entre que una encuesta vence y él la marca
 * `EXPIRED` hay una ventana en la que la fila sigue diciendo `QUEUED`. Sin esta
 * comprobación se podría contestar una encuesta caducada por ganarle la carrera
 * a un temporizador, que no es una regla de negocio: es un accidente.
 *
 * Nunca registra el token en ningún log.
 */
export async function resolverSurveyPublica(
  token: unknown, ahoraMs = Date.now(),
): Promise<SurveyPublica> {
  if (!pareceToken(token)) return { estado: "INVALID" };

  const r = await pool.query(
    `SELECT ${CAMPOS} FROM survey_instances WHERE "tokenHash" = $1`,
    [hashToken(String(token))],
  );
  const f: Fila | undefined = r.rows[0];
  if (!f) return { estado: "INVALID" };

  const estado = String(f.status) as EstadoEncuesta;
  const asistencia = await contextoDeAsistencia(f.assistanceId);

  if (estado === "COMPLETED") return { estado: "COMPLETED", asistencia };
  if (estado === "EXPIRED") return { estado: "EXPIRED", asistencia };

  // La caducidad manda sobre el estado guardado: el worker puede ir cinco
  // minutos por detrás y eso no puede abrir una encuesta vencida.
  if (Number(f.expiresAtMs) <= ahoraMs) {
    await marcarCaducada(f.id).catch(() => { /* el worker la cogerá */ });
    return { estado: "EXPIRED", asistencia };
  }

  // `puedeResponderse` es la autoridad, no una lista repetida aquí. Cancelada
  // y fallida caen las dos en «no disponible».
  if (!puedeResponderse(estado)) return { estado: "UNAVAILABLE" };

  const plantilla = plantillaDeRol(f.recipientRole as RolDestinatario);
  if (!plantilla) return { estado: "UNAVAILABLE" };

  return {
    estado: "ACTIVE",
    recipientRole: f.recipientRole as RolDestinatario,
    preguntas: plantilla.preguntas,
    asistencia,
    expiraEnMs: Number(f.expiresAtMs),
  };
}

/**
 * La instancia, para quien ya ha resuelto el token y necesita completarla.
 *
 * Devuelve el ámbito porque `completarSurvey` lo exige, y aquí lo aporta la
 * propia fila: el que responde no puede mandar un tenant, y no lo manda.
 */
export async function instanciaPorToken(token: unknown): Promise<{
  id: number;
  ambito: { sourceSystem: "assist" | "central"; tenantId: string | null; assistanceId: string };
  status: EstadoEncuesta;
  expiresAtMs: number;
} | null> {
  if (!pareceToken(token)) return null;
  const r = await pool.query(
    `SELECT ${CAMPOS} FROM survey_instances WHERE "tokenHash" = $1`,
    [hashToken(String(token))],
  );
  const f: Fila | undefined = r.rows[0];
  if (!f) return null;
  return {
    id: Number(f.id),
    ambito: {
      sourceSystem: f.sourceSystem as "assist" | "central",
      tenantId: f.tenantId == null ? null : String(f.tenantId),
      assistanceId: String(f.assistanceId),
    },
    status: String(f.status) as EstadoEncuesta,
    expiresAtMs: Number(f.expiresAtMs),
  };
}

/**
 * Anota que se ha abierto, una sola vez.
 *
 * `startedAtMs IS NULL` en el WHERE hace que abrir el enlace cinco veces deje
 * la primera hora, no la última: interesa cuándo lo vio, no cuándo lo volvió a
 * mirar. Y si falla no pasa nada — no se le va a negar la encuesta a nadie
 * porque no se haya podido apuntar que la abrió.
 */
export async function marcarAbierta(token: unknown, ahoraMs = Date.now()): Promise<void> {
  if (!pareceToken(token)) return;
  await pool.query(
    `UPDATE survey_instances
        SET status = 'STARTED', "startedAtMs" = $2
      WHERE "tokenHash" = $1
        AND "startedAtMs" IS NULL
        AND status IN ('CREATED','QUEUED','SENT','DELIVERED')`,
    [hashToken(String(token)), ahoraMs],
  );
}

async function marcarCaducada(id: number): Promise<void> {
  await pool.query(
    `UPDATE survey_instances SET status = 'EXPIRED'
      WHERE id = $1 AND status NOT IN ('COMPLETED','CANCELLED','EXPIRED')`,
    [id],
  );
}

/**
 * El contexto que se enseña, y nada más.
 *
 * La matrícula se muestra porque el seguimiento público y el informe ya la
 * enseñan a quien tiene el enlace: es lo que permite reconocer de qué servicio
 * se está hablando. Todo lo demás —proveedor, importes, cliente, notas,
 * teléfonos— se queda fuera.
 */
async function contextoDeAsistencia(assistanceId: string): Promise<ContextoAsistencia> {
  const vacio: ContextoAsistencia = {
    referencia: `AST-${assistanceId}`, matricula: null, finalizadaEnMs: null,
  };
  try {
    const r = await pool.query(
      `SELECT plate, "finishedAtMs" FROM roadside_assistances WHERE id = $1`,
      [Number(assistanceId)],
    );
    const f = r.rows[0];
    if (!f) return vacio;
    return {
      referencia: `AST-${assistanceId}`,
      matricula: f.plate ? String(f.plate) : null,
      finalizadaEnMs: f.finishedAtMs == null ? null : Number(f.finishedAtMs),
    };
  } catch {
    return vacio;
  }
}
