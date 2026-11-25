/**
 * Km de TODA la flota por meses y por años: la parte pura, con pruebas.
 *
 * ── Qué cuenta como «auténtico» ─────────────────────────────────────────────
 *
 * Un (vehículo, mes) suma en el total solo si:
 *   · el proveedor dio una distancia (`sync_status = ok`),
 *   · el mes está CERRADO: se pidió después de acabar, no a mitad,
 *   · y es creíble a la luz de su odómetro (`distanciaCreible`, la misma regla
 *     del conector y de «Revisar coherencia»: no más del doble de lo que
 *     avanzó; sin odómetro que avance no se juzga).
 *   · y el vehículo está activo en la empresa.
 *
 * Lo demás NO se suma pero se enseña aparte, para que se vea qué se queda
 * fuera y por qué: provisional (ok sin cerrar), descartado (incoherente) y sin
 * dato (error o vacío del proveedor).
 *
 * Si un vehículo tiene el mismo mes en dos cuentas, vale la mejor fila (ok y
 * cerrada antes que ok abierta, y esta antes que el resto): sumar las dos
 * contaría dos veces el mismo autobús.
 */

import { distanciaCreible } from "../../integration-hub/connectors/telematics/movertis/mapeo.ts";
import type { Mes } from "../../integration-hub/domain/meses.ts";

export interface FilaMes {
  mobilink_id: string;
  system: string;
  account_key: string;
  year: number;
  month: number;
  distance_km: number | null;
  initial_odometer_km: number | null;
  final_odometer_km: number | null;
  sync_status: "ok" | "empty" | "error";
  closed: boolean;
}

export type EstadoMes = "cerrado" | "incompleto" | "en_curso";

export interface MesDeFlota {
  year: number;
  month: number;
  kmAutenticos: number;
  vehiculosAutenticos: number;
  kmProvisionales: number;
  vehiculosProvisionales: number;
  descartados: number;
  kmDescartados: number;
  sinDato: number;
  estado: EstadoMes;
  /** Cuentas con vehículos sin cerrar ese mes: a quién volver a pedírselo. */
  cuentasSinCerrar: Array<{ connectorKey: string; accountKey: string }>;
}

export interface AnoDeFlota {
  year: number;
  kmAutenticos: number;
  mesesCerrados: number;
  /** Media de los meses cerrados (sin el en curso ni los incompletos). */
  mediaMensual: number | null;
  kmProvisionales: number;
}

export interface ResumenFlota {
  meses: MesDeFlota[];
  anos: AnoDeFlota[];
}

const rango = (f: FilaMes) =>
  f.sync_status === "ok" && f.distance_km != null ? (f.closed ? 3 : 2) : f.sync_status === "empty" ? 1 : 0;

const creible = (f: FilaMes) =>
  distanciaCreible(Number(f.distance_km), num(f.initial_odometer_km), num(f.final_odometer_km));

const num = (v: number | null) => (v == null ? undefined : Number(v));

export function resumenDeFlota(filas: FilaMes[], flota: Set<string>, actual: Mes): ResumenFlota {
  // La mejor fila por (vehículo, mes).
  const mejor = new Map<string, FilaMes>();
  for (const f of filas) {
    if (!flota.has(f.mobilink_id)) continue;
    const k = `${f.mobilink_id}|${f.year}|${f.month}`;
    const otra = mejor.get(k);
    if (!otra || rango(f) > rango(otra)
      || (rango(f) === rango(otra) && Number(f.distance_km ?? 0) > Number(otra.distance_km ?? 0))) {
      mejor.set(k, f);
    }
  }

  const porMes = new Map<string, MesDeFlota & { _cuentas: Map<string, { connectorKey: string; accountKey: string }> }>();
  for (const f of mejor.values()) {
    const k = `${f.year}-${f.month}`;
    let m = porMes.get(k);
    if (!m) {
      m = {
        year: f.year, month: f.month, kmAutenticos: 0, vehiculosAutenticos: 0, kmProvisionales: 0,
        vehiculosProvisionales: 0, descartados: 0, kmDescartados: 0, sinDato: 0, estado: "cerrado",
        cuentasSinCerrar: [], _cuentas: new Map(),
      };
      porMes.set(k, m);
    }
    const km = Number(f.distance_km ?? 0);
    if (f.sync_status !== "ok" || f.distance_km == null) {
      m.sinDato += 1;
    } else if (!creible(f)) {
      m.descartados += 1;
      m.kmDescartados += km;
    } else if (f.closed) {
      m.vehiculosAutenticos += 1;
      m.kmAutenticos += km;
    } else {
      m.vehiculosProvisionales += 1;
      m.kmProvisionales += km;
    }
    if (!f.closed) m._cuentas.set(`${f.system}|${f.account_key}`, { connectorKey: f.system, accountKey: f.account_key });
  }

  const meses: MesDeFlota[] = [...porMes.values()]
    .map(({ _cuentas, ...m }) => {
      const enCurso = m.year === actual.year && m.month === actual.month;
      const futuro = m.year > actual.year || (m.year === actual.year && m.month > actual.month);
      const estado: EstadoMes = enCurso || futuro ? "en_curso" : m.vehiculosProvisionales > 0 ? "incompleto" : "cerrado";
      return {
        ...m,
        kmAutenticos: Math.round(m.kmAutenticos),
        kmProvisionales: Math.round(m.kmProvisionales),
        kmDescartados: Math.round(m.kmDescartados),
        estado,
        cuentasSinCerrar: estado === "incompleto" ? [..._cuentas.values()] : [],
      };
    })
    .sort((a, b) => a.year - b.year || a.month - b.month);

  const anos = new Map<number, AnoDeFlota & { _sumaCerrados: number }>();
  for (const m of meses) {
    let a = anos.get(m.year);
    if (!a) {
      a = { year: m.year, kmAutenticos: 0, mesesCerrados: 0, mediaMensual: null, kmProvisionales: 0, _sumaCerrados: 0 };
      anos.set(m.year, a);
    }
    a.kmAutenticos += m.kmAutenticos;
    a.kmProvisionales += m.kmProvisionales;
    if (m.estado === "cerrado") { a.mesesCerrados += 1; a._sumaCerrados += m.kmAutenticos; }
  }

  return {
    meses,
    anos: [...anos.values()]
      .map(({ _sumaCerrados, ...a }) => ({ ...a, mediaMensual: a.mesesCerrados ? Math.round(_sumaCerrados / a.mesesCerrados) : null }))
      .sort((a, b) => a.year - b.year),
  };
}
