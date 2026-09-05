/**
 * UN recordatorio. Uno solo, y solo si hace falta.
 *
 * ── Por qué uno ─────────────────────────────────────────────────────────────
 *
 * Porque quien no ha contestado a la primera y a la segunda tampoco va a
 * contestar a la tercera, y a partir de ahí lo único que se consigue es que la
 * gente bloquee el número. Un recordatorio es un favor; dos son spam.
 *
 * ── El mismo enlace ─────────────────────────────────────────────────────────
 *
 * Se manda EXACTAMENTE la misma URL que el mensaje inicial, recuperando el
 * token guardado. Rotarlo dejaría muerto el enlace del primer WhatsApp, que es
 * el que mucha gente tiene todavía en el chat.
 */

import pool from "../db.ts";
import { MARGEN_RECORDATORIO_MS, type RolDestinatario } from "./dominio.ts";
import { adaptadorTwilio, type Adaptador } from "./adaptadorWhatsApp.ts";
import { configEfectiva } from "./config.ts";
import { tokenDe } from "./servicio.ts";
import { urlDeCallback, urlDeValoracion } from "./urlPublica.ts";
import { cambiarEstadoEntrega, referenciaDe, reservarIntento, type Reclamada } from "./envio.ts";
import { enmascararTelefono } from "../core/twilio.ts";

export type ResultadoRecordatorio =
  | { estado: "enviado"; instanceId: number; sid: string }
  | { estado: "omitido"; instanceId: number; motivo: string };

/**
 * Las que ya tocan y todavía tienen sentido.
 *
 * Cada condición está por algo:
 *
 *  · `reminderAfterMs` puesto y cumplido — el momento se congeló al aceptarse
 *    el envío inicial, así que cambiar la configuración hoy no mueve las de
 *    ayer.
 *  · `reminderSentAtMs` a NULL — uno como máximo.
 *  · estado `SENT` o `DELIVERED` — si el inicial nunca llegó a aceptarse, esto
 *    no es un recordatorio: sería el primer mensaje, y con el texto de un
 *    recordatorio.
 *  · sin caducar y con margen — mandar «valóranos» con un enlace que muere en
 *    diez minutos es peor que no mandarlo.
 */
export async function pendientesDeRecordatorio(
  ahoraMs = Date.now(), tope = 25,
): Promise<Reclamada[]> {
  const r = await pool.query(
    `SELECT i.id, i."sourceSystem", i."tenantId", i."assistanceId", i."recipientRole",
            i."recipientPhone", i."expiresAtMs", i."sendAttempts",
            a."clienteFacturacionId", a.plate AS matricula
       FROM survey_instances i
       LEFT JOIN roadside_assistances a
              ON i."sourceSystem" = 'assist' AND a.id = i."assistanceId"::integer
      WHERE i.status IN ('SENT','DELIVERED')
        AND i."reminderAfterMs" IS NOT NULL
        AND i."reminderAfterMs" <= $1
        AND i."reminderSentAtMs" IS NULL
        AND i."expiresAtMs" > $1 + $2
        AND i."recipientPhone" IS NOT NULL
      ORDER BY i."reminderAfterMs"
      LIMIT $3`,
    [ahoraMs, MARGEN_RECORDATORIO_MS, tope],
  );
  return r.rows.map((f) => ({
    id: Number(f.id),
    sourceSystem: String(f.sourceSystem),
    tenantId: f.tenantId == null ? null : String(f.tenantId),
    assistanceId: String(f.assistanceId),
    recipientRole: String(f.recipientRole) as RolDestinatario,
    recipientPhone: f.recipientPhone == null ? null : String(f.recipientPhone),
    expiresAtMs: Number(f.expiresAtMs),
    sendAttempts: Number(f.sendAttempts ?? 0),
    clienteFacturacionId: f.clienteFacturacionId == null ? null : Number(f.clienteFacturacionId),
    matricula: f.matricula == null ? null : String(f.matricula),
  }));
}

/**
 * Manda el recordatorio de una encuesta.
 *
 * Se vuelve a comprobar todo justo antes: entre que se listó y se llega aquí,
 * la persona ha podido contestar. Y el intento se reserva en la tabla igual que
 * el inicial —`(instancia, REMINDER, 1)`—, que es lo que impide que dos workers
 * manden dos.
 */
