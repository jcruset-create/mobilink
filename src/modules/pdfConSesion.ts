/**
 * Abrir un PDF del backend con la sesión del panel, sin meter la credencial
 * en la URL.
 *
 * ── Por qué hacía falta esto ────────────────────────────────────────────────
 *
 * Los PDF se abrían con `window.open(".../report.pdf?token=" + el token de
 * administrador)`. Una navegación del navegador no puede llevar cabeceras, así
 * que la única forma de identificarse era por la cadena de consulta.
 *
 * Eso dejó de funcionar cuando el panel pasó a la sesión unificada. El login
 * del hub NO deja el token clásico en `localStorage` —y es a propósito: ése era
 * el camino por el que la contraseña maestra acababa guardada en el navegador
 * de cada administrador, ver `adminHeaders.ts`—, así que el enlace salía con
 * «?token=» vacío y el servidor contestaba {"error":"No autorizado"}. Quien
 * entraba por el login clásico seguía viendo los informes y quien entraba por
 * el hub no, que es de las averías más difíciles de creerse cuando la cuentan.
 *
 * Y había un enlace, el de «Informe PDF» de la ficha, que ni siquiera mandaba
 * token: ése no funcionaba para nadie.
 *
 * ── Cómo se arregla ─────────────────────────────────────────────────────────
 *
 * Se pide el PDF con `fetch`, que SÍ lleva cabeceras, y lo que se abre es el
 * fichero ya descargado. La credencial deja de viajar en la URL, que además es
 * lo que este proyecto ya quería: el registro de peticiones del servidor se
 * cambió para no escribir la cadena de consulta precisamente porque los tokens
 * acababan en los logs de Render.
 */

/** Lo que hace falta de `fetch` aquí: se inyecta para poder probarlo. */
export type Peticion = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * El texto que se le enseña a quien pulsa, a partir de lo que conteste el
 * servidor.
 *
 * Se intenta el mensaje del propio servidor —«Asistencia no encontrada» dice
 * mucho más que «error 404»— y solo si no lo trae se cae a uno genérico con el
 * código, que al menos sirve para preguntar.
 */
export function mensajeDeError(estado: number, cuerpo: unknown): string {
  const delServidor =
    cuerpo && typeof cuerpo === "object" && typeof (cuerpo as any).error === "string"
      ? String((cuerpo as any).error).trim()
      : "";
  if (delServidor) return delServidor;
  if (estado === 401 || estado === 403) return "No tienes permiso para ver este informe.";
  return `No se pudo abrir el informe (error ${estado}).`;
}

/**
 * Descarga el PDF y lo devuelve. Lanza con un mensaje legible si no se puede.
 *
 * Separado de la parte que toca el navegador para poder probarlo: lo que se
 * rompió aquí fue cómo se identifica la petición, no cómo se abre una pestaña.
 */
export async function cuerpoDelPdf(peticion: Peticion, url: string): Promise<Blob> {
  const respuesta = await peticion(url, { method: "GET" });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => null);
    throw new Error(mensajeDeError(respuesta.status, cuerpo));
  }
  return await respuesta.blob();
}

/**
 * Abre el PDF en otra pestaña.
 *
 * La pestaña se abre ANTES de pedir el fichero, aunque quede en blanco un
 * momento: los navegadores bloquean `window.open` cuando ya no se está
 * atendiendo la pulsación, y descargar el PDF lleva su tiempo. Abriéndola
 * primero y llevándola después al fichero, el bloqueador no se mete.
 *
 * Si la pestaña viene bloqueada de todas formas, el PDF no se pierde: se baja
 * como descarga, que es peor que verlo pero mejor que no tenerlo.
 */
export async function abrirPdfConSesion(
  peticion: Peticion,
  url: string,
  nombreDeFichero: string
): Promise<void> {
  const pestana = window.open("", "_blank");
  let direccion = "";
  try {
    const pdf = await cuerpoDelPdf(peticion, url);
    direccion = URL.createObjectURL(pdf);
    if (pestana) {
      pestana.location.href = direccion;
    } else {
      const enlace = document.createElement("a");
      enlace.href = direccion;
      enlace.download = nombreDeFichero;
      enlace.click();
    }
  } catch (e) {
    // La pestaña en blanco se cierra: dejarla abierta y muda es peor que no
    // haberla abierto, porque parece que algo se está cargando.
    pestana?.close();
    throw e;
  } finally {
    /*
     * La URL del objeto se suelta tarde, no al salir de aquí: la pestaña
     * todavía la está cargando y revocarla de inmediato deja el visor en
     * blanco. Un minuto es de sobra para que el navegador tenga el fichero.
     */
    if (direccion) window.setTimeout(() => URL.revokeObjectURL(direccion), 60_000);
  }
}
