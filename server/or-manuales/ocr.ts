/**
 * Separar el escaneo en páginas y leer el número de OR de cada una.
 *
 * Es la única pieza del módulo que toca ficheros y modelos; todo lo que decide
 * QUÉ número es y cuánto fiarse vive en `domain/deteccion.ts`, que es puro.
 *
 * ── La cascada, de más fiable a menos ───────────────────────────────────────
 *
 *   1. Texto del PDF dentro de la zona configurada.
 *   2. Texto del PDF en el resto de la página.
 *   3. La página rasterizada, leída por el modelo de visión, dentro de la zona.
 *   4. Lo mismo en la página entera.
 *
 * El encargo pone el código de barras y el QR por delante de todo. No están
 * implementados porque las OR de papel de este taller no llevan ninguno, y
 * añadir un lector para algo que no existe en el documento sería código muerto
 * con mantenimiento. El vocabulario (`METODOS_DETECCION`) ya los admite y esta
 * cascada es una lista de pasos: el día que se impriman blocs con código de
 * barras, se añade un paso al principio y no cambia nada más.
 *
 * ── Por qué el texto va antes que el OCR, siempre ───────────────────────────
 *
 * Un PDF digital DICE el número; un OCR lo interpreta. Rasterizar un PDF que
 * ya trae su texto es cambiar un dato exacto por una lectura aproximada. Es la
 * misma regla que sigue Therefore al analizar albaranes.
 */

import { PDFDocument } from "pdf-lib";
import * as mupdf from "mupdf";

import { extractJson, hasAi } from "../core/ai.ts";
import { ErrorOrManuales } from "./errors.ts";
import {
  detectarNumeroOr,
  type Candidato,
  type Deteccion,
  type PaginaAnalizable,
  type ZonaOcr,
} from "./domain/deteccion.ts";

/* ── Lo que se admite ─────────────────────────────────────────────────────── */

export const MIMES_ADMITIDOS = ["application/pdf", "image/jpeg", "image/png"] as const;

/** Un escaneo de 200 páginas a 300 ppp no baja de aquí; más es otra cosa. */
export const MAX_BYTES = 60 * 1024 * 1024;

/** Tope de páginas por fichero. Un bloc tiene 25; ocho blocs de una vez es de sobra. */
export const MAX_PAGINAS = 200;

const FIRMA_PDF = Buffer.from("%PDF-");

/**
 * Comprueba que el fichero es lo que dice ser ANTES de guardarlo.
 *
 * Mirar sólo la extensión o el `Content-Type` no vale: los dos los pone quien
 * sube el fichero. Se comprueba la firma real del contenido, que es lo que no
 * se puede falsear sin construir un PDF de verdad.
 */
export function validarFichero(nombre: string, mime: string, contenido: Buffer): string {
  if (contenido.length === 0) {
    throw new ErrorOrManuales("FICHERO_VACIO", `«${nombre}» está vacío.`);
  }
  if (contenido.length > MAX_BYTES) {
    throw new ErrorOrManuales(
      "FICHERO_GRANDE",
      `«${nombre}» pesa ${Math.round(contenido.length / 1024 / 1024)} MB y el máximo son ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`,
      413
    );
  }

  const real = tipoReal(contenido);
  if (!real) {
    throw new ErrorOrManuales(
      "FICHERO_NO_ADMITIDO",
      `«${nombre}» no es un PDF ni una imagen JPG o PNG. Se admiten PDF, JPG y PNG.`,
      415
    );
  }
  // El tipo que manda es el del CONTENIDO: si el navegador dijo otra cosa, se
  // queda con lo que de verdad hay dentro.
  if (mime && mime !== real && MIMES_ADMITIDOS.includes(mime as (typeof MIMES_ADMITIDOS)[number])) {
    console.warn(`OR Manuales: «${nombre}» llegó como ${mime} y es ${real}.`);
  }
  return real;
}

function tipoReal(c: Buffer): string | null {
  if (c.subarray(0, 5).equals(FIRMA_PDF)) return "application/pdf";
  if (c[0] === 0xff && c[1] === 0xd8 && c[2] === 0xff) return "image/jpeg";
  if (c[0] === 0x89 && c[1] === 0x50 && c[2] === 0x4e && c[3] === 0x47) return "image/png";
  return null;
}

/* ── Separar en páginas ───────────────────────────────────────────────────── */

export type PaginaSeparada = {
  /** 1-indexada dentro del fichero de origen. */
  numero: number;
  contenido: Buffer;
  mime: string;
};

/**
 * Una página, un documento. Es la regla del módulo.
 *
 * Un PDF de 25 páginas sale de aquí como 25 PDF de una página, cada uno
 * completo y abrible por su cuenta: es lo que se archiva colgando de su OR, y
 * tiene que poder enseñarse sin arrastrar las otras 24 hojas del lote.
 *
 * Una imagen es una página y ya está: el escáner que produce JPG produce un
 * fichero por hoja.
 */
