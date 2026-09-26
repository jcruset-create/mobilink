/**
 * Lo que la confirmación de citas escribe en la base.
 *
 * Aparte de `server/index.ts` a propósito: ahí viven los endpoints y no la
 * lógica. Aquí está el acceso a `scheduled_jobs`, y las decisiones —qué estado
 * gana, a qué cita corresponde una respuesta— están en
 * `src/modules/confirmacionCita.ts`, que es puro y se prueba sin base de datos.
 *
 * ── `scheduled_jobs.data` es JSONB ──────────────────────────────────────────
 *
 * Comprobado contra producción, no contra el código: el endpoint devuelve
 * `row.data` sin tocar y llegan objetos, no cadenas. `node-postgres` solo hace
 * eso con `json`/`jsonb`.
 *
 * Se escribe pasando `JSON.stringify` a un parámetro, que es lo que hace el
 * resto del código y lo que Postgres admite para una columna jsonb. No hace
 * falta `jsonb_set` y no hay ninguna migración que hacer.
 *
 * ── Leer, tocar y escribir la cita entera ───────────────────────────────────
 *
 * Y no un `jsonb_set` por campo, porque una confirmación cambia cuatro o cinco
 * claves a la vez y querríamos que entraran todas o ninguna. Se hace bajo
 * `FOR UPDATE` para que dos callbacks simultáneos no se pisen: Twilio manda
 * `delivered` y `read` casi a la vez, y sin el bloqueo el segundo puede leer el
 * estado de antes del primero y retroceder.
 */

import db from "../db.ts";
import { aE164 } from "../core/twilio.ts";
import {
  campoDeFechaDeEstado,
  estadoEnvioAdelanta,
  type CitaCandidata,
  type EstadoEnvioWhatsapp,
} from "../../src/modules/confirmacionCita.ts";

/** Una cita tal y como vive en la base. */
export type CitaGuardada = Record<string, any>;

/**
 * Aplica unos cambios al JSON de una cita.
 *
 * Devuelve la cita ya cambiada, o `null` si no existe. Quien llama decide qué
 * cambia; aquí solo se garantiza que se lee y se escribe sin que nadie se
 * cuele en medio.
 */
