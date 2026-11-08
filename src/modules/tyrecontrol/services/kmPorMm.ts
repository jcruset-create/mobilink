/**
 * Los kilómetros por milímetro, de filas por eje a filas por modelo.
 *
 * La RPC `tc_informes_km_por_mm` devuelve una fila por modelo Y EJE, porque el
 * eje es media explicación del desgaste: en los autobuses de Plana el primero
 * se come el dibujo un 50 % más rápido que el segundo. La pantalla quiere las
 * dos vistas, así que el reagrupado vive aquí, puro y probado, y no dentro de
 * un `useMemo`.
 *
 * ── La trampa que justifica que esto sea una función y no un `reduce` suelto ─
 *
 * El km/mm de un modelo NO es la media de los km/mm de sus ejes. Es la razón
 * de las sumas: Σkm / Σmm. Con el AH51, promediar los tres ejes da 8.917 y la
 * razón de las sumas da 8.684, y la segunda es la buena — un eje con 27 tramos
 * no puede pesar lo mismo que uno con 316 —. Promediar razones es el error
 * clásico de este cálculo y por eso hay una prueba que lo fija.
 *
 * Los `neumaticos` del modelo tampoco se suman por eje: vienen contados aparte
 * en la RPC (`neumaticos_modelo`), porque una goma que haya rodado en dos ejes
 * se contaría dos veces.
 */

import type { KmPorMmFila } from "../types/informes";

/** Un eje de un modelo, ya con su ritmo. */
export interface EjeKmPorMm {
  /** `null` cuando la medición no tenía posición conocida. */
  eje: number | null;
  tramos: number;
  kmPorMm: number;
  mediana: number;
}

/** Un modelo de neumático con lo que aguanta cada milímetro. */
export interface ModeloKmPorMm {
  clave: string;
  marca: string;
  modelo: string;
  tramos: number;
  neumaticos: number;
  kmTotales: number;
  mmTotales: number;
  kmPorMm: number;
  mmNuevo: number | null;
  mmRetirada: number | null;
  /** Vida completa estimada, de nuevo a retirada. `null` si falta algún extremo. */
  vidaKm: number | null;
  ejes: EjeKmPorMm[];
}

/** PostgREST puede mandar un `numeric` como cadena; aquí todo acaba en número. */
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numONulo(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function claveDe(marca: string, modelo: string): string {
  return `${marca.trim()} · ${modelo.trim()}`;
}

/** El nombre del eje tal y como se enseña. No se adivina si es directriz. */
export function nombreDeEje(eje: number | null): string {
  return eje === null ? "Sin posición" : `Eje ${eje}`;
}

/**
 * Agrupa las filas por modelo. Sale ordenado por kilómetros medidos, que es
 * tanto como decir por cuánto hay detrás de cada número.
 */
export function agruparPorModelo(filas: KmPorMmFila[]): ModeloKmPorMm[] {
  const por = new Map<string, ModeloKmPorMm>();

  for (const f of filas) {
    const marca = String(f.marca ?? "").trim();
    const modelo = String(f.modelo ?? "").trim();
    if (!marca && !modelo) continue;
    const clave = claveDe(marca, modelo);

    let m = por.get(clave);
    if (!m) {
      m = {
        clave, marca, modelo,
        tramos: 0, neumaticos: num(f.neumaticos_modelo),
        kmTotales: 0, mmTotales: 0, kmPorMm: 0,
        mmNuevo: numONulo(f.mm_nuevo), mmRetirada: numONulo(f.mm_retirada),
        vidaKm: null, ejes: [],
      };
      por.set(clave, m);
    }

    const km = num(f.km_totales);
    const mm = num(f.mm_totales);
    m.tramos += num(f.tramos);
    m.kmTotales += km;
    m.mmTotales += mm;
    m.ejes.push({
      eje: f.eje === null || f.eje === undefined ? null : num(f.eje),
      tramos: num(f.tramos),
      kmPorMm: num(f.km_por_mm),
      mediana: num(f.mediana),
    });
  }

  const salida = [...por.values()];
  for (const m of salida) {
    // Razón de las sumas, nunca media de razones. Ver la cabecera.
    m.kmPorMm = m.mmTotales > 0 ? Math.round(m.kmTotales / m.mmTotales) : 0;
    m.vidaKm =
      m.mmNuevo !== null && m.mmRetirada !== null && m.mmNuevo > m.mmRetirada && m.kmPorMm > 0
        ? Math.round((m.mmNuevo - m.mmRetirada) * m.kmPorMm)
        : null;
    // Los ejes, por número y con los de posición desconocida al final.
    m.ejes.sort((a, b) => (a.eje ?? 99) - (b.eje ?? 99));
  }

  salida.sort((a, b) => b.kmTotales - a.kmTotales);
  return salida;
}

export type Orden = "evidencia" | "km_por_mm" | "vida";

/** El orden de la tabla. Por defecto manda la evidencia, no el récord. */
export function ordenar(modelos: ModeloKmPorMm[], orden: Orden): ModeloKmPorMm[] {
  const copia = [...modelos];
  if (orden === "km_por_mm") copia.sort((a, b) => b.kmPorMm - a.kmPorMm);
  else if (orden === "vida") copia.sort((a, b) => (b.vidaKm ?? -1) - (a.vidaKm ?? -1));
  else copia.sort((a, b) => b.kmTotales - a.kmTotales);
  return copia;
}
