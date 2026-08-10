/**
 * Captura de WhatsApp compartida por Mobilink Assist y Assist Central Pro.
 *
 * Hay un único número de WhatsApp de entrada: el webhook de Twilio
 * (/api/whatsapp/inbound) encamina cada mensaje a la ÚNICA sesión de captura
 * activa, sea de una asistencia del core (`job_id`) o de Central Pro
 * (`connect_assistance_id`), o de un alta que todavía no existe (las dos a
 * null: la sesión se vincula después, al crear la asistencia).
 *
 * Aquí vive el análisis con IA de la sesión, para que ambos productos lean
 * exactamente lo mismo de los mismos mensajes.
 */

import db from "../db.ts";
import { extractJson, AI_IMAGE_RULES } from "./ai.ts";

/** Para qué se abrió la captura: decide con qué prompt la lee la IA. */
export type CapturePurpose = "assistance" | "workshop";

export interface CaptureSession {
  id: number;
  job_id: number | null;
  connect_assistance_id: number | null;
  purpose: CapturePurpose;
  status: "ACTIVE" | "CLOSED";
  started_at: number;
  ended_at: number | null;
  created_by: string | null;
  ai_suggestions: any;
  ai_status: "pending" | "done" | "error" | null;
  ai_error: string | null;
  ai_started_at: number | null;
}

/** Devuelve la sesión activa (solo puede haber una: un único número). */
export async function activeCaptureSession(): Promise<CaptureSession | null> {
  const r = await db.query(
    `SELECT * FROM whatsapp_capture_sessions WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1`,
  );
  return r.rows[0] ? normalize(r.rows[0]) : null;
}

export function normalize(row: any): CaptureSession {
  let ai = row.ai_suggestions;
  if (typeof ai === "string") { try { ai = JSON.parse(ai); } catch { ai = null; } }
  return {
    ...row,
    purpose: row.purpose === "workshop" ? "workshop" : "assistance",
    started_at: row.started_at ? Number(row.started_at) : 0,
    ended_at: row.ended_at ? Number(row.ended_at) : null,
    ai_suggestions: ai ?? null,
    ai_started_at: row.ai_started_at ? Number(row.ai_started_at) : null,
  };
}

/** Para qué se abrió la sesión (las anteriores a esta columna son de asistencia). */
export async function capturePurpose(sessionId: number): Promise<CapturePurpose> {
  const r = await db.query(`SELECT purpose FROM whatsapp_capture_sessions WHERE id = $1`, [sessionId]);
  return r.rows[0]?.purpose === "workshop" ? "workshop" : "assistance";
}

/** Mensajes de una sesión, en orden de llegada. */
export async function captureMessages(sessionId: number): Promise<any[]> {
  const r = await db.query(
    `SELECT id, session_id, message_type, text_content, media_url, media_stored_url,
            latitude, longitude, address, contact_name, contact_phone, transcript,
            transcript_status, from_phone, received_at
       FROM whatsapp_capture_messages WHERE session_id = $1 ORDER BY received_at ASC`,
    [sessionId],
  );
  return r.rows.map((m: any) => ({ ...m, received_at: Number(m.received_at) }));
}

/**
 * Analiza la sesión con IA: texto, audios transcritos e imágenes.
 *
 * Las fotos de documentos llegan muchas veces como "document"; si son imagen
 * también se leen. Todo lo relevante que no encaje en un campo concreto vuelve
 * en `datosDetectados` para no perderlo.
 */