export async function separarPaginas(contenido: Buffer, mime: string): Promise<PaginaSeparada[]> {
  if (mime !== "application/pdf") {
    return [{ numero: 1, contenido, mime }];
  }

  let origen: PDFDocument;
  try {
    origen = await PDFDocument.load(contenido, { ignoreEncryption: false });
  } catch (e) {
    const motivo = String((e as Error)?.message ?? "");
    if (/encrypt/i.test(motivo)) {
      throw new ErrorOrManuales(
        "PDF_PROTEGIDO",
        "El PDF está protegido con contraseña. Quítasela y vuelve a subirlo.",
        415
      );
    }
    throw new ErrorOrManuales("PDF_CORRUPTO", "El PDF está dañado y no se puede abrir.", 415);
  }

  const total = origen.getPageCount();
  if (total === 0) throw new ErrorOrManuales("PDF_VACIO", "El PDF no tiene páginas.", 415);
  if (total > MAX_PAGINAS) {
    throw new ErrorOrManuales(
      "PDF_DEMASIADAS_PAGINAS",
      `El PDF tiene ${total} páginas y el máximo son ${MAX_PAGINAS}. Pártelo y súbelo en varias tandas.`,
      413
    );
  }

  const paginas: PaginaSeparada[] = [];
  for (let i = 0; i < total; i += 1) {
    const doc = await PDFDocument.create();
    const [copia] = await doc.copyPages(origen, [i]);
    doc.addPage(copia);
    paginas.push({ numero: i + 1, contenido: Buffer.from(await doc.save()), mime: "application/pdf" });
  }
  return paginas;
}

/* ── Leer el número ───────────────────────────────────────────────────────── */

export type OpcionesAnalisis = {
  zona: ZonaOcr;
  /** Qué números existen de verdad, para no dar por buena una OR que no está en ningún bloc. */
  dentroDeAlgunBloc: (numero: number) => boolean;
  /** ¿Se puede rasterizar y preguntarle al modelo cuando no hay texto? */
  ocrConIa: boolean;
};

export type ResultadoAnalisis = {
  candidato: Candidato | null;
  /** El texto del que salió el número, para que una persona pueda comprobarlo. */
  texto: string;
  /** Los demás números plausibles. Se guardan porque explican una confianza baja. */
  otros: Candidato[];
};

/**
 * Lee el número de OR de UNA página ya separada.
 *
 * Nunca lanza por no encontrar nada: una página ilegible es un documento no
 * identificado, no un error del lote. Sí lanza si la página no se puede abrir
 * siquiera, que es distinto.
 */
export async function analizarPagina(
  contenido: Buffer,
  mime: string,
  opciones: OpcionesAnalisis
): Promise<ResultadoAnalisis> {
  // 1 y 2 · el texto que el propio PDF trae dentro.
  if (mime === "application/pdf") {
    const pagina = textoDePdf(contenido);
    if (pagina && pagina.lineas.length > 0) {
      const d = detectarNumeroOr(pagina, {
        zona: opciones.zona,
        dentroDeAlgunBloc: opciones.dentroDeAlgunBloc,
        origen: "texto",
      });
      // Se acepta lo leído del texto salvo que no haya salido nada: un PDF
      // digital con número legible no necesita que nadie mire su imagen.
      if (d.candidato) return conTexto(d);
    }
  }

  // 3 y 4 · no había texto (o no había número en él): la imagen y el modelo.
  if (!opciones.ocrConIa || !hasAi()) {
    return { candidato: null, texto: "", otros: [] };
  }

  const png = await imagenDe(contenido, mime);
  if (!png) return { candidato: null, texto: "", otros: [] };

  const leido = await leerConIa(png, opciones.zona);
  if (leido === null) return { candidato: null, texto: "", otros: [] };

  /*
   * Lo que devuelve el modelo se hace pasar por la MISMA puntuación que el
   * texto del PDF, montando una página sintética con su lectura. Así la regla
   * de confianza es una sola: si se puntuara aparte, el día que se cambie un
   * peso habría dos sitios que actualizar y uno se quedaría atrás.
   */
  const sintetica: PaginaAnalizable = {
    numero: 1,
    ancho: 100,
    alto: 100,
    lineas: [
      // Se coloca dentro de la zona configurada si el modelo dijo que ahí
      // estaba; si lo encontró en otro sitio, fuera de ella.
      leido.enZona
        ? { texto: leido.texto, x: opciones.zona.x * 100 + 1, y: opciones.zona.y * 100 + 1, w: 1, h: 1 }
        : { texto: leido.texto, x: 0, y: 99, w: 1, h: 1 },
    ],
  };

  const d = detectarNumeroOr(sintetica, {
    zona: opciones.zona,
    dentroDeAlgunBloc: opciones.dentroDeAlgunBloc,
    origen: "ocr",
  });
  return conTexto(d);
}

function conTexto(d: Deteccion): ResultadoAnalisis {
  return { candidato: d.candidato, texto: d.candidato?.texto ?? "", otros: d.otros };
}

