/**
 * Satisfaction: servicio.
 *
 * ── El problema del token en una creación idempotente ───────────────────────
 *
 * Crear una encuesta devuelve el token en claro UNA vez: en la base solo queda
 * su sha256. Eso choca de frente con la idempotencia. Si la creación se repite
 * —el worker reintenta, dos peticiones a la vez— la segunda no puede devolver
 * un token: generar uno nuevo daría un enlace que no coincide con el hash
 * guardado, y el conductor recibiría un WhatsApp con una dirección que no abre
 * nada. Ese es exactamente el fallo silencioso que hay que evitar.
 *
 * Por eso `crearSurveyInstance` devuelve un resultado que distingue los dos
 * casos y **solo lleva token cuando de verdad ha insertado**:
 *
 *   { estado: "created",        instancia, token }   ← el token, una vez
 *   { estado: "already_exists", instancia }          ← sin token, a propósito
 *
 * Quien llame tiene que tratar los dos. En 1C el envío solo ocurre en el
 * `created`, que es cuando hay enlace que mandar; si la instancia ya existía,
 * o ya se mandó o ya hay una entrega registrada que mirar.
 *
 * Y si hiciera falta reenviar una encuesta cuyo token se perdió, la respuesta
 * no es «genera otro y ya»: es `rotarToken`, que reescribe el hash a propósito
 * e invalida el enlace anterior. Explícito, y con su propia línea de auditoría.
 */

import { createHash, randomBytes } from "crypto";
import type { PoolClient } from "pg";

import pool from "../db.ts";
import {
  CADUCIDAD_POR_DEFECTO_MS, evaluarCalidad, plantillaDeRol, puedeResponderse,
  transicionCasoValida, transicionValida, validarRespuesta,
  type EstadoCaso, type EstadoEncuesta, type ErrorValidacion,
  type RespuestaEntrante, type RolDestinatario, type Sistema,
} from "./dominio.ts";

/* ── Errores ─────────────────────────────────────────────────────────────── */

export class ErrorSatisfaction extends Error {
  constructor(
    readonly codigo:
      | "instancia_no_encontrada" | "plantilla_no_encontrada" | "caducada"
      | "ya_completada" | "estado_no_admite_respuesta" | "respuesta_invalida"
      | "transicion_invalida" | "otro_tenant",
    mensaje: string,
    readonly errores?: ErrorValidacion[],
  ) {
    super(mensaje);
    this.name = "ErrorSatisfaction";
  }
}

/* ── Tokens ──────────────────────────────────────────────────────────────── */

/** 256 bits. Un UUID v4 tiene 122 y encima parece un identificador interno. */
export function generarToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/* ── Tipos ───────────────────────────────────────────────────────────────── */

export type Ambito = {
  sourceSystem: Sistema;
  tenantId: string | null;
  assistanceId: string;
};

export type SurveyInstance = {
  id: number;
  sourceSystem: string;
  tenantId: string | null;
  assistanceId: string;
  recipientRole: string;
  templateId: number;
  templateVersion: number;
  status: EstadoEncuesta;
  expiresAtMs: number;
  createdAtMs: number;
  completedAtMs: number | null;
};

export type ResultadoCreacion =
  | { estado: "created"; instancia: SurveyInstance; token: string }
  | { estado: "already_exists"; instancia: SurveyInstance };

/** Una fila de `pg`: valores sin tipar hasta que se convierten. */
type Fila = Record<string, unknown>;

function aInstancia(f: Fila): SurveyInstance {
  return {
    id: Number(f.id),
    sourceSystem: String(f.sourceSystem),
    tenantId: f.tenantId == null ? null : String(f.tenantId),
    assistanceId: String(f.assistanceId),
    recipientRole: String(f.recipientRole),
    templateId: Number(f.templateId),
    templateVersion: Number(f.templateVersion),
    status: String(f.status) as EstadoEncuesta,
    expiresAtMs: Number(f.expiresAtMs),
    createdAtMs: Number(f.createdAtMs),
    completedAtMs: f.completedAtMs == null ? null : Number(f.completedAtMs),
  };
}

const CAMPOS = `id, "sourceSystem", "tenantId", "assistanceId", "recipientRole",
                "templateId", "templateVersion", status, "expiresAtMs",
                "createdAtMs", "completedAtMs"`;

async function enTransaccion<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* ── Plantillas ──────────────────────────────────────────────────────────── */

