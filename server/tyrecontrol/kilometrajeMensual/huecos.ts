/**
 * Qué meses le faltan a UN vehículo.
 *
 * En el ranking, la columna «Huecos» dice cosas como «3 con error · Ene, May,
 * Sept 2026». Saber cuáles son no sirve de nada si para rehacerlos hay que
 * lanzar un relleno de la flota entera o pedir a mano un rango que incluye
 * nueve meses que ya están bien: lo primero tarda horas y gasta cupo del
 * proveedor en vehículos que no lo necesitan, y lo segundo es un rango
 * contiguo cuando los huecos van salteados.
 *
 * Esto resuelve los huecos de un vehículo y nada más. Tres clases, y las tres
 * son «falta», aunque no sean lo mismo:
 *
 *   · `error`  — el proveedor contestó con un fallo. Casi siempre se arregla
 *                volviendo a pedirlo.
 *   · `empty`  — contestó que no tenía datos. Puede volver a no tenerlos; se
 *                pide igual porque a veces es que el equipo estaba apagado
 *                ese día y después se sincronizó.
 *   · ausente  — no hay ni fila. Un mes que nunca se pidió.
 *
 * ── La ventana, y por qué empieza en el vehículo y no en la flota ───────────
 *
 * Se mira desde el primer mes que ese vehículo tiene guardado hasta el último
 * mes cerrado. Si se empezara en el primer mes de la FLOTA, a un autobús que
 * entró en junio se le pedirían enero a mayo, que es cupo gastado en meses en
 * los que no existía para el proveedor, y la respuesta sería `empty` para
 * siempre.
 *
 * El mes EN CURSO queda fuera: está a medias y volver a pedirlo cada vez no
 * lo completa, solo gasta.
 */

import type { MonthlyMileageRow } from "../../integration-hub/infrastructure/repositories.ts";
import { compararMeses, type Mes } from "../../integration-hub/domain/meses.ts";

/** Por qué falta un mes. Se devuelve para poder decirlo, no solo contarlo. */
export type ClaseHueco = "error" | "sin_dato" | "ausente";

export interface Hueco extends Mes {
  clase: ClaseHueco;
  /** Lo que contestó el proveedor, cuando lo dijo. */
  error?: string | null;
}

export interface OpcionesHuecos {
  /** El mes en curso y posteriores nunca entran. */
  mesActual: Mes;
  /** `empty` también cuenta como hueco. Por defecto sí. */
  incluirSinDato?: boolean;
  /** Tope: más que esto es un relleno, no un botón. */
  maximo?: number;
}

const siguiente = (m: Mes): Mes => (m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 });

/**
 * Los meses que le faltan a un vehículo, del más viejo al más nuevo.
 *
 * Entran las filas de UN vehículo; si vienen de varios, el resultado no
 * significa nada, así que quien llama filtra antes.
 */
export function mesesQueFaltan(filas: MonthlyMileageRow[], op: OpcionesHuecos): Hueco[] {
  if (filas.length === 0) return [];
  const incluirSinDato = op.incluirSinDato !== false;

  const porMes = new Map<string, MonthlyMileageRow>();
  let primero: Mes | null = null;
  for (const f of filas) {
    const m: Mes = { year: f.year, month: f.month };
    porMes.set(`${f.year}-${f.month}`, f);
    if (!primero || compararMeses(m, primero) < 0) primero = m;
  }
  if (!primero) return [];

  // El último mes que se puede pedir entero es el anterior al actual.
  const ultimo: Mes = op.mesActual.month === 1
    ? { year: op.mesActual.year - 1, month: 12 }
    : { year: op.mesActual.year, month: op.mesActual.month - 1 };
  if (compararMeses(primero, ultimo) > 0) return [];

  const huecos: Hueco[] = [];
  for (let m = primero; compararMeses(m, ultimo) <= 0; m = siguiente(m)) {
    const fila = porMes.get(`${m.year}-${m.month}`);
    if (!fila) {
      huecos.push({ ...m, clase: "ausente" });
    } else if (fila.sync_status === "error") {
      huecos.push({ ...m, clase: "error", error: fila.last_error });
    } else if (fila.sync_status === "empty" && incluirSinDato) {
      huecos.push({ ...m, clase: "sin_dato" });
    }
  }

  // El tope corta por el FINAL, dejando los más viejos: son los que llevan
  // más tiempo sin arreglarse, y los recientes volverán a salir mañana.
  const maximo = op.maximo ?? Infinity;
  return huecos.slice(0, maximo);
}

/**
 * De qué proveedor y cuenta es este vehículo, según sus propias filas.
 *
 * No se le pide al usuario: el vehículo ya lo dice. Si tiene filas de dos
 * cuentas —se cambió de proveedor— manda la de la fila MÁS RECIENTE, que es
 * la que contestará hoy.
 */
export function proveedorDe(filas: MonthlyMileageRow[]): { system: string; accountKey: string } | null {
  let mejor: MonthlyMileageRow | null = null;
  for (const f of filas) {
    if (!f.system || !f.account_key) continue;
    if (!mejor || compararMeses({ year: f.year, month: f.month }, { year: mejor.year, month: mejor.month }) > 0) {
      mejor = f;
    }
  }
  return mejor ? { system: mejor.system, accountKey: mejor.account_key } : null;
}

/** Cuántos hay de cada clase, para decirlo en la respuesta. */
export function contarPorClase(huecos: Hueco[]): Record<ClaseHueco, number> {
  const r: Record<ClaseHueco, number> = { error: 0, sin_dato: 0, ausente: 0 };
  for (const h of huecos) r[h.clase] += 1;
  return r;
}
