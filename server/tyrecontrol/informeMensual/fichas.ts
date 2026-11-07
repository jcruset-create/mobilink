/**
 * Los listados por banda y la lista de planificación del mes siguiente.
 *
 * Es la parte del original que se baja al patio: una línea por autobús con
 * sus profundidades, de peor a mejor, para decidir a cuál se coge.
 *
 * ── La banda de un autobús es la de su PEOR rueda ───────────────────────────
 *
 * No la media, ni la de delante. Comprobado contra el original: el bus 564
 * tiene 12-12-8-8-4-7 y aparece en «hasta 4 mm» por ese 4; el 535 tiene
 * 9-11-8-8-8-7 y aparece en «>6 mm<8 mm» por ese 7.
 *
 * Y tiene que ser así: un autobús con cinco ruedas nuevas y una por debajo del
 * límite legal es un autobús que no puede salir. Promediar lo escondería
 * detrás de un número bonito, que es exactamente lo que un listado de
 * mantenimiento no debe hacer.
 *
 * ── Un autobús sale UNA vez, en una sola banda ──────────────────────────────
 *
 * Los seis listados del original son una partición: la suma de los seis es la
 * flota revisada. Si un autobús saliera en dos, el jefe de taller lo contaría
 * dos veces al planificar la semana.
 *
 * ── «Observaciones» y «PTE. REPARAR» van en blanco, a propósito ─────────────
 *
 * En el original son columnas que se rellenaban a mano sobre el papel, y así
 * se quedan: con su sitio y vacías. Inventarles un origen —las incidencias
 * abiertas, por ejemplo— llenaría de datos una columna que el taller usa para
 * escribir encima, y el día que no cuadraran nadie sabría de dónde salieron.
 */

import type { Periodo } from "./armar.ts";
import { BANDAS, type Banda, bandaDe, type RuedaCompleta } from "./matrices.ts";

/** Las bandas, como las titula el original en estos listados. */
export const TITULO_BANDA: Record<Banda, string> = {
  "Menos de 4 mm": "hasta 4 mm",
  "mayor de 4 mm y hasta 6 mm": ">4 mm<6 mm",
  "mayor de 6 mm y hasta 8 mm": ">6 mm<8 mm",
  "mayor de 8 mm y hasta 10 mm": ">8 mm<10 mm",
  "mayor de 10 mm y hasta 12 mm": ">10 mm<12 mm",
  "mayor de 12 mm": ">12 mm",
};

export interface VehiculoFicha {
  id: string;
  matricula: string | null;
  numeroUnidad: string | null;
  base: string | null;
}

export interface FilaFicha {
  vehiculoId: string;
  numeroUnidad: string | null;
  matricula: string | null;
  base: string | null;
  /** Una celda por posición de la rejilla; `null` donde no se midió. */
  profundidades: Array<number | null>;
  /** La peor rueda del vehículo. `null` si no se midió ninguna. */
  peor: number | null;
  /** La banda de la peor rueda. `null` si no hay ninguna medida. */
  banda: Banda | null;
  /** La medida que más ruedas llevan en ese vehículo. */
  medida: string | null;
  /** La fecha de la revisión más reciente de las que aportan sus ruedas. */
  ultimaRevision: string | null;
  /** Columnas de papel: se rellenan a mano. */
  observaciones: "";
  pteReparar: "";
}