async function captureContext(sessionId: number): Promise<{ lines: string[]; imageUrls: string[] } | null> {
  const messages = await captureMessages(sessionId);
  if (!messages.length) return null;

  const lines: string[] = [];
  const imageUrls: string[] = [];
  for (const m of messages) {
    const hora = m.received_at
      ? new Date(m.received_at).toLocaleTimeString("es-ES", { hour12: false, timeZone: "Europe/Madrid" })
      : "";
    const ts = hora ? ` ${hora}` : "";
    // Solo la copia almacenada (Supabase, pública): la URL original de Twilio
    // exige Basic Auth, OpenAI no puede descargarla y tumba todo el análisis.
    const url = m.media_stored_url
      || (m.media_url && !/\btwilio\.com\//i.test(m.media_url) ? m.media_url : null);
    if (m.message_type === "text" && m.text_content) lines.push(`[TEXTO${ts}] ${m.text_content}`);
    else if (m.message_type === "location") lines.push(`[UBICACION${ts}] lat=${m.latitude} lng=${m.longitude}${m.address ? ` dir="${m.address}"` : ""}`);
    else if (m.message_type === "contact") lines.push(`[CONTACTO${ts}] nombre="${m.contact_name}" tel="${m.contact_phone}"`);
    else if (m.message_type === "image") {
      if (url) imageUrls.push(url);
      lines.push(`[IMAGEN${ts} enviada]`);
    } else if (m.message_type === "audio") {
      lines.push(m.transcript ? `[AUDIO${ts} transcrito] ${m.transcript}` : `[AUDIO${ts} sin transcribir]`);
    } else if (m.message_type === "document") {
      if (url && /\.(jpe?g|png|webp|heic|heif)(\?|$)/i.test(url)) imageUrls.push(url);
      lines.push(`[DOCUMENTO${ts}]`);
    }
  }
  return { lines, imageUrls };
}

export async function analyzeCaptureSession(sessionId: number): Promise<Record<string, any>> {
  const ctx = await captureContext(sessionId);
  if (!ctx) return {};
  const { lines, imageUrls } = ctx;

  const system = `Eres un asistente de una empresa de asistencia en carretera.
Analiza los mensajes e imágenes de WhatsApp de una incidencia y extrae la información relevante.

${AI_IMAGE_RULES}

UBICACIONES MÚLTIPLES:
- Si la sesión contiene varias ubicaciones GPS, usa SIEMPRE la más reciente para latitude/longitude/address/municipio/provincia: una ubicación posterior corrige a la anterior.
- Excepción: si un mensaje de texto o audio posterior dice lo contrario (p. ej. "la buena es la primera"), obedece al texto.
- Si difieren mucho y no hay texto que lo aclare, usa la última, baja "confidence" a "medium" y dilo en "resumen".

CAMPOS DE MATRÍCULA:
- La BLANCA va en "plate" y la ROJA del remolque en "plateRemolque", sin espacios ni guiones.

Responde SOLO con JSON válido, sin markdown. Campos (null si no consta):
{
  "customerName": string, "conductorNombre": string, "empresa": string,
  "contactoNombre": string, "contactoTelefono": string, "conductorTelefono": string,
  "plate": string, "plateRemolque": string,
  "vehicleBrand": string, "vehicleModel": string, "vehicleDescription": string,
  "latitude": number, "longitude": number, "address": string,
  "municipio": string, "provincia": string,
  "tipoAveria": string, "descripcionAveria": string,
  "datosDetectados": [{ "campo": string, "valor": string, "origen": "imagen"|"texto"|"audio" }],
  "resumen": string, "confidence": "high"|"medium"|"low"
}

"datosDetectados" es para todo dato relevante leído que NO encaje arriba (póliza,
aseguradora, albarán, DNI, empresa de transporte, expediente del cliente,
kilómetros, medida de neumático, contacto alternativo…). Si no hay nada, lista vacía.`;

  return extractJson({
    system,
    text: `Mensajes de la sesión:\n${lines.join("\n")}`,
    images: imageUrls,
    // Holgura para modelos razonadores: gastan salida en razonar antes de
    // emitir el JSON; con 900 la respuesta llegaba cortada.
    maxTokens: 3000,
    // El motivo del fallo acaba en ai_error, visible en el backoffice.
    strict: true,
  });
}

/**
 * Analiza la sesión buscando ALTAS DE TALLER, no incidencias: es lo que llega
 * cuando alguien reenvía por WhatsApp la ficha de Google de un taller, una
 * tarjeta o una captura de pantalla.
 *
 * Devuelve los campos con los nombres de `connect_workshops`, para que lo que
 * sale de la IA sea exactamente lo que entra en Central sin traducciones por
 * el camino. Lo que Google da pero Central no guarda (valoración, reseñas,
 * web, URL de Maps, categorías) vuelve en `datosDetectados`.
 */
export async function analyzeWorkshopCaptureSession(sessionId: number): Promise<Record<string, any>> {
  const ctx = await captureContext(sessionId);
  if (!ctx) return {};
  const { lines, imageUrls } = ctx;

  const system = `Eres un asistente de alta de talleres de una red de asistencia en carretera.
Analiza los mensajes e imágenes de WhatsApp y extrae los talleres que aparezcan.

${AI_IMAGE_RULES}

REGLAS INNEGOCIABLES:
- Extrae SOLO datos verificables que estén escritos en los mensajes o visibles en las imágenes. Lo que no conste va a null. No completes direcciones, teléfonos ni coordenadas "de memoria".
- No puedes abrir enlaces. Si un taller llega solo como enlace (share.google, maps.app.goo.gl, goo.gl/maps…) y no hay más datos ni captura, NO deduzcas nada del enlace: añádelo a "avisos" pidiendo el enlace completo o una captura de la ficha.
- Comprueba que sea un negocio de automoción (taller mecánico, neumáticos, carrocería, electricidad del automóvil, grúa, ITV…). Si no lo es, no lo incluyas y dilo en "avisos".
- Si hay varios talleres, devuelve un registro por cada uno.
- Conserva el nombre comercial tal cual lo muestra Google en "name", pero límpialo de comillas, emojis y reclamos publicitarios.
- Coordenadas en decimal con punto. Teléfonos con prefijo internacional cuando se pueda deducir del propio número (España: +34).

Responde SOLO con JSON válido, sin markdown (null si no consta):
{
  "talleres": [{
    "name": string,
    "companyName": string,          // empresa propietaria, si consta (Grupo Soledad…)
    "commercialNetwork": string,    // red o franquicia (Confortauto, Euromaster…)
    "address": string,              // calle y número, sin CP ni municipio
    "postalCode": string,
    "city": string,
    "province": string,
    "latitude": number, "longitude": number,
    "phone": string, "email": string,
    "openingHours": string,         // en una línea: "L-V 08:30-13:30|15:00-18:30; Sáb 09:00-13:00"
    "services": string[],           // SOLO estos códigos: tow_truck, mechanical, tyres, battery, fuel, lockout, electric_vehicle, heavy_vehicle, machinery, other
    "datosDetectados": [{ "campo": string, "valor": string, "origen": "imagen"|"texto"|"audio" }],
    "confidence": "high"|"medium"|"low"
  }],
  "avisos": [string],
  "resumen": string
}

"datosDetectados" es para lo relevante que no encaja arriba: valoración de Google,
número de reseñas, sitio web, URL de Google Maps, categorías, estado del negocio
(abierto / cerrado temporalmente / cerrado permanentemente), persona de contacto,
CIF… Si no hay nada, lista vacía.`;

  return extractJson({
    system,
    text: `Mensajes de la sesión:\n${lines.join("\n")}`,
    images: imageUrls,
    maxTokens: 3000,
    strict: true,
  });
}

/**
 * Guarda el análisis en la sesión (se llama al cerrarla), dejando rastro del
 * estado en ai_status/ai_error. Antes un fallo devolvía {} sin persistir nada
 * y la sesión quedaba "Analizando con IA…" para siempre en el backoffice.
 */
export async function saveCaptureAnalysis(sessionId: number): Promise<Record<string, any>> {
  await db.query(
    `UPDATE whatsapp_capture_sessions
     SET ai_status = 'pending', ai_error = NULL, ai_started_at = $2
     WHERE id = $1`,
    [sessionId, Date.now()],
  );
  const purpose = await capturePurpose(sessionId);
  let suggestions: Record<string, any> = {};
  let failure: string | null = null;
  try {
    suggestions = purpose === "workshop"
      ? await analyzeWorkshopCaptureSession(sessionId)
      : await analyzeCaptureSession(sessionId);
    if (Object.keys(suggestions).length === 0) {
      // Con strict, los fallos del proveedor llegan por el catch con su motivo;
      // aquí solo queda el caso de una sesión sin nada que extraer.
      failure = "La IA no encontró ningún dato en los mensajes de la sesión.";
    }
  } catch (e: any) {
    failure = `Error analizando con IA: ${e?.message ?? e}`;
  }

  if (failure) {
    await db.query(
      `UPDATE whatsapp_capture_sessions SET ai_status = 'error', ai_error = $2 WHERE id = $1`,
      [sessionId, failure],
    );
    console.error(`WhatsApp capture session #${sessionId}: ${failure}`);
    return {};
  }
  await db.query(
    `UPDATE whatsapp_capture_sessions
     SET ai_suggestions = $2, ai_status = 'done', ai_error = NULL
     WHERE id = $1`,
    [sessionId, JSON.stringify(suggestions)],
  );
  return suggestions;
}

/** Pasado este tiempo, un análisis 'pending' se da por perdido. */
const AI_ANALYSIS_TIMEOUT_MS = 3 * 60 * 1000;

/**
 * Corrige el estado de sesiones que quedaron en el aire: cerradas antes de que
 * existiera ai_status, o con un análisis 'pending' cuya promesa murió con un
 * reinicio del proceso (Render). Muta `session` además de persistir, para que
 * la respuesta en curso ya salga con el estado bueno.
 */
export async function reconcileCaptureAiStatus(session: any): Promise<void> {
  if (session.status !== "CLOSED") return;

  if (!session.ai_status) {
    if (session.ai_suggestions) {
      session.ai_status = "done";
      session.ai_error = null;
    } else {
      session.ai_status = "error";
      session.ai_error = "El análisis no llegó a completarse. Pulsa «Reintentar análisis».";
    }
    await db.query(
      `UPDATE whatsapp_capture_sessions SET ai_status = $2, ai_error = $3 WHERE id = $1`,
      [session.id, session.ai_status, session.ai_error],
    );
    return;
  }

  if (session.ai_status === "pending") {
    const started = session.ai_started_at ? Number(session.ai_started_at) : null;
    if (!started || Date.now() - started > AI_ANALYSIS_TIMEOUT_MS) {
      session.ai_status = "error";
      session.ai_error = "El análisis se interrumpió antes de terminar. Pulsa «Reintentar análisis».";
      await db.query(
        `UPDATE whatsapp_capture_sessions SET ai_status = 'error', ai_error = $2 WHERE id = $1`,
        [session.id, session.ai_error],
      );
    }
  }
}
