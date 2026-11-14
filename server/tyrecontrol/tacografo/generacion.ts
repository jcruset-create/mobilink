/**
 * Qué generación de tacógrafo es, leída de la versión de software.
 *
 * ── Por qué de la versión y no de la referencia ─────────────────────────────
 *
 * Lo intuitivo sería que el número de pieza lo dijera, y no lo dice. En las
 * 1.744 intervenciones de producción:
 *
 *     1381.4521402002  →  versión 30037  →  digital 3.0
 *     1381.1521343002  →  versión 40042  →  INTELIGENTE
 *     1381.7550303005  →  versión 30041  →  digital 3.0
 *     1381.0552033002  →  versión 41041  →  INTELIGENTE
 *
 * Un `4` detrás de `1381` sale en un 3.0 y un `1` sale en un 4.0: la
 * referencia es el número de pieza del aparato —modelo, variante,
 * homologación— y no su generación.
 *
 * ── La frontera, comprobada con los datos del cliente ───────────────────────
 *
 * De 962 intervenciones de VDO con versión apuntada, el GNSS y el DSRC
 * aparecen en 23, y las 23 son de versión 4.x. En las 905 de 0.x, 1.x, 2.x y
 * 3.x no aparece ni una vez. Y eso es justo lo que separa un tacógrafo
 * inteligente de uno digital: el inteligente lleva posicionamiento por
 * satélite y comunicación a distancia.
 *
 * ── Stoneridge numera distinto, y no se adivina ─────────────────────────────
 *
 * Sus versiones son `PABF.S0L`, `2424.S0L`, `1214.s09`… y ahí el primer
 * dígito no significa lo mismo. Se devuelve «desconocida» en vez de aplicar
 * la regla de VDO a un aparato que no es VDO: decir «2.ª generación» porque
 * una versión empieza por 2 sería inventárselo.
 */

export type Generacion = "digital" | "inteligente_v1" | "inteligente_v2" | "desconocida";

export interface GeneracionTacografo {
  generacion: Generacion;
  /** Lo que se enseña: «DTCO 3.0 · digital». */
  etiqueta: string;
  /** Para un título, cuando hace falta explicarlo. */
  detalle: string;
}

const DESCONOCIDA: GeneracionTacografo = {
  generacion: "desconocida",
  etiqueta: "—",
  detalle: "El informe no dice la versión de software, así que no se puede saber la generación.",
};

/**
 * La generación de un tacógrafo VDO por su versión de software.
 *
 * `fabricante` se pide para no aplicar la regla de VDO a un Stoneridge: sus
 * versiones empiezan por dígitos que aquí significarían otra cosa. Si no se
 * sabe el fabricante se mira la forma de la versión, que en VDO son cinco
 * dígitos (`30041`) y en Stoneridge llevan punto y letras (`2424.S0L`).
 */
export function generacionDeTacografo(
  version: string | null | undefined, fabricante?: string | null,
): GeneracionTacografo {
  const v = (version ?? "").trim();
  if (v === "") return DESCONOCIDA;

  const esVdo = fabricante == null || /vdo|aumovio|continental/i.test(fabricante);
  if (!esVdo || !/^\d{5}$/.test(v)) {
    return {
      generacion: "desconocida",
      etiqueta: `${v} · sin clasificar`,
      detalle: "La versión no tiene el formato de VDO, así que no se le aplica su regla de "
        + "generaciones. Otros fabricantes numeran distinto.",
    };
  }

  // `30041` → DTCO 3.0. Los dos primeros dígitos son la release.
  const release = `${v[0]}.${v[1]}`;
  if (v.startsWith("41")) {
    return {
      generacion: "inteligente_v2",
      etiqueta: `DTCO ${release} · inteligente 2.ª gen.`,
      detalle: "Tacógrafo inteligente de segunda generación, obligatorio en matriculaciones "
        + "nuevas desde el 21/08/2023. Lleva GNSS y DSRC.",
    };
  }
  if (v.startsWith("40")) {
    return {
      generacion: "inteligente_v1",
      etiqueta: `DTCO ${release} · inteligente 1.ª gen.`,
      detalle: "Tacógrafo inteligente de primera generación, obligatorio en matriculaciones "
        + "nuevas desde el 15/06/2019. Lleva GNSS y DSRC.",
    };
  }
  return {
    generacion: "digital",
    etiqueta: `DTCO ${release} · digital`,
    detalle: "Tacógrafo digital del reglamento anterior (anexo IB, de 2006). No es inteligente: "
      + "no lleva ni GNSS ni DSRC.",
  };
}
