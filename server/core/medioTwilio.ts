/**
 * Bajar un adjunto de WhatsApp de Twilio y dejarlo en nuestro almacén.
 *
 * Vive aparte de `index.ts` porque lo usan dos sitios que no se parecen en
 * nada: el servidor —al recibir el mensaje y al cerrar la captura— y el script
 * que repara las fotos que ya quedaron apuntando a Twilio
 * (`scripts/reparar-fotos-twilio.ts`). Si cada uno llevara su copia, el día que
 * cambie la forma de autenticarse contra Twilio habría que acertar en los dos.
 */

import { fetchSeguro, HOSTS_TWILIO } from "./red.ts";
import { supabase, SUPABASE_ROADSIDE_BUCKET } from "../supabase.ts";

/**
 * Descarga un medio de WhatsApp con las credenciales de la cuenta de Twilio.
 *
 * La URL viene del cuerpo del webhook, así que la elige quien manda el
 * mensaje. Por eso pasa por `fetchSeguro` con la lista de hosts de Twilio: sin
 * eso, poner `MediaUrl0=https://atacante.tld/x` hacía que el servidor enviara
 * la cabecera `Authorization: Basic <SID>:<AUTH_TOKEN>` al atacante. Estaba
 * repetido en tres sitios; ahora la credencial se construye en uno.
 */
export async function descargarMedioTwilio(url: string) {
  return fetchSeguro(url, {
    hostsPermitidos: HOSTS_TWILIO,
    cabeceras: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString("base64"),
    },
    maxBytes: 25 * 1024 * 1024,
    timeoutMs: 20_000,
    /*
     * ── Las redirecciones son OBLIGATORIAS aquí, no un extra ────────────
     *
     * Twilio no sirve el adjunto desde «api.twilio.com»: contesta con un 307
     * hacia su CDN («media.twiliocdn.com»), y es de ahí de donde baja el
     * fichero. Por eso `HOSTS_TWILIO` lleva los dos nombres.
     *
     * `fetchSeguro` deja las redirecciones a CERO por defecto —la opción
     * segura para una URL que elige un desconocido— y aquí se quedó en cero
     * sin querer. Resultado: cada descarga revienta en la primera
     * redirección con «demasiadas_redirecciones», el fallo se traga para no
     * perder el mensaje, y NINGÚN adjunto de WhatsApp tuvo copia desde el
     * endurecimiento de la Fase 0. Se vio como «fotos que no se ven», y costó
     * tres arreglos equivocados antes de llegar aquí.
     *
     * Cada salto vuelve a pasar por la lista blanca, así que la credencial
     * solo puede ir a un host de Twilio: seguir la redirección no abre lo que
     * el endurecimiento cerró.
     */
    maxRedirecciones: 2,
  });
}

/**
 * Baja un adjunto de Twilio y lo deja en nuestro almacén.
 *
 * Es el mismo trabajo que hace el webhook al recibir el mensaje; existe aparte
 * porque allí se traga el fallo para no perder el mensaje, y entonces hace
 * falta poder reintentarlo después. Devuelve la URL de la copia, o `null` si
 * tampoco esta vez se ha podido.
 */
export async function rescatarMedioDeTwilio(jobId: number, urlTwilio: string): Promise<string | null> {
  try {
    const medio = await descargarMedioTwilio(urlTwilio);
    if (!medio.ok) {
      console.warn(`[captura] Twilio contesta ${medio.status} al rescatar el adjunto`);
      return null;
    }
    const contentType = medio.contentType || "application/octet-stream";
    const ext = contentType.split("/")[1]?.split(";")[0] ?? "bin";
    const ruta = `roadside/${jobId}/whatsapp_rescate_${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(SUPABASE_ROADSIDE_BUCKET)
      .upload(ruta, medio.cuerpo, { contentType, upsert: false });
    if (error) {
      console.warn(`[captura] no se ha podido guardar el adjunto rescatado: ${error.message}`);
      return null;
    }
    const { data } = supabase.storage.from(SUPABASE_ROADSIDE_BUCKET).getPublicUrl(ruta);
    return data.publicUrl ?? null;
  } catch (e: any) {
    console.warn(`[captura] rescate del adjunto fallido: ${e?.message ?? e}`);
    return null;
  }
}