/** La versión activa más alta de la plantilla de ese destinatario. */
export async function plantillaActiva(
  rol: RolDestinatario,
): Promise<{ id: number; code: string; version: number } | null> {
  const r = await pool.query(
    `SELECT id, code, version FROM survey_templates
      WHERE "recipientRole" = $1 AND active = true
      ORDER BY version DESC LIMIT 1`,
    [rol],
  );
  const f = r.rows[0];
  return f ? { id: Number(f.id), code: String(f.code), version: Number(f.version) } : null;
}

/* ── Crear ───────────────────────────────────────────────────────────────── */

/**
 * Crea la encuesta de una asistencia para un destinatario. Idempotente.
 *
 * La garantía NO es el `SELECT` de más abajo: es el índice único
 * `(sourceSystem, assistanceId, recipientRole)`. El `SELECT` previo solo evita
 * el trabajo inútil en el caso normal; el que de verdad protege de dos worker
 * simultáneos es el `ON CONFLICT DO NOTHING`, porque los dos pueden pasar la
 * comprobación y solo uno puede insertar.
 *
 * No mira teléfonos ni canales: una encuesta se puede crear aunque todavía no
 * se sepa por dónde mandarla. Resolver el destinatario es de 1C.
 */
export async function crearSurveyInstance(p: {
  ambito: Ambito;
  recipientRole: RolDestinatario;
  caducidadMs?: number;
  ahoraMs?: number;
}): Promise<ResultadoCreacion> {
  const ahora = p.ahoraMs ?? Date.now();
  const { sourceSystem, tenantId, assistanceId } = p.ambito;

  const existente = await pool.query(
    `SELECT ${CAMPOS} FROM survey_instances
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2 AND "recipientRole" = $3`,
    [sourceSystem, assistanceId, p.recipientRole],
  );
  if (existente.rows.length) {
    return { estado: "already_exists", instancia: aInstancia(existente.rows[0]) };
  }

  const plantilla = await plantillaActiva(p.recipientRole);
  if (!plantilla) {
    throw new ErrorSatisfaction(
      "plantilla_no_encontrada",
      `No hay plantilla activa para ${p.recipientRole}.`,
    );
  }

  const token = generarToken();
  const expiresAtMs = ahora + (p.caducidadMs ?? CADUCIDAD_POR_DEFECTO_MS);

  const insertado = await pool.query(
    `INSERT INTO survey_instances
       ("sourceSystem", "tenantId", "assistanceId", "recipientRole",
        "templateId", "templateVersion", status, "tokenHash", "expiresAtMs", "createdAtMs")
     VALUES ($1,$2,$3,$4,$5,$6,'CREATED',$7,$8,$9)
     ON CONFLICT ("sourceSystem", "assistanceId", "recipientRole") DO NOTHING
     RETURNING ${CAMPOS}`,
    [sourceSystem, tenantId, assistanceId, p.recipientRole,
     plantilla.id, plantilla.version, hashToken(token), expiresAtMs, ahora],
  );

  if (insertado.rows.length) {
    return { estado: "created", instancia: aInstancia(insertado.rows[0]), token };
  }

  /*
   * Otro proceso ganó la carrera entre el SELECT y el INSERT. Se devuelve la
   * suya SIN token: el token que acabamos de generar no es el que está
   * guardado, y devolverlo daría un enlace muerto.
   */
  const carrera = await pool.query(
    `SELECT ${CAMPOS} FROM survey_instances
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2 AND "recipientRole" = $3`,
    [sourceSystem, assistanceId, p.recipientRole],
  );
  return { estado: "already_exists", instancia: aInstancia(carrera.rows[0]) };
}

/**
 * Cambia el token de una encuesta y devuelve el nuevo.
 *
 * Invalida el enlace anterior a propósito. Existe para el único caso legítimo
 * —hay que reenviar y el token original se perdió— y es explícito para que
 * nadie lo haga sin querer desde una creación repetida.
 */
export async function rotarToken(instanceId: number, ambito: Ambito): Promise<string> {
  const token = generarToken();
  const r = await pool.query(
    `UPDATE survey_instances SET "tokenHash" = $2
      WHERE id = $1 AND "sourceSystem" = $3 AND "assistanceId" = $4
        AND ("tenantId" IS NOT DISTINCT FROM $5)
        AND status <> 'COMPLETED'
      RETURNING id`,
    [instanceId, hashToken(token), ambito.sourceSystem, ambito.assistanceId, ambito.tenantId],
  );
  if (!r.rows.length) {
    throw new ErrorSatisfaction("instancia_no_encontrada", "No se ha podido rotar el token.");
  }
  return token;
}