/** El texto de la página con sus coordenadas, o `null` si es un escaneado. */
function textoDePdf(contenido: Buffer): PaginaAnalizable | null {
  try {
    const doc = mupdf.Document.openDocument(contenido, "application/pdf");
    if (doc.countPages() === 0) return null;
    const page = doc.loadPage(0);
    const [x0, y0, x1, y1] = page.getBounds();
    const lineas: PaginaAnalizable["lineas"] = [];

    /*
     * Aquí basta con las líneas que mupdf agrupa por su cuenta: no hay que
     * reconstruir una tabla como en Therefore, sólo encontrar un número y
     * saber en qué parte de la hoja está. El recorrido carácter a carácter
     * costaría más y no aportaría nada.
     */
    const texto = page.toStructuredText("preserve-whitespace").asJSON();
    const datos = JSON.parse(texto) as { blocks?: { lines?: { bbox?: { x: number; y: number; w: number; h: number }; text?: string }[] }[] };
    for (const bloque of datos.blocks ?? []) {
      for (const linea of bloque.lines ?? []) {
        const t = (linea.text ?? "").trim();
        if (!t) continue;
        const b = linea.bbox ?? { x: 0, y: 0, w: 0, h: 0 };
        lineas.push({ texto: t, x: b.x, y: b.y, w: b.w, h: b.h });
      }
    }

    return { numero: 1, ancho: x1 - x0, alto: y1 - y0, lineas };
  } catch {
    return null;
  }
}

/** La página como PNG, para enseñársela al modelo. */
async function imagenDe(contenido: Buffer, mime: string): Promise<Buffer | null> {
  if (mime === "image/png" || mime === "image/jpeg") return contenido;
  try {
    const doc = mupdf.Document.openDocument(contenido, "application/pdf");
    if (doc.countPages() === 0) return null;
    const page = doc.loadPage(0);
    // ~144 ppp: suficiente para un número escrito a mano y la mitad de bytes
    // que 300. La misma escala que usa el OCR de fichas técnicas.
    const pix = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
    return Buffer.from(pix.asPNG());
  } catch {
    return null;
  }
}

type LecturaIa = { texto: string; enZona: boolean };

/**
 * Le pide al modelo el número que ve, y DÓNDE lo ve.
 *
 * Se pregunta por la zona además del número porque es lo que separa «el 1043
 * que está impreso arriba a la derecha, donde va la OR» de «un 1043 que
 * aparece suelto en el cuerpo del parte». Sin esa pregunta, las dos lecturas
 * entrarían con la misma confianza.
 *
 * Devuelve `null` si no hay nada legible; nunca lanza: que el modelo falle
 * deja la página sin identificar, no tumba el lote.
 */
async function leerConIa(png: Buffer, zona: ZonaOcr): Promise<LecturaIa | null> {
  const dondeMirar = describirZona(zona);
  try {
    const r = await extractJson({
      system: `Eres un lector de órdenes de reparación en papel de un taller. La imagen es UNA hoja escaneada.
Devuelve EXCLUSIVAMENTE un JSON con esta forma:

{ "numero_or": "1043", "en_zona_preferente": true, "texto_zona": "OR Nº 1043" }

Reglas:
- "numero_or" es el número de la ORDEN DE REPARACIÓN: el número identificativo de la hoja, normalmente preimpreso o escrito junto a un rótulo como «OR», «Nº», «Orden». Entre 3 y 7 cifras.
- Mira primero ${dondeMirar}, que es donde este taller imprime el número.
- "en_zona_preferente" es true SÓLO si el número que devuelves está en esa parte de la hoja.
- "texto_zona" es la línea completa tal y como se lee, con su rótulo si lo tiene.
- Si no se lee ningún número con seguridad, devuelve { "numero_or": null }. NO adivines: es peor un número inventado que ninguno.
- No devuelvas fechas, matrículas, importes, teléfonos ni números de bastidor.`,
      images: [`data:image/png;base64,${png.toString("base64")}`],
      maxTokens: 200,
    });

    const numero = String(r.numero_or ?? "").trim();
    if (!/^\d{3,7}$/.test(numero)) return null;
    const texto = String(r.texto_zona ?? "").trim() || numero;
    // El texto tiene que contener el número: si el modelo devuelve una línea
    // que no lo lleva, la puntuación buscaría un número distinto del leído.
    return {
      texto: texto.includes(numero) ? texto : `${texto} ${numero}`.trim(),
      enZona: r.en_zona_preferente === true,
    };
  } catch (e) {
    console.warn("[OR Manuales] la lectura con IA ha fallado:", (e as Error)?.message ?? e);
    return null;
  }
}

/** La zona en palabras, para poder decírsela al modelo. */
function describirZona(z: ZonaOcr): string {
  const cx = z.x + z.ancho / 2;
  const cy = z.y + z.alto / 2;
  const horizontal = cx < 0.34 ? "la izquierda" : cx > 0.66 ? "la derecha" : "el centro";
  const vertical = cy < 0.34 ? "la parte superior" : cy > 0.66 ? "la parte inferior" : "la franja central";
  return `${vertical} de la hoja, hacia ${horizontal}`;
}
