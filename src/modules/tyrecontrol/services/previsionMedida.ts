/**
 * La previsión de sustituciones, de filas largas a una tabla de compra.
 *
 * La RPC `tc_informes_sustituciones_previstas` devuelve una fila por MEDIDA y
 * PLAZO, que es la forma cómoda de calcularlo en SQL y la incómoda de leerlo:
 * quien compra quiere una fila por medida y una columna por plazo. El giro
 * vive aquí, puro y probado, y no dentro de un `useMemo`.
 *
 * ── Por qué hay dos números por celda ───────────────────────────────────────
 *
 * `enElTramo` son las gomas que caen ENTRE el plazo anterior y éste: lo que se
 * compra ese mes. `acumulado` son las vencidas más todo lo que cae hasta ese
 * plazo: lo que hay que tener disponible para entonces. Son preguntas
 * distintas y las dos se usan, así que la pantalla las enseña a elección y
 * aquí se guardan las dos.
 *
 * ── Y la fila de totales no es una suma cualquiera ─────────────────────────
 *
 * `montados`, `sinDatos`, `sinFecha` y `vencidos` sí se suman entre medidas. Pero ojo con
 * leer el total de un plazo como «lo que hay que comprar»: son gomas de
 * medidas distintas, y una previsión total sin desglosar no sirve para pedir
 * nada. La pantalla la enseña igual, porque dice cuánta flota se mueve, pero
 * la columna que se usa para comprar es la de cada medida.
 */

import type { PrevisionMedida } from "../types/informes";

export interface FilaPrevision {
  medida: string;
  montados: number;
  /** Montadas sin ninguna medición: el arco no las lee. */
  sinDatos: number;
  /** Medidas pero sin fecha prevista. */
  sinFecha: number;
  vencidos: number;
  /** plazo en días → gomas que caen en ese tramo */
  enElTramo: Record<number, number>;
  /** plazo en días → vencidas más todo lo que cae hasta ese plazo */
  acumulado: Record<number, number>;
}

export interface Prevision {
  /** Los plazos, de menor a mayor. */
  tramos: number[];
  filas: FilaPrevision[];
  total: FilaPrevision;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function vacia(medida: string): FilaPrevision {
  return { medida, montados: 0, sinDatos: 0, sinFecha: 0, vencidos: 0, enElTramo: {}, acumulado: {} };
}

export function pivotar(filas: PrevisionMedida[]): Prevision {
  const tramos = [...new Set(filas.map((f) => num(f.dias)))].sort((a, b) => a - b);
  const por = new Map<string, FilaPrevision>();

  for (const f of filas) {
    const medida = String(f.medida ?? "").trim() || "(sin medida)";
    let fila = por.get(medida);
    if (!fila) {
      fila = vacia(medida);
      // Estos tres vienen repetidos en cada fila de la medida: se toman una vez.
      fila.montados = num(f.montados);
      fila.sinDatos = num(f.sin_datos);
      fila.sinFecha = num(f.sin_fecha);
      fila.vencidos = num(f.vencidos);
      por.set(medida, fila);
    }
    fila.enElTramo[num(f.dias)] = num(f.en_el_tramo);
    fila.acumulado[num(f.dias)] = num(f.acumulado);
  }

  const lista = [...por.values()].sort((a, b) => b.montados - a.montados || a.medida.localeCompare(b.medida));

  const total = vacia("TOTAL");
  for (const f of lista) {
    total.montados += f.montados;
    total.sinDatos += f.sinDatos;
    total.sinFecha += f.sinFecha;
    total.vencidos += f.vencidos;
    for (const d of tramos) {
      total.enElTramo[d] = (total.enElTramo[d] ?? 0) + (f.enElTramo[d] ?? 0);
      total.acumulado[d] = (total.acumulado[d] ?? 0) + (f.acumulado[d] ?? 0);
    }
  }

  return { tramos, filas: lista, total };
}

/** «30 días», «6 meses», «1 año»: como lo diría una persona. */
export function nombreDeTramo(dias: number): string {
  if (dias % 365 === 0 && dias >= 365) return dias === 365 ? "1 año" : `${dias / 365} años`;
  if (dias % 30 === 0 && dias >= 180) return `${dias / 30} meses`;
  return `${dias} días`;
}
