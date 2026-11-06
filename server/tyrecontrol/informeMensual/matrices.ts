/**
 * Las rejillas del informe mensual: marca, medida, condición y profundidad.
 *
 * Son siete tablas distintas del original y UNA sola forma: filas con
 * etiqueta, una columna por cada valor del eje, total y porcentaje. Se hace
 * con un constructor genérico (`matriz`) y siete accesos, en vez de siete
 * funciones que suman lo mismo de siete maneras parecidas.
 *
 * Como el resto del informe, no habla con la base: entran las ruedas del mes
 * —una por vehículo y posición, ya elegida en `armar.ts`— y salen las tablas.
 *
 * ── Qué se enseña cuando el dato no está ────────────────────────────────────
 *
 * El acuerdo es enseñar lo que hay. Eso NO es dejar una fila a cero sin más:
 * un cero en «RAYADAS» se lee como «no hay ninguna rayada», y lo que pasa es
 * que nadie las apunta. Por eso cada rejilla de condición dice además de
 * cuántas ruedas NO se sabe, y el informe lo enseña al lado del cero.
 *
 *   · RAYADA        `estado_visual` de la medición. En Plana está relleno en
 *                   8 filas de 66.856: la tablet no lo pide.
 *   · REESCULTURADA `tc_neumaticos.reesculturado`. 16 de 6.541.
 *   · RECAUCHUTADA  la condición del último montaje con condición conocida.
 *                   Para Plana son 0, con 4.460 neumáticos sin ninguna.
 *
 * ── Las medidas se agrupan canónicas y se enseñan como están ────────────────
 *
 * `295/80R22.5` y `295/80R22,5` son la misma medida escrita de dos maneras, y
 * si se agruparan por el texto crudo saldrían dos filas con la mitad cada una.
 * Se agrupa por `baseMedida`, que ya es el criterio del resto del proyecto, y
 * se enseña esa forma canónica: el original escribe la coma porque viene de un
 * Excel español, y aquí inventar una segunda notación solo para parecerse
 * sería crear el problema que `baseMedida` existe para evitar.
 */

import { baseMedida } from "../../../shared/medidas.ts";
import type { RuedaDelMes } from "./armar.ts";

// ── Lo que se sabe de cada rueda, más allá de su profundidad ───────────────

export interface NeumaticoRef {
  id: string;
  marca: string | null;
  modelo: string | null;
  medida: string | null;
  reesculturado: boolean;
}

/** Una rueda del mes con lo que se sabe del neumático que llevaba puesto. */
export interface RuedaCompleta extends RuedaDelMes {
  marca: string;
  modelo: string | null;
  medida: string;
  reesculturada: boolean;
  recauchutada: boolean;
  rayada: boolean;
  /** `false` cuando no consta ninguna condición de montaje para ese neumático. */
  condicionConocida: boolean;
}

/** Lo que se pone donde no hay dato, en vez de dejar la celda muda. */
export const SIN_DATO = "(sin dato)";

/**
 * La marca, en mayúsculas, para agrupar y para enseñar.
 *
 * En la base conviven `Hankook` y `HANKOOK`: sin esto saldrían dos filas con
 * la mitad del recuento cada una, que es el fallo clásico de una tabla
 * agrupada por texto libre. El original las escribe todas en mayúsculas, así
 * que agrupar y enseñar coinciden.
 *
 * Lo que NO hace es unificar marcas distintas que son la misma —en Plana hay
 * `Insa` y `INSATURBO`, que seguramente sean INSA TURBO—. Eso es una decisión
 * sobre el catálogo de neumáticos, no sobre cómo se cuenta un informe, y
 * tomarla aquí la escondería donde nadie la va a buscar.
 */
export function normalizarMarca(marca: string | null | undefined): string {
  const m = String(marca ?? "").trim().toUpperCase();
  return m || SIN_DATO;
}

/**
 * Junta cada rueda con su neumático.
 *
 * Una rueda cuyo neumático no se encuentra NO se tira: sigue siendo una rueda
 * que alguien midió, y tirarla descuadraría el total contra los recuentos de
 * la cabecera. Se queda con marca y medida «(sin dato)», que es verdad.
 */
