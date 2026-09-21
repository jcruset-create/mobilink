/**
 * El ranking de kilómetros: qué autobuses ruedan más, de más a menos.
 *
 * ── Por qué no es un `sum()` y un `order by` ────────────────────────────────
 *
 * Porque no todos los vehículos tienen los mismos meses rellenos. Ordenar por
 * total daría el primer puesto al que tiene más datos, no al que más rueda: un
 * autobús con siete meses sincronizados le gana a uno con tres aunque el
 * segundo haga el doble de kilómetros.
 *
 * Así que se ordena por la MEDIA MENSUAL llevada a doce meses, y el número de
 * meses que respalda cada cifra va en su propia columna, al lado. «96.000
 * km/año sobre 3 meses» no vale lo mismo que sobre doce, y quien ordena la
 * lista tiene que verlo sin preguntar.
 *
 * ── El criterio sale de `resumirKilometraje`, no de aquí ────────────────────
 *
 * Es la regla de la casa y está escrita en la cabecera de `resumen.ts`: un
 * solo sitio para que el «año actual» de la ficha y el de un informe sean el
 * mismo número. Si este ranking recalculara la media con criterios parecidos,
 * un técnico abriría la ficha de un autobús, vería 96.000 km, abriría el
 * ranking, vería 94.300 y a partir de ahí no se fiaría de ninguno de los dos.
 *
 * De ahí sale gratis lo que más importa: un mes `empty` NO cuenta como cero.
 * Un equipo apagado no es un autobús parado, y meterlo como cero hundiría en
 * la lista justo a los vehículos con peor cobertura de telemática. Un mes
 * parado de verdad sí cuenta: es `ok` con distancia cero.
 *
 * ── Los que no tienen ningún dato son un HALLAZGO ───────────────────────────
 *
 * Un vehículo activo sin un solo mes sincronizado casi nunca es un autobús que
 * no rueda: es uno que no está enlazado con el proveedor. Va en su propia
 * sección al final, no mezclado con un 0 en la lista, porque son dos cosas
 * distintas y confundirlas esconde trabajo de conciliación pendiente.
 */

import type { MonthlyMileageRow } from "../../integration-hub/infrastructure/repositories.ts";
import type { Mes } from "../../integration-hub/domain/meses.ts";
import { resumirKilometraje } from "./resumen.ts";

export interface VehiculoDelRanking {
  vehiculoId: string;
  matricula: string | null;
  numeroUnidad: string | null;
  /** Media mensual × 12. `null` si no hay ningún mes completo con dato. */
  kmAnual: number | null;
  /** Sobre cuántos meses completos está hecha esa cifra. Va SIEMPRE al lado. */
  meses: number;
  /** Lo acumulado en el año en curso, tal y como lo enseña la ficha. */
  kmAnioActual: number;
  mesesDelAnio: number;
  /** El mes en curso va aparte: está a medias y no entra en la media. */
  kmMesActual: number | null;
  /** Meses que el proveedor no supo contestar. Explica una cifra corta. */
  mesesSinDato: number;
  mesesConError: number;
}

export interface Ranking {
  /** De más a menos kilómetros al año. */
  vehiculos: VehiculoDelRanking[];
  /**
   * Activos sin un solo mes sincronizado. Casi siempre es conciliación
   * pendiente, no un autobús parado. Ver la cabecera.
   */
  sinDatos: Array<{ vehiculoId: string; matricula: string | null; numeroUnidad: string | null }>;
  /** Para poder decir «media de la flota» sin recalcularla en la pantalla. */
  totales: { vehiculosConDato: number; kmAnualTotal: number; kmAnualMedio: number | null };
}

export interface VehiculoDeFlota {
  id: string;
  matricula: string | null;
  numeroUnidad: string | null;
}

/**
 * Monta el ranking a partir de las filas mensuales y la flota activa.
 *
 * Puro: entran las filas, sale la lista. Ni base ni red, que es lo que permite
 * comprobar la parte que de verdad decide —quién va delante de quién— sin
 * levantar nada.
 */
export function rankingDeKilometraje(
  filas: MonthlyMileageRow[],
  flota: VehiculoDeFlota[],
  mesActual: Mes,
): Ranking {
  const porVehiculo = new Map<string, MonthlyMileageRow[]>();
  for (const f of filas) {
    const lista = porVehiculo.get(f.mobilink_id);
    if (lista) lista.push(f);
    else porVehiculo.set(f.mobilink_id, [f]);
  }

  const vehiculos: VehiculoDelRanking[] = [];
  const sinDatos: Ranking["sinDatos"] = [];

  for (const v of flota) {
    const suyas = porVehiculo.get(v.id) ?? [];
    // Sin ninguna fila no es que no ruede: es que no está enlazado.
    if (suyas.length === 0) {
      sinDatos.push({ vehiculoId: v.id, matricula: v.matricula, numeroUnidad: v.numeroUnidad });
      continue;
    }

    const r = resumirKilometraje(suyas, mesActual);
    // Con filas pero sin ningún mes completo con dato, tampoco hay ranking que
    // hacer: van a la misma sección, que es donde alguien va a mirar.
    if (r.mediaMensual.kmExacto == null) {
      sinDatos.push({ vehiculoId: v.id, matricula: v.matricula, numeroUnidad: v.numeroUnidad });
      continue;
    }

    vehiculos.push({
      vehiculoId: v.id,
      matricula: v.matricula,
      numeroUnidad: v.numeroUnidad,
      kmAnual: redondear(r.mediaMensual.kmExacto * 12),
      meses: r.mediaMensual.meses,
      kmAnioActual: r.anioActual.km,
      mesesDelAnio: r.anioActual.mesesConDato,
      kmMesActual: r.mesActual?.km ?? null,
      mesesSinDato: suyas.filter((f) => f.sync_status === "empty").length,
      mesesConError: suyas.filter((f) => f.sync_status === "error").length,
    });
  }

  // De más a menos. Empate: el que lo tenga medido sobre más meses va antes,
  // porque su cifra es la que aguanta mejor una pregunta.
  vehiculos.sort((a, b) => (b.kmAnual ?? 0) - (a.kmAnual ?? 0) || b.meses - a.meses);

  const suma = vehiculos.reduce((s, v) => s + (v.kmAnual ?? 0), 0);
  return {
    vehiculos,
    sinDatos,
    totales: {
      vehiculosConDato: vehiculos.length,
      kmAnualTotal: redondear(suma),
      kmAnualMedio: vehiculos.length ? redondear(suma / vehiculos.length) : null,
    },
  };
}

function redondear(km: number): number {
  return Math.round(km);
}