/* ── Lectura ─────────────────────────────────────────────────────────────── */

/**
 * Una encuesta, SIEMPRE dentro de su ámbito.
 *
 * No hay ninguna función que busque solo por `id`: es lo que evita que un
 * llamante despistado lea la encuesta de otro taller. El tenant es un
 * argumento, no un filtro opcional.
 */
export async function instanciaDelAmbito(
  instanceId: number, ambito: Ambito,
): Promise<SurveyInstance | null> {
  const r = await pool.query(
    `SELECT ${CAMPOS} FROM survey_instances
      WHERE id = $1 AND "sourceSystem" = $2 AND "assistanceId" = $3
        AND ("tenantId" IS NOT DISTINCT FROM $4)`,
    [instanceId, ambito.sourceSystem, ambito.assistanceId, ambito.tenantId],
  );
  return r.rows.length ? aInstancia(r.rows[0]) : null;
}

/** Las encuestas de una asistencia, para la ficha de 1F. */
export async function instanciasDeAsistencia(ambito: Ambito): Promise<SurveyInstance[]> {
  const r = await pool.query(
    `SELECT ${CAMPOS} FROM survey_instances
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2
        AND ("tenantId" IS NOT DISTINCT FROM $3)
      ORDER BY "recipientRole"`,
    [ambito.sourceSystem, ambito.assistanceId, ambito.tenantId],
  );
  return r.rows.map(aInstancia);
}

/* ── Transiciones ────────────────────────────────────────────────────────── */

const COLUMNA: Partial<Record<EstadoEncuesta, string>> = {
  QUEUED: "queuedAtMs", SENT: "sentAtMs", DELIVERED: "deliveredAtMs",
  STARTED: "startedAtMs", CANCELLED: "cancelledAtMs", FAILED: "failedAtMs",
};

/**
 * Mueve la encuesta de estado, validando la transición.
 *
 * `COMPLETED` no se pasa por aquí: lo hace `completarSurvey` dentro de su
 * transacción, junto con la respuesta. Separarlo permitiría marcar completada
 * una encuesta sin respuesta.
 */
export async function cambiarEstado(
  instanceId: number, ambito: Ambito, nuevo: Exclude<EstadoEncuesta, "COMPLETED">,
  ahoraMs = Date.now(),
): Promise<SurveyInstance> {
  const actual = await instanciaDelAmbito(instanceId, ambito);
  if (!actual) throw new ErrorSatisfaction("instancia_no_encontrada", "Encuesta no encontrada.");
  if (!transicionValida(actual.status, nuevo)) {
    throw new ErrorSatisfaction(
      "transicion_invalida", `No se puede pasar de ${actual.status} a ${nuevo}.`,
    );
  }
  const columna = COLUMNA[nuevo];
  const r = await pool.query(
    `UPDATE survey_instances
        SET status = $2 ${columna ? `, "${columna}" = COALESCE("${columna}", $3)` : ""}
      WHERE id = $1 AND status = $4
      RETURNING ${CAMPOS}`,
    columna ? [instanceId, nuevo, ahoraMs, actual.status] : [instanceId, nuevo, actual.status],
  );
  if (!r.rows.length) {
    // Alguien la movió entre la lectura y el UPDATE.
    throw new ErrorSatisfaction("transicion_invalida", "La encuesta ha cambiado de estado.");
  }
  return aInstancia(r.rows[0]);
}

/* ── Completar ───────────────────────────────────────────────────────────── */

export type ResultadoCompletar = {
  responseId: number;
  qualityCaseId: number | null;
  instancia: SurveyInstance;
};

/**
 * Guarda la respuesta y, si procede, abre el caso de calidad. Todo o nada.
 *
 * ── Contra dos envíos a la vez ──────────────────────────────────────────────
 *
 * La barrera es doble y la de verdad es la segunda:
 *
 *  1. `SELECT ... FOR UPDATE` bloquea la instancia, así que el segundo intento
 *     espera al primero y ve el estado ya cambiado.
 *  2. `UNIQUE (surveyInstanceId)` en `survey_responses`. Si el bloqueo no
 *     bastara —dos transacciones que empezaran antes— el segundo INSERT falla.
 *
 * Con una sola no sería suficiente: el bloqueo protege dentro de la misma
 * base, la restricción protege siempre.
 */
