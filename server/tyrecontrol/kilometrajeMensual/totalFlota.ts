/**
 * Cuántos kilómetros ha hecho TODA la flota entre dos meses.
 *
 * ── Por qué el filtro es por MESES y no por días ────────────────────────────
 *
 * Porque el dato es mensual. El proveedor da un total por vehículo y mes
 * natural, no un recorrido día a día, así que «del 15 de marzo al 20 de
 * junio» no se puede responder: habría que repartir marzo y junio a ojo. La
 * pantalla pide meses y dice que son meses, en vez de ofrecer un calendario
 * y redondear por dentro sin avisar.
 *
 * ── Un mes «vacío» NO es un cero ────────────────────────────────────────────
 *
 * Es la misma regla que el ranking y la ficha, y conviene no perderla:
 *
 *   · `ok`    · el proveedor contestó. Su distancia cuenta, incluido un cero
 *               de verdad: un autobús parado un mes hizo cero kilómetros.
 *   · `empty` · contestó que no hay viajes de ese vehículo ese mes. Suele ser
 *               un equipo apagado o sin enlazar, no un autobús parado.
 *   · `error` · no contestó. No se sabe nada.
 *
 * Sumar los dos últimos como cero daría un total más bajo que el real y, lo
 * que es peor, lo daría sin decirlo. Aquí se suman solo los `ok` y se cuenta
 * aparte lo que falta, para poder decir «faltan 310 meses» en vez de dar un
 * número y callar.
 *
 * ── La estimación de lo que falta es una ESTIMACIÓN ─────────────────────────
 *
 * Se calcula qué habrían recorrido los meses sin dato si hubieran rodado como
 * la media de los que sí lo tienen. Sirve para saber si el hueco son cuatro
 * kilómetros o un millón. Va en su propio campo y nunca sumada al total: el
 * total es lo medido, no lo medido más lo supuesto.
 */

import type { MonthlyMileageRow } from "../../integration-hub/infrastructure/repositories.ts";

export interface RangoMeses {
  /** Inclusive. */
  desde: { year: number; month: number };
  /** Inclusive. */
  hasta: { year: number; month: number };
}

export interface MesDeFlota {
  year: number;
  month: number;
  km: number;
  /** Vehículos con dato bueno ese mes. */
  vehiculos: number;
  conError: number;
  vacios: number;
}

export interface VehiculoDelTotal {
  vehiculoId: string;
  km: number;
  /** Meses con dato bueno dentro del rango. */
  meses: number;
}

export interface TotalFlota {
  rango: RangoMeses;
  /** Lo MEDIDO. Nunca incluye estimaciones. */
  km: number;
  mesesDelRango: number;
  vehiculosConDato: number;
  filasOk: number;
  filasConError: number;
  filasVacias: number;
  /** Media de un vehículo en un mes, sobre los meses con dato. */
  mediaVehiculoMes: number | null;
  /**
   * Lo que habrían recorrido los meses sin dato al ritmo de los que sí lo
   * tienen. Es una estimación y va aparte del total a propósito.
   */
  kmEstimadosEnHuecos: number | null;
  porMes: MesDeFlota[];
  porVehiculo: VehiculoDelTotal[];
}

/** Un mes como número comparable: 2026-03 → 24315. */
const indice = (year: number, month: number): number => year * 12 + (month - 1);

/** ¿Cae este mes dentro del rango, con los dos extremos incluidos? */
export function dentroDelRango(year: number, month: number, r: RangoMeses): boolean {
  const i = indice(year, month);
  return i >= indice(r.desde.year, r.desde.month) && i <= indice(r.hasta.year, r.hasta.month);
}

/** Cuántos meses hay en el rango, los dos extremos incluidos. */
export function mesesDelRango(r: RangoMeses): number {
  return indice(r.hasta.year, r.hasta.month) - indice(r.desde.year, r.desde.month) + 1;
}

/**
 * El rango al derecho.
 *
 * Si alguien pide «de enero de 2026 a septiembre de 2025» no se devuelve
 * vacío ni se falla: se entiende que escribió los extremos al revés y se dan
 * la vuelta. Es lo que haría cualquiera al leerlo.
 */
export function ordenarRango(r: RangoMeses): RangoMeses {
  return indice(r.desde.year, r.desde.month) <= indice(r.hasta.year, r.hasta.month)
    ? r
    : { desde: r.hasta, hasta: r.desde };
}

export function totalDeFlota(filas: MonthlyMileageRow[], rangoPedido: RangoMeses): TotalFlota {
  const rango = ordenarRango(rangoPedido);
  const dentro = filas.filter((f) => dentroDelRango(f.year, f.month, rango));

  const porMes = new Map<string, MesDeFlota>();
  const porVehiculo = new Map<string, VehiculoDelTotal>();
  let km = 0, filasOk = 0, filasConError = 0, filasVacias = 0;

  for (const f of dentro) {
    const clave = `${f.year}-${String(f.month).padStart(2, "0")}`;
    const m = porMes.get(clave)
      ?? { year: f.year, month: f.month, km: 0, vehiculos: 0, conError: 0, vacios: 0 };

    if (f.sync_status === "error") { filasConError += 1; m.conError += 1; }
    else if (f.sync_status === "empty") { filasVacias += 1; m.vacios += 1; }
    else {
      filasOk += 1;
      const d = Number(f.distance_km ?? 0);
      km += d;
      m.km += d;
      m.vehiculos += 1;
      const v = porVehiculo.get(f.mobilink_id)
        ?? { vehiculoId: f.mobilink_id, km: 0, meses: 0 };
      v.km += d;
      v.meses += 1;
      porVehiculo.set(f.mobilink_id, v);
    }
    porMes.set(clave, m);
  }

  const mediaVehiculoMes = filasOk > 0 ? km / filasOk : null;
  const huecos = filasConError + filasVacias;

  return {
    rango,
    km,
    mesesDelRango: mesesDelRango(rango),
    vehiculosConDato: porVehiculo.size,
    filasOk,
    filasConError,
    filasVacias,
    mediaVehiculoMes,
    kmEstimadosEnHuecos: mediaVehiculoMes != null && huecos > 0
      ? mediaVehiculoMes * huecos
      : null,
    porMes: [...porMes.values()].sort((a, b) => indice(a.year, a.month) - indice(b.year, b.month)),
    porVehiculo: [...porVehiculo.values()].sort((a, b) => b.km - a.km),
  };
}