/**
 * Qué estado visual cuenta como «rayada».
 *
 * El original llama RAYADA a la goma con un corte o un daño en el flanco. En
 * TyreControl eso se apunta en `estado_visual` de la medición, y los valores
 * que hay son `correcto`, `desgaste_irregular` y `dano_lateral`.
 *
 * Solo cuenta el daño. `desgaste_irregular` es otra cosa —la goma se come por
 * un lado, normalmente por geometría o presión— y meterla aquí inflaría la
 * fila con un problema que no es el que esa fila nombra.
 */
export function esRayada(estadoVisual: string | null | undefined): boolean {
  const e = String(estadoVisual ?? "").toLowerCase();
  return e.includes("dano") || e.includes("daño") || e.includes("corte") || e.includes("raya");
}

export function completar(
  ruedas: RuedaDelMes[],
  neumaticos: Map<string, NeumaticoRef>,
  condicionPorNeumatico: Map<string, string>,
): RuedaCompleta[] {
  return ruedas.map((r) => {
    const n = r.neumaticoId ? neumaticos.get(r.neumaticoId) : undefined;
    const cond = r.neumaticoId ? condicionPorNeumatico.get(r.neumaticoId) : undefined;
    const medida = baseMedida(n?.medida ?? "");
    return {
      ...r,
      marca: normalizarMarca(n?.marca),
      modelo: n?.modelo ?? null,
      medida: medida || SIN_DATO,
      reesculturada: n?.reesculturado === true,
      recauchutada: cond === "recauchutada",
      rayada: esRayada(r.estadoVisual),
      condicionConocida: cond != null,
    };
  });
}

// ── El constructor genérico ────────────────────────────────────────────────

export interface FilaMatriz {
  etiqueta: string;
  /** Una celda por columna, en el orden de `columnas`. */
  celdas: number[];
  total: number;
  /** Sobre el total de la matriz, con dos decimales. */
  pct: number;
}

export interface Matriz {
  columnas: string[];
  filas: FilaMatriz[];
  totalPorColumna: number[];
  total: number;
}

const pct = (parte: number, total: number): number =>
  total === 0 ? 0 : Math.round((parte / total) * 10000) / 100;

/**
 * Cuenta items en una rejilla de filas × columnas.
 *
 * `columnas` se pasa entera y no se deduce de los datos: una columna vacía es
 * información —esa posición no se midió— y deducirla la haría desaparecer,
 * descolocando todas las de su derecha respecto al resto de tablas.
 *
 * Las filas, al revés: salen de los datos, porque el original tampoco enseña
 * las marcas que no tiene. Van ordenadas por total descendente, como el
 * original, y a igualdad por etiqueta para que dos ejecuciones den lo mismo.
 */
export function matriz<T>(
  items: T[],
  filaDe: (x: T) => string | null,
  columnaDe: (x: T) => string | null,
  columnas: string[],
  ordenFilas?: string[],
): Matriz {
  const indice = new Map(columnas.map((c, i) => [c, i]));
  const filas = new Map<string, number[]>();

  for (const x of items) {
    const f = filaDe(x);
    const c = columnaDe(x);
    if (f == null || c == null) continue;
    const j = indice.get(c);
    if (j === undefined) continue;
    let celdas = filas.get(f);
    if (!celdas) { celdas = new Array(columnas.length).fill(0); filas.set(f, celdas); }
    celdas[j] += 1;
  }

  const sumadas = [...filas.entries()].map(([etiqueta, celdas]) => ({
    etiqueta, celdas, total: celdas.reduce((a, b) => a + b, 0), pct: 0,
  }));

  if (ordenFilas) {
    // Orden fijo: las bandas de profundidad van de menos a más, siempre, y
    // una banda sin ninguna rueda tiene que seguir saliendo en su sitio.
    const pos = new Map(ordenFilas.map((e, i) => [e, i]));
    for (const e of ordenFilas) {
      if (!filas.has(e)) sumadas.push({ etiqueta: e, celdas: new Array(columnas.length).fill(0), total: 0, pct: 0 });
    }
    sumadas.sort((a, b) => (pos.get(a.etiqueta) ?? 999) - (pos.get(b.etiqueta) ?? 999));
  } else {
    sumadas.sort((a, b) => b.total - a.total || a.etiqueta.localeCompare(b.etiqueta, "es"));
  }

  const total = sumadas.reduce((a, f) => a + f.total, 0);
  for (const f of sumadas) f.pct = pct(f.total, total);

  const totalPorColumna = columnas.map((_, j) => sumadas.reduce((a, f) => a + f.celdas[j], 0));
  return { columnas, filas: sumadas, totalPorColumna, total };
}