export async function completarSurvey(p: {
  instanceId: number;
  ambito: Ambito;
  respuestas: readonly RespuestaEntrante[];
  ahoraMs?: number;
  actor?: { tipo?: string; id?: string | null; nombre?: string | null };
}): Promise<ResultadoCompletar> {
  const ahora = p.ahoraMs ?? Date.now();

  return enTransaccion(async (c) => {
    // 1 · Bloquear y comprobar que es del ámbito.
    const sel = await c.query(
      `SELECT ${CAMPOS} FROM survey_instances
        WHERE id = $1 AND "sourceSystem" = $2 AND "assistanceId" = $3
          AND ("tenantId" IS NOT DISTINCT FROM $4)
        FOR UPDATE`,
      [p.instanceId, p.ambito.sourceSystem, p.ambito.assistanceId, p.ambito.tenantId],
    );
    if (!sel.rows.length) {
      throw new ErrorSatisfaction("instancia_no_encontrada", "Encuesta no encontrada.");
    }
    const instancia = aInstancia(sel.rows[0]);

    // 2 · Estado y caducidad.
    if (instancia.status === "COMPLETED") {
      throw new ErrorSatisfaction("ya_completada", "Esta encuesta ya se ha contestado.");
    }
    if (!puedeResponderse(instancia.status)) {
      throw new ErrorSatisfaction(
        "estado_no_admite_respuesta", `Una encuesta en ${instancia.status} no se puede contestar.`,
      );
    }
    if (instancia.expiresAtMs <= ahora) {
      throw new ErrorSatisfaction("caducada", "El plazo para valorar ha terminado.");
    }

    // 3 · Plantilla y validación. El backend es la autoridad: lo que diga la
    // miniweb sobre qué se enseñó no cuenta.
    const plantilla = plantillaDeRol(instancia.recipientRole as RolDestinatario);
    if (!plantilla) {
      throw new ErrorSatisfaction("plantilla_no_encontrada", "Plantilla desconocida.");
    }
    const v = validarRespuesta(plantilla, p.respuestas);
    if (!v.ok) {
      throw new ErrorSatisfaction("respuesta_invalida", "Hay respuestas que no son válidas.", v.errores);
    }

    // 4 · La respuesta.
    const resp = await c.query(
      `INSERT INTO survey_responses ("surveyInstanceId", "templateVersion", "completedAtMs", "createdAtMs")
       VALUES ($1,$2,$3,$3) RETURNING id`,
      [instancia.id, instancia.templateVersion, ahora],
    );
    const responseId = Number(resp.rows[0].id);

    for (const [code, valor] of v.valores) {
      const esNumero = typeof valor === "number";
      await c.query(
        `INSERT INTO survey_answers ("surveyResponseId", "questionCode", value, "scaleValue", "createdAtMs")
         VALUES ($1,$2,$3,$4,$5)`,
        [responseId, code,
         esNumero ? String(valor) : Array.isArray(valor) ? JSON.stringify(valor) : valor,
         esNumero ? valor : null, ahora],
      );
    }

    // 5 · La instancia pasa a completada. El `status <> 'COMPLETED'` es
    // redundante con el bloqueo y se deja: cuesta nada y cierra la ventana.
    const upd = await c.query(
      `UPDATE survey_instances SET status = 'COMPLETED', "completedAtMs" = $2
        WHERE id = $1 AND status <> 'COMPLETED'
        RETURNING ${CAMPOS}`,
      [instancia.id, ahora],
    );
    if (!upd.rows.length) {
      throw new ErrorSatisfaction("ya_completada", "Esta encuesta ya se ha contestado.");
    }

    // 6 · Calidad. La regla es pura y vive en el dominio; aquí solo se guarda.
    const veredicto = evaluarCalidad(v.valores);
    let qualityCaseId: number | null = null;
    if (veredicto.abreCaso) {
      const caso = await c.query(
        `INSERT INTO quality_cases
           ("sourceSystem", "tenantId", "assistanceId", "surveyInstanceId", "surveyResponseId",
            "originRecipientRole", reason, priority, status, "createdAtMs", "updatedAtMs")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'NEW',$9,$9)
         ON CONFLICT ("surveyResponseId") WHERE "surveyResponseId" IS NOT NULL DO NOTHING
         RETURNING id`,
        [instancia.sourceSystem, instancia.tenantId, instancia.assistanceId,
         instancia.id, responseId, instancia.recipientRole,
         veredicto.motivo, veredicto.prioridad, ahora],
      );
      if (caso.rows.length) {
        qualityCaseId = Number(caso.rows[0].id);
        await c.query(
          `INSERT INTO quality_case_events
             ("qualityCaseId", "eventType", "actorType", "actorId", "actorName",
              "toValue", note, "occurredAtMs", "createdAtMs")
           VALUES ($1,'CREATED',$2,$3,$4,'NEW',$5,$6,$6)`,
          [qualityCaseId, p.actor?.tipo ?? "system", p.actor?.id ?? null, p.actor?.nombre ?? null,
           `Abierto automáticamente por ${veredicto.motivo} (${veredicto.prioridad}).`, ahora],
        );
      }
    }

    return { responseId, qualityCaseId, instancia: aInstancia(upd.rows[0]) };
  });
}

