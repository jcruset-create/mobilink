/**
 * Encontrar el número de OR dentro de una página, y decir cuánto se fía uno.
 *
 * Es dominio puro: entra texto con coordenadas —lo que devuelve el lector de
 * PDF de Therefore, o lo que escriba una prueba a mano— y sale un candidato
 * con su confianza. No abre ficheros, no llama a ningún modelo y no sabe qué
 * blocs existen: eso último llega como un predicado, `dentroDeAlgunBloc`.
 *
 * ── Por qué la confianza es un número y no un sí/no ─────────────────────────
 *
 * Porque archivar en la OR equivocada es el peor fallo posible del módulo: el
 * papel de una reparación acaba colgado de otra y nadie se entera hasta que
 * alguien lo busca, meses después. Un número permite la regla del encargo —alta
 * archiva sola, media va a revisión, baja no se toca— y permite subir el listón
 * sin reescribir la detección.
 *
 * ── Qué sube y qué baja la confianza ────────────────────────────────────────
 *
 * Sube: estar en la zona donde el taller escribe la OR, venir detrás de un
 * rótulo («OR», «Nº», «Orden»), caer dentro de un bloc que existe, y ser el
 * único candidato de la página. Baja: haber varios números plausibles, estar
 * fuera de la zona, o no caer en ningún bloc conocido.
 *
 * Los pesos son constantes con nombre, no números sueltos repartidos por el
 * código, y los UMBRALES no viven aquí: son configuración por empresa
 * (`config.ts`), porque el encargo pide poder moverlos sin desplegar.
 */

import type { MetodoDeteccion } from "./estados.ts";

/* ── La zona donde mirar ──────────────────────────────────────────────────── */

/**
 * La zona de la página donde está el número, en fracciones de 0 a 1 sobre el
 * ancho y el alto.
 *
 * Relativa y no en milímetros a propósito: las OR se escanean a A4, a carta y
 * torcidas, y una caja en puntos absolutos deja de valer en cuanto cambia el
 * escáner. Con fracciones, «arriba a la derecha» sigue siendo arriba a la
 * derecha en cualquier tamaño.
 */
export type ZonaOcr = { x: number; y: number; ancho: number; alto: number };

/**
 * Arriba a la derecha: el cuarto superior derecho de la hoja.
 *
 * Es donde va preimpreso el número en los blocs del taller. Generosa a
 * propósito —más vale que entre algún número de más, que se descarta por no
 * caer en ningún bloc, que dejar fuera el bueno— y cambiable desde la pantalla
 * de configuración sin tocar código.
 */
export const ZONA_POR_DEFECTO: ZonaOcr = { x: 0.55, y: 0, ancho: 0.45, alto: 0.3 };

export function zonaValida(z: ZonaOcr): boolean {
  const dentro = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
  return (
    dentro(z.x) && dentro(z.y) && dentro(z.ancho) && dentro(z.alto) &&
    z.ancho > 0 && z.alto > 0 && z.x + z.ancho <= 1.0001 && z.y + z.alto <= 1.0001
  );
}

/* ── Lo que entra ─────────────────────────────────────────────────────────── */

/** Una línea de texto con su sitio en la página. Compatible con el lector de PDF. */
export type LineaPagina = { texto: string; x: number; y: number; w: number; h: number };

export type PaginaAnalizable = {
  numero: number;
  ancho: number;
  alto: number;
  lineas: readonly LineaPagina[];
};

export type OpcionesDeteccion = {
  zona?: ZonaOcr;
  /** Qué números existen de verdad. Un número que no cae en ningún bloc casi nunca es la OR. */
  dentroDeAlgunBloc?: (numero: number) => boolean;
  /** Para distinguir la lectura del texto del PDF de la lectura de una imagen. */
  origen?: "texto" | "ocr";
};

/* ── Lo que sale ──────────────────────────────────────────────────────────── */

export type Candidato = {
  numero: number;
  /** 0 a 100. */
  confianza: number;
  metodo: MetodoDeteccion;
  /** El trozo de texto del que se sacó, para que una persona pueda comprobarlo. */
  texto: string;
  enZona: boolean;
  conRotulo: boolean;
  enBloc: boolean;
};

