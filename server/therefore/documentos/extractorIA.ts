/**
 * La IA como respaldo, nunca como primera opción.
 *
 * Entra sólo cuando el camino determinista se queda corto: un escaneado sin
 * capa de texto, o una sección que tiene texto y de la que no ha salido ni una
 * línea. Y entra sobre la sección YA DELIMITADA, no sobre el documento entero.
 *
 * ── Lo que NO se le pregunta ────────────────────────────────────────────────
 *
 * Cuál es el albarán. Localizarlo es determinista o es revisión (H.1–H.2). Si
 * se le preguntara, un modelo siempre respondería algo, y «algo» aquí significa
 * coger las líneas de otro albarán con toda la confianza del mundo. Lo que se
 * le pide es únicamente leer las celdas de un trozo de papel que ya sabemos
 * cuál es.
 *
 * ── Y por qué su lectura nunca llega a OK sola ──────────────────────────────
 *
 * El techo de confianza es 0,85, por debajo del umbral de campo. Una línea
 * leída por IA sólo sale bien parada si además **la aritmética cuadra**, que es
 * una comprobación que no depende del modelo: cantidad × precio × descuentos
 * tiene que dar el importe. Sin esa red, un número alucinado entraría en
 * contabilidad con la misma cara que uno leído.
 *
 * Se le piden los valores COMO ESTÁN IMPRESOS —cadenas, no números— por lo
 * mismo que en `invoice-scan`: convertir `1.010,07` a número es una decisión
 * sobre qué separador es el decimal, y esa decisión ya está escrita y probada
 * en `domain/correo/importes.ts`.
 */

import { hayIA as hayIAConfigurada, pedirIA } from "../../core/openaiService.ts";
import type { AnalisisAlbaran } from "../domain/documento/index.ts";
import { extraerLineas } from "../domain/documento/lineas.ts";
import type { DocumentoTexto, LineaTexto } from "../domain/documento/tipos.ts";

export { hayIA } from "../../core/openaiService.ts";

/** Techo de confianza de todo lo que salga de aquí. */
export const TECHO_CONFIANZA_IA = 0.85;

const TIMEOUT_MS = 90_000;

