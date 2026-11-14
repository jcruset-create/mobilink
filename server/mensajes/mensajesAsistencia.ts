/**
 * Mensajes entre la oficina y la tablet del operario de una asistencia.
 *
 * Solo mientras la asistencia está abierta y tiene operario: es para avisar a
 * quien está en la calle («entra por la puerta 3», «lleva una llanta de
 * 22,5»), no un chat general. El cliente nunca los ve.
 *
 * ── Los estados de un mensaje de la oficina ─────────────────────────────────
 *
 *   enviado  → la oficina lo ha mandado.
 *   recibido → la tablet lo ha recogido (`recibidoAtMs`).
 *   leído    → el operario ha pulsado «Entendido» o ha contestado.
 *
 * ── Urgente y «escalado» ────────────────────────────────────────────────────
 *
 * Un mensaje NORMAL suena una vez al llegar y se queda en pantalla. Uno
 * URGENTE suena cada 15 s hasta que se lee. Y uno normal que lleva más de
 * `ESCALADO_MS` sin leer pasa a tratarse como urgente: suena cada 15 s en la
 * tablet y sale en rojo en el panel. Se deduce de las horas, no se guarda: así
 * no hace falta ningún proceso que lo vaya cambiando.
 */

import db from "../db.ts";

export const ESCALADO_MS = 3 * 60_000;

/** Los estados en que una asistencia ya no acepta mensajes. */
export const ESTADOS_CERRADOS = ["llegada_taller", "cancelada", "redirigida"];

/** Textos rápidos de la oficina y respuestas rápidas del operario. */
export const TEXTOS_RAPIDOS_OFICINA = [
  "Llama a la oficina",
  "Cambio de dirección, mira la asistencia",
  "El cliente te espera",
  "Cancelada, vuelve al taller",
];
export const RESPUESTAS_RAPIDAS = ["Voy", "Llamo ahora", "Necesito ayuda"];

export const MAX_TEXTO = 1000;

export type Mensaje = {
  id: number;
  assistanceId: number;
  techName: string;
  /** «oficina» = de la oficina a la tablet; «operario» = la respuesta. */
  de: "oficina" | "operario";
  texto: string;
  urgente: boolean;
  autor: string | null;
  creadoAtMs: number;
  recibidoAtMs: number | null;
  leidoAtMs: number | null;
};

export type MensajeConEstado = Mensaje & {
  estado: "enviado" | "recibido" | "leido" | "respuesta";
  /** Normal sin leer pasado ESCALADO_MS: se trata como urgente. */
  escalado: boolean;
  /** Suena cada 15 s en la tablet: urgente o escalado, y sin leer. */
  repetirSonido: boolean;
  sinLeerMin: number | null;
};

export function conEstado(m: Mensaje, ahoraMs: number): MensajeConEstado {
  if (m.de === "operario") {
    return { ...m, estado: "respuesta", escalado: false, repetirSonido: false, sinLeerMin: null };
  }
  const leido = m.leidoAtMs != null;
  const escalado = !leido && !m.urgente && ahoraMs - m.creadoAtMs >= ESCALADO_MS;
  return {
    ...m,
    estado: leido ? "leido" : m.recibidoAtMs != null ? "recibido" : "enviado",
    escalado,
    repetirSonido: !leido && (m.urgente || escalado),
    sinLeerMin: leido ? null : Math.floor((ahoraMs - m.creadoAtMs) / 60_000),
  };
}

function aMensaje(r: any): Mensaje {
  return {
    id: Number(r.id),
    assistanceId: Number(r.assistanceId),
    techName: String(r.techName),
    de: r.de === "operario" ? "operario" : "oficina",
    texto: String(r.texto),
    urgente: r.urgente === true,
    autor: r.autor ?? null,
    creadoAtMs: Number(r.creadoAtMs),
    recibidoAtMs: r.recibidoAtMs != null ? Number(r.recibidoAtMs) : null,
    leidoAtMs: r.leidoAtMs != null ? Number(r.leidoAtMs) : null,
  };
}

export class ErrorMensaje extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function limpiarTexto(texto: unknown): string {
  const t = String(texto ?? "").trim();
  if (!t) throw new ErrorMensaje(400, "Escribe el mensaje");
  if (t.length > MAX_TEXTO) throw new ErrorMensaje(400, `Máximo ${MAX_TEXTO} caracteres`);
  return t;
}