export type Deteccion = {
  /** El mejor candidato, o `null` si no había ninguno. */
  candidato: Candidato | null;
  /** Los demás, ordenados de más a menos confianza. Se guardan para auditoría. */
  otros: Candidato[];
};

/* ── Los pesos ────────────────────────────────────────────────────────────── */

/*
 * Los pesos suman EXACTAMENTE 100 en el caso perfecto. No es cosmética: si
 * sumaran más, el tope de 100 se comería las penalizaciones y una lectura de
 * imagen puntuaría igual que el texto exacto de un PDF. Al cuadrar la suma,
 * cada penalización se nota siempre.
 */

/** Un número suelto, sin nada a favor. Poco más que una corazonada. */
const BASE = 35;
/** Está donde el bloc lleva impreso el número. */
const PESO_ZONA = 25;
/** Viene detrás de «OR», «Nº», «Orden»… */
const PESO_ROTULO = 20;
/** Cae dentro de un bloc que existe. Sin esto no hay dónde archivarlo. */
const PESO_EN_BLOC = 15;
/** Era el único número plausible de la página. */
const PESO_UNICO = 5;
/**
 * Leerlo de una imagen es menos fiable que leerlo del texto del PDF, siempre.
 * Un PDF digital dice el número; un OCR lo interpreta.
 */
const PENALIZACION_OCR = 10;
/**
 * Hay otro candidato que empata: no se puede estar seguro de cuál es.
 *
 * La penalización es lo bastante grande para dejar al ganador POR DEBAJO de la
 * banda de revisión con los umbrales por defecto, y eso es a propósito: si un
 * empate se quedara en «revisión», el módulo archivaría una de las dos
 * opciones —acertando la mitad de las veces— y la marca de revisar sólo
 * avisaría después. Un empate no se archiva: va a la bandeja.
 */
const PENALIZACION_EMPATE = 35;

/** Las OR del taller son números de 3 a 7 cifras. */
const NUMERO = /\b(\d{3,7})\b/g;

/**
 * Rótulos que anuncian el número. `O\.?\s?R\.?` cubre «OR», «O.R.» y «O R»;
 * las variantes de «número» cubren `Nº`, `N°`, `No`, `N.`, `NUM` y «NÚMERO»,
 * que son las formas que salen de un teclado y de un sello de goma.
 */
const ROTULO = /(?:O\.?\s?R\.?|ORDEN|N[ºo°]|N\.|NUM|N[ÚU]MERO)[\s.:·º-]*$/i;

/**
 * Números que nunca son una OR aunque lo parezcan: años y fechas. Sin esto,
 * el «2026» de la fecha del parte compite con la OR en cada página.
 */
const ANIOS = new Set([1900, 2000, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030]);

/* ── La detección ─────────────────────────────────────────────────────────── */

/**
 * Busca el número de OR en una página.
 *
 * El orden del encargo —código de barras, QR, OCR de zona, OCR general— se
 * respeta en la cascada de `ocr.ts`, que es quien decide qué material tiene.
 * Aquí se resuelve un paso de esa cascada: dado el texto que sea, cuál es el
 * número y cuánto fiarse.
 */