const ESQUEMA = {
  type: "object",
  additionalProperties: false,
  required: ["lineas"],
  properties: {
    lineas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["referencia", "descripcion", "cantidad", "precio", "descuentos", "importe"],
        properties: {
          referencia: { type: ["string", "null"] },
          descripcion: { type: ["string", "null"] },
          cantidad: { type: ["string", "null"] },
          precio: { type: ["string", "null"] },
          // La celda entera tal y como está impresa: «60% + 10%».
          descuentos: { type: ["string", "null"] },
          importe: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

const INSTRUCCIONES = `Eres un lector de tablas de albaranes. Te doy el texto de UNA sección de albarán ya localizada.

Devuelve SOLO las filas de artículo de esa sección, en el orden en que aparecen.

Reglas, sin excepción:
- Copia cada valor TAL Y COMO ESTÁ IMPRESO, como texto. No conviertas números, no cambies comas por puntos, no quites el símbolo del euro si está.
- La celda de descuento va entera y sin tocar: si pone "60% + 10%", devuelve "60% + 10%". No la conviertas a un solo porcentaje.
- Si una celda no está o no se lee, devuelve null. NO la inventes ni la deduzcas de las demás.
- Portes, tasas, recargos, base imponible, IVA y totales NO son filas de artículo: déjalos fuera.
- No añadas filas que no estén escritas.`;

type FilaIA = {
  referencia: string | null;
  descripcion: string | null;
  cantidad: string | null;
  precio: string | null;
  descuentos: string | null;
  importe: string | null;
};

/**
 * Convierte lo que devuelve el modelo en filas con posición.
 *
 * Se fabrican `LineaTexto` con las `x` de una rejilla canónica y se pasan por
 * el MISMO `extraerLineas` que usa el camino determinista. Así la aritmética,
 * los descuentos y la confianza se calculan con el código ya probado, y lo
 * único que aporta la IA es el contenido de las celdas.
 */
function comoFilas(filas: FilaIA[], pagina: number): LineaTexto[] {
  const X = { ref: 40, desc: 120, cant: 300, precio: 350, dto: 425, importe: 500 };
  const cabecera = crearFila(pagina, 100, [
    ["Ref", X.ref],
    ["Descripcion", X.desc],
    ["Cant", X.cant],
    ["Precio", X.precio],
    ["Dto", X.dto],
    ["Importe", X.importe],
  ]);
  const cuerpo = filas.map((f, i) =>
    crearFila(pagina, 120 + i * 14, [
      [f.referencia ?? "", X.ref],
      [f.descripcion ?? "", X.desc],
      [f.cantidad ?? "", X.cant],
      [f.precio ?? "", X.precio],
      [f.descuentos ?? "", X.dto],
      [f.importe ?? "", X.importe],
    ])
  );
  return [cabecera, ...cuerpo];
}

function crearFila(pagina: number, y: number, celdas: [string, number][]): LineaTexto {
  const palabras = celdas.flatMap(([texto, x]) => {
    let cursor = x;
    return texto
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => {
        const p = { texto: t, x: cursor, y, w: t.length * 5, h: 10 };
        cursor += t.length * 5 + 5;
        return p;
      });
  });
  const x = palabras.length ? Math.min(...palabras.map((p) => p.x)) : 0;
  const derecha = palabras.length ? Math.max(...palabras.map((p) => p.x + p.w)) : 0;
  return {
    pagina,
    x,
    y,
    w: derecha - x,
    h: 10,
    tamano: 10,
    texto: palabras.map((p) => p.texto).join(" "),
    palabras,
  };
}

/**
 * Pide las líneas de la sección ya localizada.
 *
 * Devuelve `null` —y no lanza— cuando no hay IA, el modelo falla o no saca
 * nada. Que el respaldo no responda no puede convertir un análisis incompleto
 * en un error: el albarán está localizado y eso ya vale, aunque sus líneas
 * queden sin leer.
 */
export async function extraerConIA(
  documento: DocumentoTexto,
  analisis: AnalisisAlbaran,
  toleranciaCentimos: number
): Promise<AnalisisAlbaran | null> {
  if (!hayIAConfigurada() || !analisis.seccion) return null;

  const texto = analisis.seccion.lineas.map((l) => l.texto).join("\n").trim();
  const paginas = documento.paginas.filter(
    (p) => p.numero >= analisis.seccion!.paginaInicio && p.numero <= analisis.seccion!.paginaFin
  );
  if (!texto && paginas.length === 0) return null;

  const r = await pedirIA<{ lineas: FilaIA[] }>({
    operacion: "therefore.leerAlbaran",
    proposito: "documento",
    prompt: `${INSTRUCCIONES}\n\nSección del albarán ${analisis.numeroDocumento ?? "(sin número)"}:\n\n${texto}`,
    esquema: { nombre: "lineas_albaran", schema: ESQUEMA as unknown as Record<string, unknown> },
    maxTokens: 4000,
    timeoutMs: TIMEOUT_MS,
  });

  if (!r.ok || !r.datos?.lineas?.length) {
    console.warn("[Therefore] la IA no ha devuelto líneas para el albarán", analisis.numeroSolicitado);
    return null;
  }

  const extraidas = extraerLineas(comoFilas(r.datos.lineas, analisis.paginaInicio ?? 1), {
    toleranciaCentimos,
    techoConfianza: TECHO_CONFIANZA_IA,
  });

  const suma = extraidas.lineas.reduce<number | null>(
    (t, l) => (t === null || l.importeCentimos === null ? null : t + l.importeCentimos),
    0
  );

  return {
    ...analisis,
    lineas: extraidas.lineas,
    conceptos: extraidas.conceptos,
    sumaLineasCentimos: extraidas.lineas.length ? suma : null,
    modoTabla: extraidas.rejilla.modo,
  };
}
