/** Juntar las filas diarias de `tc_recorrido_tipo_via` para las pantallas. Puro. */

import { TIPOS, type TipoVia } from "./clasificar.ts";

export interface FilaGuardada { vehiculo_id: string; fecha: string; tipo: TipoVia; ref: string; km: number | string; segundos: number }
export interface Suma { km: number; segundos: number }
export type PorTipo = Record<TipoVia, Suma>;

const cero = (): PorTipo => Object.fromEntries(TIPOS.map((t) => [t, { km: 0, segundos: 0 }])) as PorTipo;
const r1 = (x: number) => Math.round(x * 10) / 10;

function redondear(p: PorTipo): PorTipo {
  return Object.fromEntries(TIPOS.map((t) => [t, { km: r1(p[t].km), segundos: Math.round(p[t].segundos) }])) as PorTipo;
}

/** Para la ficha: por mes, total, y las carreteras más usadas. */
export function resumenVehiculo(filas: FilaGuardada[], topCarreteras = 12) {
  const meses = new Map<string, PorTipo>();
  const total = cero();
  const carreteras = new Map<string, { tipo: TipoVia; ref: string; km: number; segundos: number }>();
  for (const f of filas) {
    const km = Number(f.km) || 0;
    const mes = f.fecha.slice(0, 7);
    const m = meses.get(mes) ?? cero();
    m[f.tipo].km += km; m[f.tipo].segundos += f.segundos;
    meses.set(mes, m);
    total[f.tipo].km += km; total[f.tipo].segundos += f.segundos;
    if (f.ref) {
      const c = carreteras.get(f.ref) ?? { tipo: f.tipo, ref: f.ref, km: 0, segundos: 0 };
      c.km += km; c.segundos += f.segundos;
      carreteras.set(f.ref, c);
    }
  }
  return {
    meses: [...meses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, p]) => ({ mes, porTipo: redondear(p) })),
    total: redondear(total),
    carreteras: [...carreteras.values()].sort((a, b) => b.km - a.km).slice(0, topCarreteras)
      .map((c) => ({ ...c, km: r1(c.km), segundos: Math.round(c.segundos) })),
  };
}

/** Para el informe de flota: por vehículo, el reparto por tipo. */
export function resumenFlota(filas: FilaGuardada[]) {
  const por = new Map<string, PorTipo>();
  const dias = new Map<string, Set<string>>();
  for (const f of filas) {
    const p = por.get(f.vehiculo_id) ?? cero();
    p[f.tipo].km += Number(f.km) || 0; p[f.tipo].segundos += f.segundos;
    por.set(f.vehiculo_id, p);
    const d = dias.get(f.vehiculo_id) ?? new Set<string>();
    d.add(f.fecha);
    dias.set(f.vehiculo_id, d);
  }
  return [...por.entries()].map(([vehiculoId, p]) => {
    const km = TIPOS.reduce((s, t) => s + p[t].km, 0);
    const conVia = km - p.sin_via.km;
    return {
      vehiculoId, dias: dias.get(vehiculoId)?.size ?? 0, km: r1(km), porTipo: redondear(p),
      pctUrbana: conVia > 0 ? Math.round((p.urbana.km / conVia) * 1000) / 10 : null,
    };
  });
}