// ── Las bandas de profundidad ──────────────────────────────────────────────

/**
 * Las seis bandas del original, con sus mismos cortes y sus mismos nombres.
 *
 * Son también los seis «niveles de desgaste» de las gráficas de evolución:
 * nivel 1 es «menos de 4 mm — cambiar» y nivel 6 es «mayor de 12 mm». Dos
 * nombres para lo mismo, así que una sola lista.
 *
 * Los cortes son `>` a la izquierda y `<=` a la derecha: 4,0 mm cae en «menos
 * de 4 mm» y 4,1 en la siguiente. Es como está escrito en el original
 * —«mayor de 4 mm y hasta 6 mm»— y es lo que hace que un neumático justo en
 * el límite legal salga en la banda que obliga a cambiarlo.
 */
export const BANDAS = [
  "Menos de 4 mm",
  "mayor de 4 mm y hasta 6 mm",
  "mayor de 6 mm y hasta 8 mm",
  "mayor de 8 mm y hasta 10 mm",
  "mayor de 10 mm y hasta 12 mm",
  "mayor de 12 mm",
] as const;

export type Banda = (typeof BANDAS)[number];

/** En qué banda cae una profundidad. `null` si no se midió. */
export function bandaDe(mm: number | null | undefined): Banda | null {
  if (mm == null || !Number.isFinite(mm)) return null;
  if (mm <= 4) return BANDAS[0];
  if (mm <= 6) return BANDAS[1];
  if (mm <= 8) return BANDAS[2];
  if (mm <= 10) return BANDAS[3];
  if (mm <= 12) return BANDAS[4];
  return BANDAS[5];
}

/**
 * La llanta de una medida, para agrupar como el original: 22,5" / 17,5"-19,5"
 * / 16". Sale del número que va detrás de la R.
 */
export function llantaDe(medida: string): string {
  const m = /R(\d{1,2}(?:\.\d)?)/.exec(medida);
  if (!m) return "Otras";
  const pulgadas = Number(m[1]);
  if (pulgadas >= 22) return 'Llanta 22,5"';
  if (pulgadas >= 17) return 'Llanta 17,5"-19,5"';
  if (pulgadas >= 15) return 'Llanta 16"';
  return "Otras";
}

/**
 * Los milímetros enteros que el original usa como columnas, de 17 a 2.
 *
 * Se redondea hacia ABAJO: un neumático de 8,7 mm va a la columna de 8. Es lo
 * que hace el original —sus columnas son enteras y sus medidas no— y es la
 * dirección prudente: redondeando hacia arriba, una goma de 3,9 mm aparecería
 * en la columna de 4, que es justo el límite legal.
 */
export function milimetroDe(mm: number | null | undefined): string | null {
  if (mm == null || !Number.isFinite(mm)) return null;
  const entero = Math.floor(mm);
  if (entero < 2 || entero > 17) return null;
  return `${entero}mm`;
}

export const COLUMNAS_MM = Array.from({ length: 16 }, (_, i) => `${17 - i}mm`);

// ── Las siete rejillas ─────────────────────────────────────────────────────

const columnasDePosicion = (posiciones: number[]): string[] =>
  posiciones.map((p) => `Posicion ${p}`);
const posicionDe = (r: RuedaCompleta): string => `Posicion ${r.posicion}`;

export function marcaPorPosicion(ruedas: RuedaCompleta[], posiciones: number[]): Matriz {
  return matriz(ruedas, (r) => r.marca, posicionDe, columnasDePosicion(posiciones));
}

export function medidaPorPosicion(ruedas: RuedaCompleta[], posiciones: number[]): Matriz {
  return matriz(ruedas, (r) => r.medida, posicionDe, columnasDePosicion(posiciones));
}

export function profundidadPorPosicion(ruedas: RuedaCompleta[], posiciones: number[]): Matriz {
  return matriz(ruedas, (r) => bandaDe(r.profundidadMm), posicionDe,
                columnasDePosicion(posiciones), [...BANDAS]);
}

