/**
 * Enlaces a las fotos que funcionan aunque el bucket no sea público.
 *
 * ── Qué se rompió ───────────────────────────────────────────────────────────
 *
 * Las fotos de las asistencias se guardan en Supabase y en la base queda su URL
 * PÚBLICA, tal cual la devolvió `getPublicUrl` el día de subirlas. Esa URL solo
 * sirve mientras el bucket siga marcado como público, y eso es una casilla del
 * panel de Supabase: no la crea ninguna migración de este repositorio, así que
 * puede cambiar sin que ningún commit lo toque. El día que cambie, dejan de
 * verse TODAS las fotos a la vez —en el panel y en la APK— y no hay nada en el
 * código que explique por qué.
 *
 * ── Cómo se arregla ─────────────────────────────────────────────────────────
 *
 * En vez de servir la URL guardada, se firma una nueva en el momento de pedirla.
 * Un enlace firmado lo emite el servidor con su clave de servicio y vale tanto
 * si el bucket es público como si no, así que deja de depender de una casilla.
 *
 * Es lo que ya hace Mobilink Cash (`server/cash/storage.ts`), y por lo mismo.
 *
 * ── Por qué así y no con una ruta propia que sirva el fichero ───────────────
 *
 * Porque una etiqueta `<img>` no puede mandar cabeceras: una ruta nuestra
 * protegida no se podría pintar, y sin proteger sería el mismo agujero que el
 * bucket público. Y sobre todo porque la APK pinta las fotos con la URL que le
 * da el servidor: firmando aquí, las fotos vuelven en los móviles que ya están
 * instalados, sin publicar una APK nueva.
 *
 * De regalo, el enlace caduca. Hasta ahora, las fotos de una asistencia
 * —matrículas, documentación, daños— las veía cualquiera que tuviera el enlace,
 * para siempre y sin contraseña.
 */

import { supabase, SUPABASE_ROADSIDE_BUCKET } from "../supabase.ts";

/**
 * Cuánto vale un enlace.
 *
 * Seis horas: de sobra para un turno, para abrir el informe y para que una
 * pestaña abierta un rato siga funcionando, y poco para que un enlace copiado
 * por ahí sirva mañana.
 */
export const CADUCIDAD_FOTO_S = 6 * 60 * 60;

/**
 * La ruta del objeto dentro del bucket, a partir de una URL pública guardada.
 *
 * Las URL de Supabase son de la forma
 * `https://<proyecto>.supabase.co/storage/v1/object/public/<bucket>/<ruta>`.
 * Devuelve `null` si la URL no es de este bucket —una de Twilio, una local, o
 * una de otro sitio—, que es la señal de «esto no lo firmo, déjalo como está».
 *
 * Pura a propósito: es la parte que se puede equivocar y la que se prueba.
 */
export function rutaEnBucket(url: unknown, bucket = SUPABASE_ROADSIDE_BUCKET): string | null {
  const texto = String(url ?? "").trim();
  if (!texto) return null;

  const marca = `/storage/v1/object/public/${bucket}/`;
  const i = texto.indexOf(marca);
  if (i < 0) return null;

  // Sin la cadena de consulta: un `?t=` de caché no forma parte de la ruta.
  const ruta = texto.slice(i + marca.length).split("?")[0].split("#")[0];
  if (!ruta) return null;

  try {
    return decodeURIComponent(ruta);
  } catch {
    return ruta;
  }
}

/**
 * Firma varias URL de golpe y devuelve un diccionario «la guardada → la
 * firmada».
 *
 * Lo que NO se puede firmar se devuelve tal cual, y eso incluye el caso en que
 * Supabase conteste mal: una foto con su enlace de siempre es lo que había
 * ayer, y romper el listado entero por no poder firmar sería peor que el
 * problema que esto viene a arreglar.
 */
/**
 * El último motivo por el que no se pudo firmar, para poder CONTARLO.
 *
 * Cuando las fotos no se ven, el motivo iba solo al log del servidor, y un log
 * que no se puede mirar no sirve de nada a quien tiene la pantalla delante:
 * ve huecos y no sabe si falta la foto, falta el permiso o se cayó algo. Esto
 * permite que el motivo llegue a donde está el problema.
 *
 * Es el último y no uno por fichero a propósito: cuando esto falla, falla para
 * todas a la vez —son credenciales o es el bucket—, y guardar N copias del
 * mismo mensaje no añade nada.
 */
let ultimoFalloAlFirmar: string | null = null;

/** El motivo del último fallo al firmar, o `null` si la última vez fue bien. */
export function fallaAlFirmar(): string | null {
  return ultimoFalloAlFirmar;
}

export async function firmarUrls(
  urls: Array<string | null | undefined>,
  caducidadS = CADUCIDAD_FOTO_S
): Promise<Record<string, string>> {
  const porRuta = new Map<string, string[]>();
  for (const url of urls) {
    const ruta = rutaEnBucket(url);
    if (!ruta) continue;
    const lista = porRuta.get(ruta) ?? [];
    lista.push(String(url));
    porRuta.set(ruta, lista);
  }
  if (porRuta.size === 0) return {};

  const rutas = [...porRuta.keys()];
  const firmadas: Record<string, string> = {};

  try {
    const { data, error } = await supabase.storage
      .from(SUPABASE_ROADSIDE_BUCKET)
      .createSignedUrls(rutas, caducidadS);
    if (error) throw error;

    for (const fila of data ?? []) {
      // `path` vuelve tal y como se pidió; si viene vacío no hay a qué atarlo.
      const originales = fila.path ? porRuta.get(fila.path) : undefined;
      if (!originales) continue;
      if (!fila.signedUrl) {
        /*
         * Supabase firma de golpe y contesta fichero a fichero: uno que no
         * exista no tumba a los demás, pero sí trae su propio error. Es el caso
         * de una foto cuya subida falló el día que se recibió: la fila existe
         * en la base y el objeto no está en el bucket.
         */
        ultimoFalloAlFirmar = String((fila as any).error ?? "el fichero no está en el almacén");
        continue;
      }
      for (const original of originales) firmadas[original] = fila.signedUrl;
    }
    if (Object.keys(firmadas).length > 0) ultimoFalloAlFirmar = null;
  } catch (e: any) {
    ultimoFalloAlFirmar = String(e?.message ?? e);
    /*
     * Queda en el log con el número de fotos afectadas: si esto empieza a
     * aparecer, es que las credenciales de Supabase ya no valen, y ése es un
     * problema distinto del que las fotos no se vean.
     */
    console.error(
      `[fotos] no se han podido firmar ${rutas.length} enlace(s): ${e?.message ?? e}`
    );
  }

  return firmadas;
}

/**
 * Cambia la URL guardada por una firmada en cada fila, sobre el campo que se
 * diga. Las filas se modifican en su sitio y se devuelven.
 */
export async function firmarEnFilas<T extends Record<string, any>>(
  filas: T[],
  campos: string[] = ["url"]
): Promise<T[]> {
  const urls: string[] = [];
  for (const fila of filas) {
    for (const campo of campos) {
      if (typeof fila?.[campo] === "string") urls.push(fila[campo]);
    }
  }

  const firmadas = await firmarUrls(urls);
  if (Object.keys(firmadas).length === 0) return filas;

  for (const fila of filas) {
    for (const campo of campos) {
      const actual = fila?.[campo];
      if (typeof actual === "string" && firmadas[actual]) {
        (fila as Record<string, any>)[campo] = firmadas[actual];
      }
    }
  }
  return filas;
}
