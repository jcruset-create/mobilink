import type { EstadoFotoEtiqueta, FotoEtiqueta } from "./datos";

/**
 * Las decisiones de la pantalla de revisión, sin React y sin base de datos.
 *
 * Están aquí porque son las que se pueden equivocar en silencio: qué número
 * se propone en la casilla, cuál se imprime, y cuándo dos fotos son la misma
 * rueda. Lo demás de la pantalla es pintar.
 */

/**
 * La clave con la que se comparan dos números para ver si son EL MISMO.
 *
 * Se quita todo lo que no sea letra o dígito: un guion de más en una lectura
 * no hace de dos ruedas una. Es la misma cuenta que hace el servidor en
 * `server/tyrecontrol/etiquetas/serie.ts`, a propósito — si las dos no
 * coincidieran, la tablet y el panel marcarían duplicados distintos.
 */
export const claveSerie = (t: string | null | undefined): string =>
  (t ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();

/** Cómo se guarda y se imprime un número: sin espacios y en mayúsculas. */
export const normalizarSerie = (t: string | null | undefined): string =>
  (t ?? "").replace(/\s+/g, "").toUpperCase();

/**
 * El número que se le propone a la persona en la casilla.
 *
 * Primero lo que ya confirmó alguien —no se le deshace su corrección al
 * recargar—, y si no, lo que leyó la IA. Nunca se inventa nada: si no hay
 * ninguno de los dos, la casilla sale vacía.
 */
export const serieEditable = (f: Pick<FotoEtiqueta, "serie_confirmada" | "serie_detectada">): string =>
  normalizarSerie(f.serie_confirmada ?? f.serie_detectada ?? "");

/** Solo se imprime lo que una persona ha confirmado. */
export const imprimible = (f: Pick<FotoEtiqueta, "estado" | "serie_confirmada">): boolean =>
  (f.estado === "confirmada" || f.estado === "impresa") && !!f.serie_confirmada?.trim();

const POR_REVISAR: EstadoFotoEtiqueta[] = ["pendiente", "detectada", "revisar", "no_detectada"];
export const porRevisar = (f: Pick<FotoEtiqueta, "estado">): boolean =>
  POR_REVISAR.includes(f.estado);

/**
 * Los números que aparecen en más de una foto del lote.
 *
 * Importa porque el error típico es fotografiar dos veces la misma rueda y
 * acabar con dos etiquetas iguales pegadas a dos gomas distintas. Las
 * descartadas no cuentan: descartar una repetida es justo cómo se arregla.
 *
 * Esto no decide nada: devuelve las claves repetidas para que la pantalla las
 * marque y una persona diga cuál sobra.
 */
export function clavesRepetidas(
  fotos: Pick<FotoEtiqueta, "estado" | "serie_confirmada" | "serie_detectada">[],
): Set<string> {
  const cuenta = new Map<string, number>();
  for (const f of fotos) {
    if (f.estado === "descartada") continue;
    const k = claveSerie(f.serie_confirmada ?? f.serie_detectada);
    if (!k) continue;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  return new Set([...cuenta.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

export const esRepetida = (
  f: Pick<FotoEtiqueta, "serie_confirmada" | "serie_detectada">,
  repetidas: Set<string>,
): boolean => {
  const k = claveSerie(f.serie_confirmada ?? f.serie_detectada);
  return !!k && repetidas.has(k);
};

export interface ResumenLote {
  total: number;
  porRevisar: number;
  confirmadas: number;
  impresas: number;
  descartadas: number;
  sinNumero: number;
  repetidas: number;
}

/** Los recuentos de la cabecera del lote. Salen todos de la misma lista. */
export function resumirLote(fotos: FotoEtiqueta[]): ResumenLote {
  const repetidas = clavesRepetidas(fotos);
  return {
    total: fotos.length,
    porRevisar: fotos.filter(porRevisar).length,
    confirmadas: fotos.filter((f) => f.estado === "confirmada").length,
    impresas: fotos.filter((f) => f.estado === "impresa").length,
    descartadas: fotos.filter((f) => f.estado === "descartada").length,
    sinNumero: fotos.filter(
      (f) => f.estado !== "descartada" && !serieEditable(f),
    ).length,
    repetidas: fotos.filter(
      (f) => f.estado !== "descartada" && esRepetida(f, repetidas),
    ).length,
  };
}
