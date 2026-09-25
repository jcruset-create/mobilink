import { CONFIANZA_MINIMA } from "../flanco/flanco.ts";

/**
 * Qué hacer con el número de serie que se lee de la foto de una goma nueva.
 *
 * Este módulo NO habla con la IA ni con la base de datos. Recibe lo que el
 * lector de flanco dice haber leído y decide tres cosas que hay que poder
 * probar sin levantar nada:
 *
 *   · si hay número o no lo hay;
 *   · si se puede dar por bueno o tiene que mirarlo una persona;
 *   · si ese número ya salió antes en el mismo lote.
 *
 * REGLA DE LA CASA: esto PROPONE. No confirma, no imprime y no crea
 * neumáticos. Confirmar es de una persona, y sin confirmar no se imprime.
 */

/**
 * Estado en el que queda la foto después de leerla. Son los mismos valores
 * que el check de `tc_etiquetas_foto.estado`, a propósito: lo que decide este
 * módulo es literalmente lo que se guarda.
 */
export type EstadoFoto = "detectada" | "revisar" | "no_detectada";

/**
 * El listón para dar un número por legible es el ALTO del flanco (0,7).
 *
 * Y aquí sí es el alto, al contrario que cuando el número se propone en una
 * casilla durante una revisión. La diferencia es lo que pasa después: allí el
 * técnico tiene el número delante y lo corrige antes de guardar; aquí el
 * destino es una ETIQUETA PEGADA A UNA RUEDA. Un dígito mal se queda pegado
 * meses y nadie lo vuelve a comparar con el flanco.
 *
 * Por debajo del listón el número NO se descarta —se ha leído algo y tirarlo
 * obligaría a teclear trece dígitos a mano—, pero la foto queda en «revisar»:
 * sale marcada en el panel y no se imprime hasta que alguien la mira.
 */
export const CONFIANZA_PARA_ETIQUETAR = CONFIANZA_MINIMA;

/**
 * Limpia el número para guardarlo: sin espacios de sobra y en mayúsculas.
 *
 * No se recorta ni se le da forma: cada fabricante estampa el suyo a su
 * manera, y "arreglarlo" sería inventárselo. Solo se quitan los espacios y
 * los saltos que trae la lectura.
 */
export function normalizarSerie(t: string | null | undefined): string | null {
  const v = (t ?? "").replace(/\s+/g, "").toUpperCase();
  return v || null;
}

/**
 * La clave con la que se comparan dos números para ver si son EL MISMO.
 *
 * Distinta de la de arriba: para comparar se quita todo lo que no sea letra o
 * dígito, porque un guion de más en una lectura no hace de dos ruedas una. Lo
 * que se guarda y se imprime es el valor normalizado, no esta clave.
 */
export function claveSerie(t: string | null | undefined): string {
  return (t ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

export interface LecturaSerie {
  /** El número, ya limpio. null cuando no se ha leído nada. */
  serie: string | null;
  /** 0..1 cuando el lector la da. */
  confianza: number | null;
  /** true si se ha leído algo pero por debajo del listón. */
  dudoso: boolean;
  estado: EstadoFoto;
  /** Qué decirle al operario. Vacío cuando no hay nada que decir. */
  aviso: string | null;
}

/**
 * Lo mínimo que necesita este módulo de un lector, sea cual sea.
 *
 * Lo cumplen tanto la propuesta del lector de flanco —que trae el flanco
 * entero— como la lectura del lector de etiquetas, que trae solo el número.
 * Aquí solo interesa el número: no se busca en el catálogo, no se propone
 * marca ni medida y no se mira el DOT. Etiquetar es pegar un número en una
 * rueda, nada más.
 */
export interface LecturaDeUnLector {
  numero_serie: string | null;
  /** Campos que el lector leyó con poca seguridad, si los marca. */
  dudosos?: string[];
  aviso?: string | null;
}

/** Traduce lo que devuelve un lector a lo que se guarda de la foto. */
export function clasificarLectura(
  p: LecturaDeUnLector | null | undefined,
  /**
   * La confianza del lector, si se conoce. La propuesta del flanco no la
   * arrastra —la aplica y la tira—, así que hoy llega vacía y la columna
   * `confianza` se guarda nula. Queda el parámetro porque el día que el lector
   * la devuelva, lo único que hay que cambiar es la llamada.
   */
  confianza: number | null = null,
): LecturaSerie {
  const serie = normalizarSerie(p?.numero_serie);
  if (!serie) {
    return {
      serie: null,
      confianza,
      dudoso: false,
      estado: "no_detectada",
      // Si la IA dijo por qué, se repite tal cual: «flanco sucio» es más útil
      // que «no se ha detectado número».
      aviso: p?.aviso || "No se ve el número de serie en la foto",
    };
  }

  // El lector marca como dudoso lo que no llega al listón alto. Se le cree:
  // es la misma cuenta que se haría aquí y la hace con la confianza original,
  // antes de que la propuesta la pierda.
  const dudoso = !!p?.dudosos?.includes("numero_serie")
    || (confianza != null && confianza < CONFIANZA_PARA_ETIQUETAR);
  return {
    serie,
    confianza,
    dudoso,
    estado: dudoso ? "revisar" : "detectada",
    aviso: dudoso ? "Número poco claro: compruébalo antes de imprimir" : null,
  };
}

/**
 * Los números que salen más de una vez en un conjunto de fotos.
 *
 * Importa porque el error típico es fotografiar dos veces la misma rueda y
 * acabar con dos etiquetas iguales pegadas a dos gomas distintas. Esto no
 * decide nada: devuelve las claves repetidas para que el panel las marque y
 * una persona diga cuál sobra.
 */
export function seriesRepetidas(series: (string | null | undefined)[]): string[] {
  const cuenta = new Map<string, number>();
  for (const s of series) {
    const k = claveSerie(s);
    if (!k) continue;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return [...cuenta.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

/** true si `serie` es uno de los repetidos que devuelve `seriesRepetidas`. */
export function esRepetida(serie: string | null | undefined, repetidas: string[]): boolean {
  const k = claveSerie(serie);
  return !!k && repetidas.includes(k);
}