export async function enviarRecordatorio(
  a: Reclamada, adaptador: Adaptador = adaptadorTwilio, ahoraMs = Date.now(),
): Promise<ResultadoRecordatorio> {
  const omitir = (motivo: string): ResultadoRecordatorio =>
    ({ estado: "omitido", instanceId: a.id, motivo });

  const f = (await pool.query(
    `SELECT status, "expiresAtMs", "reminderSentAtMs" FROM survey_instances WHERE id = $1`,
    [a.id])).rows[0];
  if (!f) return omitir("no_existe");
  if (f.reminderSentAtMs != null) return omitir("ya_recordado");
  if (!["SENT", "DELIVERED"].includes(String(f.status))) return omitir(`estado_${String(f.status)}`);
  if (Number(f.expiresAtMs) <= ahoraMs + MARGEN_RECORDATORIO_MS) return omitir("sin_margen");

  // Con el ámbito entero: el override vive por (sistema, taller, cliente).
  const config = await configEfectiva(a.clienteFacturacionId,
    { sourceSystem: a.sourceSystem as never, tenantId: a.tenantId });
  if (!config.activo) return omitir("satisfaction_disabled");
  if (!config.recordatorio) return omitir("reminder_disabled");

  const token = await tokenDe(a.id);
  if (!token) return omitir("token_no_recuperable");
  const url = urlDeValoracion(token);
  if (!url) return omitir("no_public_base_url");
  const telefono = a.recipientPhone ?? "";
  if (!telefono) return omitir("no_recipient");

  // Misma barrera que el inicial: si ya hay un recordatorio en vuelo, aquí se
  // acaba. Uno como máximo, y lo garantiza el índice, no una comprobación.
  const deliveryId = await reservarIntento({
    instanceId: a.id, tipo: "REMINDER", intento: 1, telefono, ahoraMs,
  });
  if (deliveryId == null) return omitir("recordatorio_ya_reservado");

  const ctx = referenciaDe(a);
  console.log(`[Satisfaction] recordatorio ${a.recipientRole} encuesta#${a.id} ` +
    `→ ${enmascararTelefono(telefono)}`);

  const r = await adaptador.enviar({
    rol: a.recipientRole, tipo: "REMINDER", telefono, url,
    referencia: a.recipientRole === "DRIVER" ? (ctx.matricula || ctx.referencia) : ctx.referencia,
    statusCallback: urlDeCallback(),
  });

  if (r.estado === "aceptado") {
    await cambiarEstadoEntrega({ deliveryId, hasta: "SENT", sid: r.sid, ahoraMs });
    await pool.query(
      `UPDATE survey_instances SET "reminderSentAtMs" = COALESCE("reminderSentAtMs", $2)
        WHERE id = $1`, [a.id, ahoraMs]);
    return { estado: "enviado", instanceId: a.id, sid: r.sid };
  }

  if (r.estado === "sin_configurar") {
    await cambiarEstadoEntrega({ deliveryId, hasta: "SKIPPED", errorCode: r.motivo, ahoraMs });
    /*
     * La fila del intento se BORRA para que el día que se configure la
     * plantilla el recordatorio pueda salir. Es la única fila que se borra en
     * todo el módulo y tiene motivo: `(instancia, REMINDER, 1)` es única, así
     * que dejarla ahí cerraría la puerta para siempre por un `contentSid` que
     * faltaba un martes. El bloqueo queda en el log y en el estado de la
     * encuesta, no en una fila de entrega que nunca se intentó.
     */
    await pool.query(`DELETE FROM survey_deliveries WHERE id = $1`, [deliveryId]);
    return omitir(r.motivo);
  }

  if (r.estado === "desconocido") {
    // Igual que en el inicial: no se sabe si salió, así que no se repite.
    await cambiarEstadoEntrega({ deliveryId, hasta: "UNKNOWN", errorMessage: r.mensaje, ahoraMs });
    return omitir("respuesta_desconocida");
  }

  await cambiarEstadoEntrega({
    deliveryId, hasta: "FAILED", errorCode: r.codigo, errorMessage: r.mensaje, ahoraMs });
  /*
   * Un recordatorio fallido NO se reintenta y NO toca el estado de la encuesta:
   * el mensaje que importaba —el inicial— sí llegó, y la encuesta sigue viva y
   * contestable hasta que caduque.
   */
  await pool.query(
    `UPDATE survey_instances SET "reminderSentAtMs" = COALESCE("reminderSentAtMs", $2)
      WHERE id = $1`, [a.id, ahoraMs]);
  return omitir(`rechazado_${r.codigo}`);
}