export const CONDICIONES = ["RAYADAS", "RECAUCHUTADAS", "REESCULTURADAS"] as const;

/**
 * Las tres condiciones por posición.
 *
 * Una rueda puede ser varias cosas a la vez —recauchutada y rayada—, así que
 * no es una matriz de clasificación como las otras: cada rueda puede sumar en
 * más de una fila. Por eso se arma a mano y su `total` NO es el número de
 * ruedas, sino el de marcas puestas. Mezclarlo con las demás sería invitar a
 * sumar columnas que no se pueden sumar.
 */
export function condicionPorPosicion(ruedas: RuedaCompleta[], posiciones: number[]): Matriz {
  const columnas = columnasDePosicion(posiciones);
  const marcadas: Array<{ cond: string; pos: string }> = [];
  for (const r of ruedas) {
    const pos = posicionDe(r);
    if (r.rayada) marcadas.push({ cond: "RAYADAS", pos });
    if (r.recauchutada) marcadas.push({ cond: "RECAUCHUTADAS", pos });
    if (r.reesculturada) marcadas.push({ cond: "REESCULTURADAS", pos });
  }
  return matriz(marcadas, (x) => x.cond, (x) => x.pos, columnas, [...CONDICIONES]);
}

/** Medida × milímetro, que es la tabla grande de la segunda página. */
export function medidaPorMilimetro(ruedas: RuedaCompleta[]): Matriz {
  return matriz(ruedas, (r) => r.medida, (r) => milimetroDe(r.profundidadMm), COLUMNAS_MM);
}

/** Medida × marca, la matriz de doble entrada de la página 8. */
export function medidaPorMarca(ruedas: RuedaCompleta[], marcas?: string[]): Matriz {
  const columnas = marcas ?? [...new Set(ruedas.map((r) => r.marca))]
    .sort((a, b) => a.localeCompare(b, "es"));
  return matriz(ruedas, (r) => r.medida, (r) => r.marca, columnas);
}

/**
 * Lo que el informe tiene que decir de las rejillas de condición.
 *
 * Sin esto, tres filas a cero se leen como «esta flota no tiene ni una goma
 * rayada ni recauchutada», que no es lo que pasa.
 */
export function avisosDeCondicion(ruedas: RuedaCompleta[]): string[] {
  const avisos: string[] = [];
  const total = ruedas.length;
  if (total === 0) return avisos;

  const sinCondicion = ruedas.filter((r) => !r.condicionConocida).length;
  if (sinCondicion > 0) {
    avisos.push(
      `De ${sinCondicion} de las ${total} ruedas no consta si la goma es nueva, usada o `
      + "recauchutada: no hay ninguna operación de montaje con esa condición registrada. "
      + "La fila RECAUCHUTADAS cuenta solo las que sí constan.",
    );
  }

  if (!ruedas.some((r) => r.rayada)) {
    avisos.push(
      "Ninguna rueda consta como rayada. El dato se guarda en el estado visual de la "
      + "medición y la tablet no lo pide, así que el cero significa «no se apunta», no "
      + "«no hay».",
    );
  }

  const sinMarca = ruedas.filter((r) => r.marca === SIN_DATO).length;
  if (sinMarca > 0) {
    avisos.push(`${sinMarca} rueda(s) no tienen neumático identificado: salen como «${SIN_DATO}».`);
  }

  // La rejilla de milímetros va de 17 a 2: lo que se sale no tiene columna.
  const fueraDeRejilla = ruedas.filter(
    (r) => r.profundidadMm != null && milimetroDe(r.profundidadMm) == null,
  ).length;
  if (fueraDeRejilla > 0) {
    avisos.push(
      `${fueraDeRejilla} rueda(s) tienen una profundidad fuera de la rejilla de 17 a 2 mm: `
      + "cuentan en las bandas pero no en la tabla de medida por milímetro.",
    );
  }

  const sinProfundidad = ruedas.filter((r) => r.profundidadMm == null).length;
  if (sinProfundidad > 0) {
    avisos.push(
      `${sinProfundidad} rueda(s) se revisaron sin apuntar la profundidad: cuentan como `
      + "revisadas pero no caen en ninguna banda.",
    );
  }

  return avisos;
}