export async function cambiarCita(
  id: number,
  cambios: (cita: CitaGuardada) => Record<string, unknown> | null
): Promise<CitaGuardada | null> {
  const cliente = await db.connect();
  try {
    await cliente.query("BEGIN");

    const fila = await cliente.query(
      `SELECT data FROM scheduled_jobs WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (fila.rowCount === 0) {
      await cliente.query("ROLLBACK");
      return null;
    }

    // Por si alguna fila antigua guardó una cadena: cuesta una línea y ahorra
    // un 500 que nadie sabría explicar.
    const cruda = fila.rows[0].data;
    const cita: CitaGuardada = typeof cruda === "string" ? JSON.parse(cruda) : { ...cruda };

    const nuevos = cambios(cita);
    if (!nuevos) {
      await cliente.query("ROLLBACK");
      return cita;
    }

    const siguiente = { ...cita, ...nuevos };
    await cliente.query(
      `UPDATE scheduled_jobs SET data = $2, "updatedAtMs" = $3 WHERE id = $1`,
      [id, JSON.stringify(siguiente), Date.now()]
    );
    await cliente.query("COMMIT");
    return siguiente;
  } catch (e) {
    try {
      await cliente.query("ROLLBACK");
    } catch {
      /* la conexión ya estaba perdida */
    }
    throw e;
  } finally {
    cliente.release();
  }
}

/**
 * Apunta que se ha pedido la confirmación.
 *
 * Escribe DOS cosas que parecen una: los campos nuevos de trazabilidad y el
 * viejo `whatsappReminder24hSentAtMs`. El viejo no es redundante, es el guardia
 * que impide que el bucle lo mande otra vez, y el que ya llevan las citas de
 * producción. Ver `debePedirConfirmacion`.
 */
export async function marcarConfirmacionEnviada(
  id: number,
  datos: { sid: string; telefono: string; contentSid: string; ahoraMs: number }
): Promise<CitaGuardada | null> {
  return cambiarCita(id, () => ({
    confirmationWhatsappSid: datos.sid,
    confirmationWhatsappSentAtMs: datos.ahoraMs,
    confirmationWhatsappStatus: "sent",
    confirmationWhatsappTo: datos.telefono,
    confirmationWhatsappContentSid: datos.contentSid,
    confirmationStatus: "awaiting_confirmation",
    // El guardia de siempre. Sin esto, el bucle vuelve a mandarlo al minuto.
    whatsappReminder24hSentAtMs: datos.ahoraMs,
  }));
}

/**
 * Reserva un intento ANTES de llamar a Twilio.
 *
 * ── Qué problema resuelve, y cuál no ────────────────────────────────────────
 *
 * El caso malo es: Twilio acepta el mensaje, el cliente lo recibe, y la
 * escritura posterior en la base falla. Si el contador se incrementara
 * después, ese fallo dejaría la cita como si nunca se hubiera intentado y el
 * bucle la mandaría otra vez al minuto. Y otra. Sin final.
 *
 * Reservando antes, un mensaje que salió cuenta aunque no lleguemos a
 * enterarnos. La garantía que se consigue es **como mucho tres mensajes**, no
 * «exactamente uno»: la API de mensajes de Twilio no admite clave de
 * idempotencia, así que un duplicado sigue siendo posible.
 *
 * Lo que se cambia es un fallo ilimitado por uno acotado, y eso sí se puede
 * explicar a un cliente que reciba dos.
 */
export async function reservarIntento(
  id: number,
  ahoraMs: number
): Promise<number> {
  let intentos = 0;
  await cambiarCita(id, (cita) => {
    const previos = Number(cita.confirmationWhatsappAttemptCount ?? 0);
    intentos = (Number.isFinite(previos) ? previos : 0) + 1;
    return {
      confirmationWhatsappAttemptCount: intentos,
      confirmationWhatsappLastAttemptAtMs: ahoraMs,
    };
  });
  return intentos;
}

/**
 * Devuelve un intento reservado que no llegó a gastarse.
 *
 * Se usa cuando no se manda por CONFIGURACIÓN —falta la plantilla, faltan
 * credenciales— y no por un fallo del envío. Sin esto, tres vueltas del bucle
 * sin la plantilla configurada dejarían la cita con los intentos agotados sin
 * haber mandado nunca nada, y ya no saldría cuando se configurase.
 */
export async function devolverIntento(id: number): Promise<void> {
  await cambiarCita(id, (cita) => {
    const previos = Number(cita.confirmationWhatsappAttemptCount ?? 0);
    if (!Number.isFinite(previos) || previos <= 0) return null;
    return { confirmationWhatsappAttemptCount: previos - 1 };
  });
}

/**
 * Apunta que el intento falló.
 *
 * Del error se guarda SOLO el mensaje y el código, recortados. Un error de
 * Twilio puede traer la petición entera, y ahí dentro va el número de
 * teléfono del cliente y, según el caso, cabeceras de autenticación.
 */
export async function marcarIntentoFallido(
  id: number,
  datos: { intentos: number; error: unknown; maximo: number }
): Promise<void> {
  const e = datos.error as any;
  const motivo = [e?.code ? `[${e.code}]` : "", String(e?.message ?? e ?? "")]
    .join(" ")
    .trim()
    .slice(0, 200);

  await cambiarCita(id, () => ({
    confirmationWhatsappLastError: motivo,
    ...(datos.intentos >= datos.maximo
      ? { confirmationWhatsappStatus: "failed", confirmationWhatsappFailedAtMs: Date.now() }
      : {}),
  }));
}

/** Deja constancia de que a esta cita no se le va a pedir confirmación. */
export async function marcarNoSolicitada(id: number): Promise<void> {
  await cambiarCita(id, (cita) =>
    cita.confirmationStatus ? null : { confirmationStatus: "not_requested" }
  );
}

/** Apunta el WhatsApp de «cita creada». Bloque aparte, sin mezclar. */
export async function marcarCreacionEnviada(
  id: number,
  datos: { sid: string; telefono: string; contentSid: string; ahoraMs: number }
): Promise<CitaGuardada | null> {
  return cambiarCita(id, () => ({
    creacionWhatsappSid: datos.sid,
    creacionWhatsappSentAtMs: datos.ahoraMs,
    creacionWhatsappStatus: "sent",
    creacionWhatsappTo: datos.telefono,
    creacionWhatsappContentSid: datos.contentSid,
  }));
}

/**
 * Mueve el estado del MENSAJE de confirmación según lo que diga Twilio.
 *
 * Devuelve la cita si la movió, `null` si el SID no es de ninguna cita o si el
 * estado no adelantaba.
 *
 * **No toca `confirmationStatus`.** Que el cliente haya leído el mensaje no
 * dice nada de si va a venir.
 */
export async function aplicarEstadoDeEnvio(
  messageSid: string,
  estado: EstadoEnvioWhatsapp,
  ahoraMs: number
): Promise<CitaGuardada | null> {
  /*
   * Se busca el SID en los DOS bloques, y el que encaje decide cuál se mueve.
   * Son dos mensajes distintos —el de creación y el de confirmación— y sus
   * estados no se mezclan nunca: el mismo callback podría ser de cualquiera
   * de los dos.
   */
  const fila = await db.query(
    `SELECT id,
            (data->>'confirmationWhatsappSid' = $1) AS es_confirmacion
       FROM scheduled_jobs
      WHERE data->>'confirmationWhatsappSid' = $1
         OR data->>'creacionWhatsappSid' = $1
      LIMIT 1`,
    [messageSid]
  );
  if (fila.rowCount === 0) return null;
  const id = Number(fila.rows[0].id);
  const esConfirmacion = fila.rows[0].es_confirmacion === true;

  const campoEstado = esConfirmacion
    ? "confirmationWhatsappStatus"
    : "creacionWhatsappStatus";

  return cambiarCita(id, (cita) => {
    if (!estadoEnvioAdelanta(cita[campoEstado], estado)) return null;

    // El bloque de creación solo lleva estado; las horas por estado son de la
    // confirmación, que es la que recepción necesita al detalle.
    const campoFecha = esConfirmacion ? campoDeFechaDeEstado(estado) : null;
    return {
      [campoEstado]: estado,
      ...(campoFecha ? { [campoFecha]: ahoraMs } : {}),
    };
  });
}

/**
 * Las citas que podrían ser la del mensaje que acaba de entrar.
 *
 * Se busca por teléfono normalizado y por el SID del mensaje al que responde:
 * las dos vías a la vez, porque la elección entre ellas la hace
 * `eligeCitaParaRespuesta` y aquí no se decide nada.
 *
 * El teléfono de la cita se teclea a mano y sale con guiones, espacios o sin
 * prefijo. Se compara por los últimos nueve dígitos, que es lo que hace ya el
 * cruce de recobros del webhook.
 */
export async function citasCandidatas(
  telefono: string,
  sidOriginal: string | null
): Promise<CitaCandidata[]> {
  const e164 = aE164(telefono);
  const digitos = e164.replace(/\D/g, "");
  const ultimos = digitos.slice(-9);
  if (ultimos.length < 9 && !sidOriginal) return [];

  const filas = await db.query(
    `SELECT data FROM scheduled_jobs
      WHERE COALESCE(data->>'status', '') NOT IN ('eliminado', 'cancelado')
        AND (
          ($1 <> '' AND regexp_replace(COALESCE(data->>'customerPhone', ''), '[^0-9]', '', 'g') LIKE '%' || $1)
          OR ($2 <> '' AND data->>'confirmationWhatsappSid' = $2)
        )
      ORDER BY id DESC
      LIMIT 50`,
    [ultimos.length === 9 ? ultimos : "", sidOriginal ?? ""]
  );

  return filas.rows.map((f: any) => {
    const d = typeof f.data === "string" ? JSON.parse(f.data) : f.data;
    return d as CitaCandidata;
  });
}