/** La asistencia, si está abierta y con operario: si no, no hay a quién mandar. */
async function asistenciaAbierta(assistanceId: number): Promise<{ techName: string }> {
  const r = await db.query(
    `SELECT status, "assignedTechName" FROM roadside_assistances WHERE id = $1`,
    [assistanceId]
  );
  const a = r.rows[0];
  if (!a) throw new ErrorMensaje(404, "Asistencia no encontrada");
  if (ESTADOS_CERRADOS.includes(String(a.status))) {
    throw new ErrorMensaje(409, "La asistencia está cerrada: ya no se pueden mandar mensajes");
  }
  if (!a.assignedTechName) throw new ErrorMensaje(409, "La asistencia no tiene operario asignado");
  return { techName: String(a.assignedTechName) };
}

/** La oficina manda un mensaje a la tablet del operario de la asistencia. */
export async function enviarDesdeOficina(args: {
  assistanceId: number;
  texto: unknown;
  urgente: boolean;
  autor: string | null;
  ahoraMs?: number;
}): Promise<Mensaje> {
  const texto = limpiarTexto(args.texto);
  const { techName } = await asistenciaAbierta(args.assistanceId);
  const r = await db.query(
    `INSERT INTO asistencia_mensajes ("assistanceId", "techName", de, texto, urgente, autor, "creadoAtMs")
     VALUES ($1, $2, 'oficina', $3, $4, $5, $6) RETURNING *`,
    [args.assistanceId, techName, texto, args.urgente === true, args.autor, args.ahoraMs ?? Date.now()]
  );
  return aMensaje(r.rows[0]);
}

/**
 * El operario contesta. Contestar cuenta como leído: quien responde «Voy» ha
 * leído lo que le han dicho.
 */
export async function responderDesdeTablet(args: {
  assistanceId: number;
  techName: string;
  texto: unknown;
  ahoraMs?: number;
}): Promise<Mensaje> {
  const texto = limpiarTexto(args.texto);
  const { techName } = await asistenciaAbierta(args.assistanceId);
  if (techName !== args.techName) throw new ErrorMensaje(403, "La asistencia no está asignada a ti");
  const ahora = args.ahoraMs ?? Date.now();
  await marcarLeidosDeAsistencia(args.assistanceId, args.techName, ahora);
  const r = await db.query(
    `INSERT INTO asistencia_mensajes ("assistanceId", "techName", de, texto, urgente, autor, "creadoAtMs", "recibidoAtMs", "leidoAtMs")
     VALUES ($1, $2, 'operario', $3, false, $2, $4, $4, $4) RETURNING *`,
    [args.assistanceId, args.techName, texto, ahora]
  );
  return aMensaje(r.rows[0]);
}

export async function listarDeAsistencia(assistanceId: number, ahoraMs = Date.now()) {
  const r = await db.query(
    `SELECT * FROM asistencia_mensajes WHERE "assistanceId" = $1 ORDER BY "creadoAtMs", id`,
    [assistanceId]
  );
  return r.rows.map((row: any) => conEstado(aMensaje(row), ahoraMs));
}

/**
 * Lo que la tablet tiene que enseñar: los mensajes de la oficina sin leer, de
 * asistencias abiertas de este operario. Al recogerlos quedan «recibidos».
 */
export async function pendientesDeOperario(techName: string, ahoraMs = Date.now()) {
  const r = await db.query(
    `UPDATE asistencia_mensajes m
        SET "recibidoAtMs" = COALESCE(m."recibidoAtMs", $2)
       FROM roadside_assistances a
      WHERE a.id = m."assistanceId"
        AND m."techName" = $1 AND a."assignedTechName" = $1
        AND m.de = 'oficina' AND m."leidoAtMs" IS NULL
        AND a.status <> ALL($3::text[])
      RETURNING m.*`,
    [techName, ahoraMs, ESTADOS_CERRADOS]
  );
  return r.rows
    .map((row: any) => conEstado(aMensaje(row), ahoraMs))
    .sort((x: MensajeConEstado, y: MensajeConEstado) => x.creadoAtMs - y.creadoAtMs);
}

/** «Entendido»: un mensaje, solo si es de este operario. */
export async function marcarLeido(id: number, techName: string, ahoraMs = Date.now()): Promise<boolean> {
  const r = await db.query(
    `UPDATE asistencia_mensajes
        SET "leidoAtMs" = COALESCE("leidoAtMs", $3), "recibidoAtMs" = COALESCE("recibidoAtMs", $3)
      WHERE id = $1 AND "techName" = $2 AND de = 'oficina'`,
    [id, techName, ahoraMs]
  );
  return (r.rowCount ?? 0) > 0;
}

async function marcarLeidosDeAsistencia(assistanceId: number, techName: string, ahoraMs: number) {
  await db.query(
    `UPDATE asistencia_mensajes
        SET "leidoAtMs" = $3, "recibidoAtMs" = COALESCE("recibidoAtMs", $3)
      WHERE "assistanceId" = $1 AND "techName" = $2 AND de = 'oficina' AND "leidoAtMs" IS NULL`,
    [assistanceId, techName, ahoraMs]
  );
}