export function detectarNumeroOr(pagina: PaginaAnalizable, opciones: OpcionesDeteccion = {}): Deteccion {
  const zona = opciones.zona && zonaValida(opciones.zona) ? opciones.zona : ZONA_POR_DEFECTO;
  const enBlocDe = opciones.dentroDeAlgunBloc ?? (() => false);
  const esOcr = opciones.origen === "ocr";

  const crudos: Omit<Candidato, "confianza" | "metodo">[] = [];

  for (const linea of pagina.lineas) {
    const enZona = lineaEnZona(linea, pagina, zona);
    NUMERO.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NUMERO.exec(linea.texto)) !== null) {
      const numero = Number(m[1]);
      if (!Number.isFinite(numero) || numero <= 0) continue;
      if (ANIOS.has(numero)) continue;
      const antes = linea.texto.slice(0, m.index);
      crudos.push({
        numero,
        texto: linea.texto.trim(),
        enZona,
        conRotulo: ROTULO.test(antes),
        enBloc: enBlocDe(numero),
      });
    }
  }

  if (crudos.length === 0) return { candidato: null, otros: [] };

  // Un mismo número repetido en la página no es dos candidatos: es uno con más
  // motivos. Se quedan los mejores atributos de todas sus apariciones.
  const porNumero = new Map<number, Omit<Candidato, "confianza" | "metodo">>();
  for (const c of crudos) {
    const previo = porNumero.get(c.numero);
    if (!previo) {
      porNumero.set(c.numero, c);
      continue;
    }
    porNumero.set(c.numero, {
      numero: c.numero,
      texto: previo.conRotulo || !c.conRotulo ? previo.texto : c.texto,
      enZona: previo.enZona || c.enZona,
      conRotulo: previo.conRotulo || c.conRotulo,
      enBloc: previo.enBloc || c.enBloc,
    });
  }

  const unico = porNumero.size === 1;
  const metodoBase: MetodoDeteccion = esOcr ? "OCR_PAGINA" : "TEXTO_PAGINA";
  const metodoZona: MetodoDeteccion = esOcr ? "OCR_ZONA" : "TEXTO_ZONA";

  const puntuados: Candidato[] = [...porNumero.values()]
    .map((c) => ({
      ...c,
      metodo: c.enZona ? metodoZona : metodoBase,
      confianza: puntuar(c, { unico, esOcr }),
    }))
    .sort((a, b) => b.confianza - a.confianza || Number(b.enBloc) - Number(a.enBloc) || a.numero - b.numero);

  const [mejor, segundo, ...resto] = puntuados;

  /*
   * Dos candidatos igual de buenos son PEOR que uno regular: elegir uno de los
   * dos es tirar una moneda, y media probabilidad de archivar mal. Se rebaja
   * el ganador para que caiga en la banda de revisión y lo mire una persona.
   */
  if (segundo && segundo.confianza === mejor.confianza) {
    mejor.confianza = Math.max(0, mejor.confianza - PENALIZACION_EMPATE);
  }

  return { candidato: mejor, otros: [segundo, ...resto].filter(Boolean) };
}

function puntuar(
  c: { enZona: boolean; conRotulo: boolean; enBloc: boolean },
  ctx: { unico: boolean; esOcr: boolean }
): number {
  let p = BASE;
  if (c.enZona) p += PESO_ZONA;
  if (c.conRotulo) p += PESO_ROTULO;
  if (c.enBloc) p += PESO_EN_BLOC;
  if (ctx.unico) p += PESO_UNICO;
  if (ctx.esOcr) p -= PENALIZACION_OCR;
  return Math.max(0, Math.min(100, p));
}

/** ¿El centro de la línea cae dentro de la zona? */
function lineaEnZona(linea: LineaPagina, pagina: PaginaAnalizable, zona: ZonaOcr): boolean {
  if (pagina.ancho <= 0 || pagina.alto <= 0) return false;
  const cx = (linea.x + linea.w / 2) / pagina.ancho;
  const cy = (linea.y + linea.h / 2) / pagina.alto;
  return cx >= zona.x && cx <= zona.x + zona.ancho && cy >= zona.y && cy <= zona.y + zona.alto;
}

/* ── Qué hacer con el candidato ───────────────────────────────────────────── */

export type Umbrales = { automatico: number; revision: number };

export type Decision = "ARCHIVAR" | "REVISAR" | "NO_IDENTIFICADO";

/**
 * La regla del encargo, en un solo sitio:
 *
 *   ≥ automático (90 por defecto)  → se archiva solo
 *   ≥ revisión   (70 por defecto)  → se archiva, marcado para revisar
 *   por debajo, o sin bloc donde encajar → no se identifica; a la bandeja
 *
 * Un número que no cae en ningún bloc NUNCA se archiva por mucha confianza que
 * tenga en la lectura: leer bien un número que no existe no da dónde ponerlo.
 */
export function decidir(candidato: Candidato | null, umbrales: Umbrales): Decision {
  if (!candidato || !candidato.enBloc) return "NO_IDENTIFICADO";
  if (candidato.confianza >= umbrales.automatico) return "ARCHIVAR";
  if (candidato.confianza >= umbrales.revision) return "REVISAR";
  return "NO_IDENTIFICADO";
}