/** La medida que más se repite entre las ruedas, desempatando por nombre. */
function medidaPredominante(ruedas: RuedaCompleta[]): string | null {
  const cuenta = new Map<string, number>();
  for (const r of ruedas) cuenta.set(r.medida, (cuenta.get(r.medida) ?? 0) + 1);
  let mejor: string | null = null;
  let max = 0;
  for (const [m, n] of [...cuenta.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"))) {
    if (n > max) { max = n; mejor = m; }
  }
  return mejor;
}

/**
 * Una línea por vehículo, con sus ruedas del mes.
 *
 * `posiciones` se pasa entera para que todas las líneas tengan las mismas
 * columnas: un autobús de seis ruedas en un listado con octava columna tiene
 * que enseñar ese hueco, no correr los números a la izquierda.
 */
export function filaDeVehiculo(
  v: VehiculoFicha,
  ruedas: RuedaCompleta[],
  posiciones: number[],
): FilaFicha {
  const porPosicion = new Map(ruedas.map((r) => [r.posicion, r]));
  const profundidades = posiciones.map((p) => porPosicion.get(p)?.profundidadMm ?? null);

  const medidas = profundidades.filter((x): x is number => x != null);
  const peor = medidas.length === 0 ? null : Math.min(...medidas);

  const fechas = ruedas.map((r) => r.fecha).filter(Boolean).sort();
  return {
    vehiculoId: v.id,
    numeroUnidad: v.numeroUnidad,
    matricula: v.matricula,
    base: v.base,
    profundidades,
    peor,
    banda: bandaDe(peor),
    medida: ruedas.length === 0 ? null : medidaPredominante(ruedas),
    ultimaRevision: fechas.at(-1) ?? null,
    observaciones: "",
    pteReparar: "",
  };
}

/** Todas las líneas del mes, una por vehículo con alguna rueda revisada. */
export function filasDelMes(
  vehiculos: VehiculoFicha[],
  ruedas: RuedaCompleta[],
  posiciones: number[],
): FilaFicha[] {
  const porVehiculo = new Map<string, RuedaCompleta[]>();
  for (const r of ruedas) {
    const lista = porVehiculo.get(r.vehiculoId) ?? [];
    lista.push(r);
    porVehiculo.set(r.vehiculoId, lista);
  }
  return vehiculos
    .filter((v) => porVehiculo.has(v.id))
    .map((v) => filaDeVehiculo(v, porVehiculo.get(v.id)!, posiciones));
}

export interface Listado {
  banda: Banda;
  titulo: string;
  filas: FilaFicha[];
}

/**
 * Los seis listados, de peor a mejor.
 *
 * Las seis bandas salen siempre, incluso vacías: un listado de «hasta 4 mm»
 * que no aparece se lee como que no se ha mirado, y uno que aparece vacío
 * dice que no hay ninguno, que es una noticia distinta y buena.
 *
 * Dentro de cada banda, el peor primero: es el orden en que se baja al patio.
 * A igualdad, por número de unidad, para que dos ejecuciones den lo mismo.
 */
export function listadosPorBanda(filas: FilaFicha[]): Listado[] {
  return BANDAS.map((banda) => ({
    banda,
    titulo: TITULO_BANDA[banda],
    filas: filas
      .filter((f) => f.banda === banda)
      .sort((a, b) => (a.peor ?? 99) - (b.peor ?? 99)
        || String(a.numeroUnidad ?? "").localeCompare(String(b.numeroUnidad ?? ""), "es", { numeric: true })),
  }));
}

export interface Planificacion {
  /** El mes que se planifica, que es el SIGUIENTE al del informe. */
  mes: string;
  etiqueta: string;
  filas: FilaFicha[];
  /** Vehículos de la flota sin ninguna rueda revisada en el mes. */
  sinRevisar: number;
}

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

/**
 * La lista de planificación del mes siguiente.
 *
 * El original la titula «LISTA PLANIFICACION ENERO» en el informe de
 * diciembre: no es lo que se hizo, es a quién hay que mirar ahora, con las
 * profundidades de la última revisión delante para decidir el orden.
 *
 * Va ordenada por número de unidad y no por urgencia, igual que el original:
 * esta hoja se usa para buscar un autobús concreto, y los seis listados por
 * banda ya están ordenados por lo que corre.
 */
export function listaPlanificacion(
  filas: FilaFicha[],
  periodoDelInforme: Periodo,
  totalFlota: number,
): Planificacion {
  const [anyo, mes] = periodoDelInforme.mes.split("-").map(Number);
  const siguiente = new Date(Date.UTC(anyo, mes, 1));
  const m = siguiente.getUTCMonth();

  return {
    mes: `${siguiente.getUTCFullYear()}-${String(m + 1).padStart(2, "0")}`,
    etiqueta: `${MESES[m]} ${siguiente.getUTCFullYear()}`,
    filas: [...filas].sort((a, b) =>
      String(a.numeroUnidad ?? "").localeCompare(String(b.numeroUnidad ?? ""), "es", { numeric: true })),
    sinRevisar: Math.max(0, totalFlota - filas.length),
  };
}

/** Lo que estos listados tienen que decir de sí mismos. */
export function avisosDeListados(listados: Listado[], p: Planificacion): string[] {
  const avisos: string[] = [];

  const enListados = listados.reduce((a, l) => a + l.filas.length, 0);
  const sinBanda = p.filas.filter((f) => f.banda === null).length;
  if (sinBanda > 0) {
    avisos.push(
      `${sinBanda} vehículo(s) se revisaron sin apuntar ninguna profundidad, así que no `
      + "caen en ningún listado por banda. Sí salen en la lista de planificación.",
    );
  }

  if (p.sinRevisar > 0) {
    avisos.push(
      `${p.sinRevisar} vehículo(s) de la flota no tienen ninguna rueda revisada este mes: `
      + "no aparecen en ninguna de las dos listas, porque no hay nada que enseñar de ellos.",
    );
  }

  // La partición: los seis listados tienen que sumar los que sí tienen banda.
  const conBanda = p.filas.length - sinBanda;
  if (enListados !== conBanda) {
    avisos.push(
      `Descuadre: los seis listados suman ${enListados} vehículos y con banda hay `
      + `${conBanda}. Esto no debería pasar.`,
    );
  }

  return avisos;
}
