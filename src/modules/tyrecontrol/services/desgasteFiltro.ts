/**
 * Los cuadros del informe de desgaste, y lo que deja en la tabla cada uno.
 *
 * El cuadro es la pregunta y la tabla la respuesta: pulsar «Sustitución
 * vencida» tiene que dejar esas 23 y no obligar a buscarlas entre mil filas.
 * El recuento del cuadro y el filtro salen de la MISMA función, así que no
 * pueden decir cosas distintas.
 */
import type { DesgasteNeumatico } from "../types/informes";

export type FiltroDesgaste = "todo" | "vencida" | "proxima" | "modelo";

/** Los días del cuadro «Sustituir en 60 días». */
export const DIAS_PROXIMA = 60;

/** Dónde cae la fecha prevista de una goma: ya pasó, toca pronto, o ni lo uno ni lo otro. */
export type Plazo = "vencida" | "proxima" | "resto";

export function plazoDe(i: Pick<DesgasteNeumatico, "fecha_prevista">, hoy: Date): Plazo {
  if (!i.fecha_prevista) return "resto";
  const prevista = new Date(i.fecha_prevista);
  if (Number.isNaN(prevista.getTime())) return "resto";
  if (prevista <= hoy) return "vencida";
  const limite = new Date(hoy);
  limite.setDate(hoy.getDate() + DIAS_PROXIMA);
  return prevista <= limite ? "proxima" : "resto";
}

/** Si la goma entra en ese cuadro. */
export function entraEn(i: DesgasteNeumatico, filtro: FiltroDesgaste, hoy: Date): boolean {
  switch (filtro) {
    case "vencida": return plazoDe(i, hoy) === "vencida";
    case "proxima": return plazoDe(i, hoy) === "proxima";
    // «Del modelo» no es un plazo: una goma puede estar vencida Y llevar el
    // ritmo prestado. Por eso este cuadro se solapa con los otros dos.
    case "modelo": return i.origen_ritmo === "modelo";
    default: return true;
  }
}

/** Las filas de ese cuadro, en el orden en que venían (el de urgencia). */
export function filtrarDesgaste(items: DesgasteNeumatico[], filtro: FiltroDesgaste, hoy: Date): DesgasteNeumatico[] {
  return filtro === "todo" ? items : items.filter((i) => entraEn(i, filtro, hoy));
}

/** El número de cada cuadro. */
export function recuentosDesgaste(items: DesgasteNeumatico[], hoy: Date): Record<Exclude<FiltroDesgaste, "todo">, number> {
  const n = { vencida: 0, proxima: 0, modelo: 0 };
  for (const i of items) {
    const plazo = plazoDe(i, hoy);
    if (plazo !== "resto") n[plazo] += 1;
    if (i.origen_ritmo === "modelo") n.modelo += 1;
  }
  return n;
}

/** Cómo se llama cada filtro en pantalla, para decir qué se está viendo. */
export const NOMBRE_FILTRO: Record<FiltroDesgaste, string> = {
  todo: "Todas",
  vencida: "Sustitución vencida",
  proxima: `Sustituir en ${DIAS_PROXIMA} días`,
  modelo: "Con ritmo del modelo",
};
