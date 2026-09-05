/**
 * Satisfaction: servicio.
 *
 * ── Crear la encuesta y emitir su token son dos momentos distintos ──────────
 *
 * En la base solo vive el sha256 del token, así que el valor en claro existe
 * una vez y se pierde. Si se generara al crear la instancia —al cerrar la
 * asistencia— media hora después, cuando el worker va a mandar el WhatsApp, ya
 * no habría enlace que poner: solo un hash con el que no se puede construir
 * nada.
 *
 * Por eso `crearSurveyInstance` NO genera token. La instancia nace sin él
 * (`tokenHash` a NULL) y `emitirToken` lo crea justo antes del envío,
 * devolviéndolo una vez a quien va a redactar el mensaje.
 *
 * Eso resuelve de paso el problema que tenía la creación idempotente: ya no
 * hay nada que devolver «solo la primera vez», así que crear dos veces es
 * sencillamente crear dos veces y la segunda no miente sobre nada.
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
  sendAfterMs: number;
  createdAtMs: number;
  completedAtMs: number | null;
  /** El destinatario congelado al crear. Interno: no sale por ninguna API. */
  recipientPhone: string | null;
  /** `true` cuando ya se ha emitido el token. Nunca se expone el valor. */
  tokenEmitido: boolean;
};

export type ResultadoCreacion = {
  estado: "created" | "already_exists";
  instancia: SurveyInstance;
};

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
    sendAfterMs: Number(f.sendAfterMs ?? 0),
    createdAtMs: Number(f.createdAtMs),
    completedAtMs: f.completedAtMs == null ? null : Number(f.completedAtMs),
    recipientPhone: f.recipientPhone == null ? null : String(f.recipientPhone),
    tokenEmitido: f.tokenEmitido === true,
  };
}

/*
 * Nótese que `token` NO está aquí: la instancia que circula por el código no
 * lleva el valor en claro. Quien lo necesita —el envío y el recordatorio— lo
 * pide expresamente con `tokenDe()`, y así no puede colarse en una respuesta
 * de API por arrastre.
 */
const CAMPOS = `id, "sourceSystem", "tenantId", "assistanceId", "recipientRole",
                "templateId", "templateVersion", status, "expiresAtMs",
                "sendAfterMs", "createdAtMs", "completedAtMs", "recipientPhone",
                ("tokenHash" IS NOT NULL) AS "tokenEmitido"`;

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
  /** De la configuración efectiva, ya congelada por quien llama. */
  caducidadMs?: number;
  retrasoMs?: number;
  /**
   * El teléfono al que se mandará, **congelado aquí** (1G).
   *
   * Se guarda ya normalizado. Sin esto, una encuesta creada hoy para un número
   * se mandaría mañana a otro porque alguien editó la ficha del cliente entre
   * medias: la encuesta pertenece al destinatario que se resolvió cuando se
   * creó, y cambiar de número tiene que ser una decisión explícita.
   */
  recipientPhone?: string | null;
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

  /*
   * Las dos fechas se calculan AHORA y se guardan. Derivarlas después de la
   * configuración global significaría que cambiar el retraso o la caducidad
   * movería de sitio encuestas ya creadas, incluidas las que ya se mandaron.
   */
  const expiresAtMs = ahora + (p.caducidadMs ?? CADUCIDAD_POR_DEFECTO_MS);
  const sendAfterMs = ahora + (p.retrasoMs ?? 0);

  const insertado = await pool.query(
    `INSERT INTO survey_instances
       ("sourceSystem", "tenantId", "assistanceId", "recipientRole",
        "templateId", "templateVersion", status, "expiresAtMs", "sendAfterMs", "createdAtMs",
        "recipientPhone")
     VALUES ($1,$2,$3,$4,$5,$6,'CREATED',$7,$8,$9,$10)
     ON CONFLICT ("sourceSystem", "assistanceId", "recipientRole") DO NOTHING
     RETURNING ${CAMPOS}`,
    [sourceSystem, tenantId, assistanceId, p.recipientRole,
     plantilla.id, plantilla.version, expiresAtMs, sendAfterMs, ahora,
     p.recipientPhone ?? null],
  );

  if (insertado.rows.length) {
    return { estado: "created", instancia: aInstancia(insertado.rows[0]) };
  }

  // Otro proceso ganó la carrera entre el SELECT y el INSERT: la suya vale.
  const carrera = await pool.query(
    `SELECT ${CAMPOS} FROM survey_instances
      WHERE "sourceSystem" = $1 AND "assistanceId" = $2 AND "recipientRole" = $3`,
    [sourceSystem, assistanceId, p.recipientRole],
  );
  return { estado: "already_exists", instancia: aInstancia(carrera.rows[0]) };
}

