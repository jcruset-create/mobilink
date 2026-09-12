/**
 * Del histórico guardado a lo que enseña la ficha: año en curso y media.
 *
 * Pura y sin red: se calcula aquí, no en Movertis, y no en el navegador. Un
 * solo sitio para que el «año actual» de la ficha y el de un informe sean el
 * mismo número.
 *
 * ── Qué entra en la media ───────────────────────────────────────────────────
 *
 * Solo meses COMPLETOS con dato: el mes en curso va a medias y bajaría la
 * media sin decir por qué, y un mes «sin datos» no es un mes a cero. Se toman
 * como mucho los doce últimos completos. La respuesta dice cuántos meses hay
 * detrás de la media, para que 7.603 km sobre dos meses no parezca lo mismo
 * que sobre doce.
 */

import type { MonthlyMileageRow } from "../../integration-hub/infrastructure/repositories.ts";
import { compararMeses, type Mes } from "../../integration-hub/domain/meses.ts";

export interface MesKilometraje {
  year: number;
  month: number;
  km: number | null;
  /** 'ok' | 'empty' | 'error' */
  estado: MonthlyMileageRow["sync_status"];
  cerrado: boolean;
  /** Si el proveedor los dio. */
  odometroInicial: number | null;
  odometroFinal: number | null;
  sincronizadoMs: number;
  error: string | null;
}

export interface ResumenKilometraje {
  meses: MesKilometraje[];
  /** El mes en curso, si hay fila. */
  mesActual: MesKilometraje | null;
  anioActual: { year: number; km: number; mesesConDato: number };
  mediaMensual: { km: number | null; meses: number };
}

const MESES_PARA_MEDIA = 12;

export function resumirKilometraje(filas: MonthlyMileageRow[], actual: Mes): ResumenKilometraje {
  const meses: MesKilometraje[] = filas
    .map((f) => ({
      year: f.year, month: f.month, km: f.distance_km, estado: f.sync_status, cerrado: f.closed,
      odometroInicial: f.initial_odometer_km, odometroFinal: f.final_odometer_km,
      sincronizadoMs: f.synced_at_ms, error: f.last_error,
    }))
    .sort((a, b) => -compararMeses(a, b));

  const conDato = (m: MesKilometraje) => m.km != null && m.estado === "ok";

  const delAnio = meses.filter((m) => m.year === actual.year && conDato(m));
  const anioActual = {
    year: actual.year,
    km: redondear(delAnio.reduce((s, m) => s + (m.km ?? 0), 0)),
    mesesConDato: delAnio.length,
  };

  const completos = meses
    .filter((m) => compararMeses(m, actual) < 0 && conDato(m))
    .slice(0, MESES_PARA_MEDIA);
  const mediaMensual = {
    km: completos.length ? redondear(completos.reduce((s, m) => s + (m.km ?? 0), 0) / completos.length) : null,
    meses: completos.length,
  };

  return {
    meses,
    mesActual: meses.find((m) => compararMeses(m, actual) === 0) ?? null,
    anioActual,
    mediaMensual,
  };
}

function redondear(km: number): number {
  return Math.round(km);
}
