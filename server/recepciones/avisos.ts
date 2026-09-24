/**
 * Mandar el WhatsApp a quien espera la mercancía.
 *
 * La regla —si toca avisar y qué se dice— vive en `domain/aviso.ts` y es pura.
 * Aquí está lo que toca el mundo: Twilio y la fila que deja constancia.
 *
 * ── No estrena cliente ──────────────────────────────────────────────────────
 *
 * Usa `server/core/twilio.ts`, que ya tiene el cliente perezoso, el número
 * emisor y el paso a E.164 asumiendo España. Es el mismo por el que salen los
 * avisos de asistencia en carretera.
 *
 * ── La plantilla ────────────────────────────────────────────────────────────
 *
 * WhatsApp no deja escribir libremente a alguien que no te ha escrito en las
 * últimas 24 horas: hay que usar una plantilla aprobada, que en Twilio es un
 * Content SID. El nuestro va en `RECEPCIONES_WHATSAPP_CONTENT_SID`, y el texto
 * que hay que dar de alta es el de `textoAviso`, con {{1}} el saludo y {{2}}
 * el centro.
 *
 * Sin ese SID se manda el texto plano. Funciona dentro de esas 24 horas y en
 * el sandbox, y fuera lo rechaza Twilio: el error se guarda tal cual, que es
 * mejor que fingir que salió.
 *
 * ── Nunca rompe el cierre ───────────────────────────────────────────────────
 *
 * La recepción ya está cerrada y firmada cuando esto corre. Que WhatsApp falle
 * no puede deshacerla ni dar error en la pantalla del muelle: se guarda el
 * fallo y se sigue. Por eso esto no lanza NUNCA.
 */

import { aWhatsApp, clienteTwilio, enmascararTelefono, hayCredencialesTwilio, numeroWhatsAppEmisor } from "../core/twilio.ts";
import {
  motivoParaNoAvisar,
  motivoParaNoAvisarFalta,
  textoAviso,
  textoFaltaAlbaran,
  variablesFaltaAlbaran,
  variablesPlantilla,
  type DatosAviso,
  type DatosFaltaAlbaran,
} from "./domain/aviso.ts";
import * as repo from "./repository.ts";

export type ResultadoAviso = { estado: "ENVIADO" | "OMITIDO" | "ERROR"; motivo: string | null; referencia: string | null };

/** El Content SID de la plantilla aprobada, si está configurada. */
export function contentSidAviso(): string {
  return String(process.env.RECEPCIONES_WHATSAPP_CONTENT_SID || "").trim();
}

/** El de la plantilla del aviso a recepción cuando falta el PDF del albarán. */
export function contentSidFaltaAlbaran(): string {
  return String(process.env.RECEPCIONES_WHATSAPP_SID_FALTA_ALBARAN || "").trim();
}

/**
 * Manda el aviso y deja la fila. Nunca lanza: devuelve qué pasó.
 *
 * `quien` es la persona que cerró la recepción; queda en el aviso para saber a
 * cuenta de quién salió el mensaje.
 */
export async function avisarRecepcion(
  ctx: { empresaId: string; userId: string | null; userNombre: string },
  destino: { recepcionId: string; albaranId: string },
  datos: DatosAviso,
  activado: boolean
): Promise<ResultadoAviso> {
  const anotar = async (r: ResultadoAviso): Promise<ResultadoAviso> => {
    try {
      await repo.anotarAviso(ctx.empresaId, {
        recepcionId: destino.recepcionId,
        albaranId: destino.albaranId,
        destinatario: datos.destinatario,
        telefono: datos.telefono,
        estado: r.estado,
        motivo: r.motivo,
        referenciaExterna: r.referencia,
        creadoPor: ctx.userId,
        creadoNombre: ctx.userNombre,
      });
    } catch (e) {
      // Ni siquiera dejar constancia puede tumbar la recepción.
      console.error("[Recepciones] no se ha podido anotar el aviso:", (e as Error).message);
    }
    return r;
  };

  const motivo = motivoParaNoAvisar(datos, { activado, hayCredenciales: hayCredencialesTwilio() });
  if (motivo) return anotar({ estado: "OMITIDO", motivo, referencia: null });

  const contentSid = contentSidAviso();
  try {
    const mensaje = await clienteTwilio().messages.create({
      from: numeroWhatsAppEmisor(),
      to: aWhatsApp(datos.telefono!),
      ...(contentSid
        ? { contentSid, contentVariables: JSON.stringify(variablesPlantilla(datos)) }
        : { body: textoAviso(datos) }),
    });
    console.log(`[Recepciones] aviso a ${enmascararTelefono(datos.telefono)} (${mensaje.sid})`);
    return anotar({ estado: "ENVIADO", motivo: contentSid ? null : "Sin plantilla aprobada: se ha mandado texto plano.", referencia: mensaje.sid ?? null });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[Recepciones] el aviso a ${enmascararTelefono(datos.telefono)} ha fallado:`, error);
    return anotar({ estado: "ERROR", motivo: error, referencia: null });
  }
}

/**
 * Avisa a recepción de que un albarán ha entrado SIN su PDF.
 *
 * El papel es lo que dice qué viene y para quién, y lo que se sella al
 * recibir: sin él, el albarán se queda a medias y alguien tiene que subirlo a
 * mano. Antes eso sólo se veía si a alguien se le ocurría mirar la bandeja de
 * correos; ahora se dice.
 *
 * Como el otro, nunca lanza y deja fila en `rcp_avisos`, con su tipo, para que
 * se pueda mirar qué se avisó y qué no.
 */
export async function avisarFaltaAlbaran(
  ctx: { empresaId: string; userId: string | null; userNombre: string },
  albaranId: string,
  telefono: string | null,
  datos: DatosFaltaAlbaran
): Promise<ResultadoAviso> {
  const anotar = async (r: ResultadoAviso): Promise<ResultadoAviso> => {
    try {
      await repo.anotarAviso(ctx.empresaId, {
        tipo: "FALTA_ALBARAN",
        recepcionId: null,
        albaranId,
        destinatario: "Recepción",
        telefono,
        estado: r.estado,
        motivo: r.motivo,
        referenciaExterna: r.referencia,
        creadoPor: ctx.userId,
        creadoNombre: ctx.userNombre,
      });
    } catch (e) {
      console.error("[Recepciones] no se ha podido anotar el aviso de falta de albarán:", (e as Error).message);
    }
    return r;
  };

  const motivo = motivoParaNoAvisarFalta(telefono, hayCredencialesTwilio());
  if (motivo) return anotar({ estado: "OMITIDO", motivo, referencia: null });

  const contentSid = contentSidFaltaAlbaran();
  try {
    const mensaje = await clienteTwilio().messages.create({
      from: numeroWhatsAppEmisor(),
      to: aWhatsApp(telefono!),
      ...(contentSid
        ? { contentSid, contentVariables: JSON.stringify(variablesFaltaAlbaran(datos)) }
        : { body: textoFaltaAlbaran(datos) }),
    });
    console.log(`[Recepciones] aviso de falta de albarán a ${enmascararTelefono(telefono)} (${mensaje.sid})`);
    return anotar({ estado: "ENVIADO", motivo: contentSid ? null : "Sin plantilla aprobada: se ha mandado texto plano.", referencia: mensaje.sid ?? null });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[Recepciones] el aviso de falta de albarán a ${enmascararTelefono(telefono)} ha fallado:`, error);
    return anotar({ estado: "ERROR", motivo: error, referencia: null });
  }
}
