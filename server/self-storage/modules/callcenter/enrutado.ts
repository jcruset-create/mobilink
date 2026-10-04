/**
 * Llamada entrante por TELEFONÍA → Call Center → humano | IA | híbrido.
 *
 *   proveedor (Twilio, Telnyx, SIP…) ─▶ parsearEntrante ─▶ registrar la llamada
 *   (idempotente por external_call_id) ─▶ decidirAtencion ─▶ sesión de IA si toca
 *
 * Sin endpoint público todavía: cuando se conecte un proveedor real, su
 * webhook verificará la firma y llamará aquí. La empresa la decide quien
 * llama a esta función (en el futuro, por el número marcado).
 */

import { pool } from "../../shared/db.ts";
import type { Actor } from "../../shared/audit.ts";
import { ErrorSelfStorage } from "../../errors.ts";
import { decidirAtencion } from "../../domain/asistente.ts";
import type { TelephonyProvider } from "../../integrations/telephony/index.ts";
import { crearLlamada, estadoCallCenter } from "./service.ts";

export async function llamadaEntrante(empresaId: string, proveedor: TelephonyProvider, cuerpo: Record<string, unknown>) {
  const cc = await estadoCallCenter(empresaId);
  if (!cc.enabled) throw new ErrorSelfStorage("CALL_CENTER_DESACTIVADO", "El Call Center no está activo para esta empresa.", 409);
  const e = proveedor.parsearEntrante(cuerpo);
  if (!e) throw new ErrorSelfStorage("LLAMADA_NO_VALIDA", "El proveedor no ha enviado una llamada reconocible.", 422);
  // Un reintento del webhook no crea otra llamada.
  const { rows: ya } = await pool.query(
    `SELECT id, handled_by FROM self_storage_calls WHERE empresa_id = $1 AND telephony_provider = $2 AND external_call_id = $3`,
    [empresaId, proveedor.nombre, e.externalCallId]
  );
  if (ya.length) return { callId: ya[0].id as string, handledBy: ya[0].handled_by as "ai" | "human" | "hybrid", sessionId: null, nueva: false };

  // Import diferido: el Call Center no depende del Asistente para funcionar.
  const { estadoAsistente, iniciarSesion } = await import("../asistente/motor.ts");
  const ia = await estadoAsistente(empresaId);
  const atencion = decidirAtencion(ia.mode as "ai" | "human" | "hybrid", ia.enabled, ia.providerAvailable);
  const sistema: Actor = { empresaId, userId: "", nombre: `Telefonía (${proveedor.nombre})`, tipo: "system" };
  const l = await crearLlamada(sistema, { phone: e.from, direction: e.direction, handledBy: atencion, answered: atencion !== "human" }, { telephonyProvider: proveedor.nombre, externalCallId: e.externalCallId });
  let sessionId: string | null = null;
  if (atencion !== "human") sessionId = (await iniciarSesion(sistema, { callId: l.id })).id;
  return { callId: l.id, handledBy: atencion, sessionId, nueva: true };
}