/* ── Emisión del token ───────────────────────────────────────────────────── */

/**
 * `ya_emitido` trae el token desde 1G.
 *
 * En 1C.2 no traía nada, y ahí estaba el agujero: un reintento se enteraba de
 * que el token existía y no podía usarlo. Sigue llevando `token` opcional
 * porque una encuesta de antes de 1G tiene hash pero no valor en claro.
 */
export type ResultadoToken =
  | { estado: "emitido"; token: string }
  | { estado: "ya_emitido"; token?: string }
  | { estado: "no_procede"; motivo: "completada" | "caducada" | "cancelada" };

/**
 * Emite el token público de una encuesta y lo devuelve UNA vez.
 *
 * Se llama justo antes de construir el mensaje, no al crear la encuesta: en la
 * base solo queda el sha256, así que el valor en claro hay que usarlo en el
 * momento o se pierde.
 *
 * **No reemite.** Si ya hay un hash, contesta `ya_emitido` y no devuelve nada.
 * Es lo que impide que un reintento del worker genere un enlace nuevo y deje
 * muerto el que ya se mandó por WhatsApp. Para el caso legítimo de reenvío
 * está `rotarToken`, que es explícito y dice que invalida el anterior.
 *
 * El `WHERE "tokenHash" IS NULL` hace la emisión atómica: si dos procesos lo
 * intentan a la vez, solo uno actualiza la fila y el otro se lleva
 * `ya_emitido`, que es exactamente lo que debe pasar.
 */
export async function emitirToken(
  instanceId: number, ambito: Ambito, ahoraMs = Date.now(),
): Promise<ResultadoToken> {
  const actual = await instanciaDelAmbito(instanceId, ambito);
  if (!actual) throw new ErrorSatisfaction("instancia_no_encontrada", "Encuesta no encontrada.");
  if (actual.status === "COMPLETED") return { estado: "no_procede", motivo: "completada" };
  if (actual.status === "CANCELLED") return { estado: "no_procede", motivo: "cancelada" };
  if (actual.expiresAtMs <= ahoraMs) return { estado: "no_procede", motivo: "caducada" };
  if (actual.tokenEmitido) return { estado: "ya_emitido" };

  const token = generarToken();
  const r = await pool.query(
    `UPDATE survey_instances
        SET "tokenHash" = $2, token = $4, "tokenIssuedAtMs" = $3
      WHERE id = $1 AND "tokenHash" IS NULL
      RETURNING id`,
    [instanceId, hashToken(token), ahoraMs, token],
  );
  if (r.rows.length) return { estado: "emitido", token };

  /*
   * Ya estaba emitido: se devuelve EL MISMO, no otro.
   *
   * Es lo que arregla la ventana de caída de 1C.2. Antes, un proceso que moría
   * entre emitir y llamar a Twilio dejaba en la base un hash irreconstruible y
   * el enlace se perdía; y un recordatorio 24 h después no podía escribir la
   * misma URL. Ahora el reintento recupera el token que ya se emitió y manda
   * exactamente el enlace que tocaba. Ver el comentario del esquema sobre por
   * qué el token se guarda en claro.
   */
  const guardado = await tokenDe(instanceId);
  return guardado ? { estado: "ya_emitido", token: guardado } : { estado: "ya_emitido" };
}

/**
 * Cambia el token de una encuesta y devuelve el nuevo.
 *
 * **Invalida el enlace anterior**, y por eso está separado de `emitirToken`:
 * ése no reemite nunca, precisamente para que un reintento no deje muerto un
 * enlace ya enviado. Rotar es una decisión, y quien la toma sabe que el
 * WhatsApp anterior deja de funcionar.
 */
/**
 * El token en claro de una encuesta, si se emitió.
 *
 * De uso INTERNO: lo llaman el envío y el recordatorio para construir la URL.
 * No sale por ninguna API, ni por la ficha, ni por la bandeja, ni por el
 * dashboard, y no se escribe en ningún log.
 */
export async function tokenDe(instanceId: number): Promise<string | null> {
  const r = await pool.query(`SELECT token FROM survey_instances WHERE id = $1`, [instanceId]);
  return r.rows[0]?.token ?? null;
}

export async function rotarToken(instanceId: number, ambito: Ambito): Promise<string> {
  const token = generarToken();
  const r = await pool.query(
    `UPDATE survey_instances SET "tokenHash" = $2, token = $6
      WHERE id = $1 AND "sourceSystem" = $3 AND "assistanceId" = $4
        AND ("tenantId" IS NOT DISTINCT FROM $5)
        AND status <> 'COMPLETED'
      RETURNING id`,
    [instanceId, hashToken(token), ambito.sourceSystem, ambito.assistanceId, ambito.tenantId, token],
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
