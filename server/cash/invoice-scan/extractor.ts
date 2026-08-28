/**
 * De dónde sale la lectura del papel.
 *
 * `ExtractorFacturas` es un PUERTO: un contrato de una sola función. El resto
 * del módulo solo conoce esto, así que el día que se cambie de proveedor —o se
 * quiera probar sin llamar a nadie— se cambia la implementación y nada más se
 * entera.
 *
 * La implementación de hoy no habla con ningún SDK: pasa por
 * `server/core/openaiService.ts`, que es la capa única de IA de la plataforma.
 * La regla de ese módulo es explícita —«ni controladores, ni workers, ni
 * scripts crean su propio cliente ni eligen modelo»— y aquí se respeta: el
 * modelo se elige por variable de entorno, no por código.
 */

import { pedirIA, hayIA } from "../../core/openaiService.ts";
import { ErrorCaja } from "../errors.ts";
import { ESQUEMA_FACTURA, INSTRUCCIONES } from "./schema.ts";
import type { ExtraccionCruda } from "./types.ts";

/** El documento tal y como llegó, sin tocar. */
export type DocumentoAdjunto = {
  nombre: string;
  mime: string;
  contenido: Buffer;
};

/**
 * Lee un documento y devuelve lo que pone, sin decidir nada.
 *
 * Una sola función a propósito: cuanto más pequeño es el puerto, más fácil es
 * tener otra implementación honesta detrás.
 */
export type ExtractorFacturas = (documento: DocumentoAdjunto) => Promise<ExtraccionCruda>;

/** Cuánto se espera antes de rendirse. Un escaneo de mostrador no puede colgar. */
const TIMEOUT_MS = 90_000;

/**
 * El extractor de verdad.
 *
 * El documento va por data-URI: ni se sube a ningún sitio ni se deja una URL
 * pública por ahí para que el modelo la descargue. Una factura lleva nombre,
 * NIF y matrícula de una persona.
 */
export const extractorIA: ExtractorFacturas = async (documento) => {
  if (!hayIA()) {
    throw new ErrorCaja(
      "ESCANEO_NO_DISPONIBLE",
      "El escaneo de facturas no está configurado en este servidor. Rellena el cobro a mano.",
      503
    );
  }

  const dataUri = `data:${documento.mime};base64,${documento.contenido.toString("base64")}`;
  const esImagen = documento.mime.startsWith("image/");

  const r = await pedirIA<ExtraccionCruda>({
    operacion: "cash.escanearFactura",
    proposito: "documento",
    prompt: INSTRUCCIONES,
    // Una imagen entra como imagen y un PDF como fichero: la Responses API
    // trata cada uno como toca, y un PDF metido por `input_image` no se lee.
    imagenes: esImagen ? [{ url: dataUri }] : undefined,
    archivos: esImagen ? undefined : [{ nombre: documento.nombre, dataUri }],
    esquema: { nombre: "factura_escaneada", schema: ESQUEMA_FACTURA as Record<string, unknown> },
    maxTokens: 4000,
    timeoutMs: TIMEOUT_MS,
  });

  if (!r.ok || !r.datos) {
    /*
     * El proveedor falla o devuelve algo que no encaja en el esquema. No se
     * inventa una extracción vacía: quien llama tiene que poder decirle al
     * operario que el escaneo no ha salido y que rellene a mano, sin perder
     * nada de lo que ya hubiera escrito.
     */
    throw new ErrorCaja(
      "ESCANEO_FALLIDO",
      "No se ha podido leer el documento. Vuelve a intentarlo o rellena el cobro a mano.",
      502,
      { causa: r.error?.slice(0, 200) }
    );
  }

  return r.datos;
};