/* ── Casos de calidad ────────────────────────────────────────────────────── */

export type QualityCase = {
  id: number;
  sourceSystem: string;
  tenantId: string | null;
  assistanceId: string;
  reason: string;
  priority: string;
  status: EstadoCaso;
  assigneeUserId: string | null;
};

function aCaso(f: Fila): QualityCase {
  return {
    id: Number(f.id),
    sourceSystem: String(f.sourceSystem),
    tenantId: f.tenantId == null ? null : String(f.tenantId),
    assistanceId: String(f.assistanceId),
    reason: String(f.reason),
    priority: String(f.priority),
    status: String(f.status) as EstadoCaso,
    assigneeUserId: f.assigneeUserId == null ? null : String(f.assigneeUserId),
  };
}

const CAMPOS_CASO = `id, "sourceSystem", "tenantId", "assistanceId", reason,
                     priority, status, "assigneeUserId"`;

/** Un caso, siempre acotado por tenant. Igual que las encuestas: sin atajo por id. */
export async function casoDelTenant(
  casoId: number, tenantId: string | null,
): Promise<QualityCase | null> {
  const r = await pool.query(
    `SELECT ${CAMPOS_CASO} FROM quality_cases
      WHERE id = $1 AND ("tenantId" IS NOT DISTINCT FROM $2)`,
    [casoId, tenantId],
  );
  return r.rows.length ? aCaso(r.rows[0]) : null;
}

/**
 * Mueve un caso de estado, validando la transición y dejando la línea en la
 * cronología. Las dos cosas en la misma transacción: un cambio de estado sin
 * rastro es exactamente lo que impide reconstruir el expediente después.
 */
export async function cambiarEstadoCaso(p: {
  casoId: number;
  tenantId: string | null;
  nuevo: EstadoCaso;
  nota?: string | null;
  actor?: { tipo?: string; id?: string | null; nombre?: string | null };
  ahoraMs?: number;
}): Promise<QualityCase> {
  const ahora = p.ahoraMs ?? Date.now();
  return enTransaccion(async (c) => {
    const sel = await c.query(
      `SELECT ${CAMPOS_CASO} FROM quality_cases
        WHERE id = $1 AND ("tenantId" IS NOT DISTINCT FROM $2) FOR UPDATE`,
      [p.casoId, p.tenantId],
    );
    if (!sel.rows.length) {
      throw new ErrorSatisfaction("instancia_no_encontrada", "Caso no encontrado.");
    }
    const actual = aCaso(sel.rows[0]);
    if (!transicionCasoValida(actual.status, p.nuevo)) {
      throw new ErrorSatisfaction(
        "transicion_invalida", `No se puede pasar de ${actual.status} a ${p.nuevo}.`,
      );
    }

    const upd = await c.query(
      `UPDATE quality_cases
          SET status = $2, "updatedAtMs" = $3,
              "resolvedAtMs" = CASE WHEN $2 = 'RESOLVED' THEN COALESCE("resolvedAtMs", $3) ELSE "resolvedAtMs" END,
              "closedAtMs"   = CASE WHEN $2 = 'CLOSED'   THEN COALESCE("closedAtMs", $3)   ELSE "closedAtMs" END
        WHERE id = $1
        RETURNING ${CAMPOS_CASO}`,
      [p.casoId, p.nuevo, ahora],
    );

    await c.query(
      `INSERT INTO quality_case_events
         ("qualityCaseId", "eventType", "actorType", "actorId", "actorName",
          "fromValue", "toValue", note, "occurredAtMs", "createdAtMs")
       VALUES ($1,'STATUS_CHANGED',$2,$3,$4,$5,$6,$7,$8,$8)`,
      [p.casoId, p.actor?.tipo ?? "user", p.actor?.id ?? null, p.actor?.nombre ?? null,
       actual.status, p.nuevo, p.nota ?? null, ahora],
    );

    return aCaso(upd.rows[0]);
  });
}
