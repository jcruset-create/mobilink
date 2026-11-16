/**
 * Pasa las alertas de desgaste por el juicio de los kilómetros.
 *
 * `tc_informes_alertas_vehiculos` dice qué ruedas están en su mínimo. Aquí,
 * a las que salen para CAMBIAR, se les pregunta si esa bajada cabe en los
 * kilómetros que ha hecho el vehículo (`desgasteCreible.ts`). La que no cabe
 * deja de ser un «cambiar»: se queda con la profundidad que tenía antes de
 * las lecturas en duda y la lectura baja pasa a «por confirmar», con la
 * cuenta escrita para quien vaya a medirla con sonda.
 *
 * Solo se toca lo que sale en rojo. Una rueda buena, una ya pendiente o una
 * con aviso de presión se devuelven tal cual.
 *
 * Es código puro: recibe el historial ya leído. Quien lo lee es
 * `services/informes.ts`.
 */
import {
  juzgarDesgaste, kmEnFecha, ritmoDeLaGoma, ritmoMedio, type LecturaConKm, type PuntoKm,
} from "./desgasteCreible";
import { esPosteriorAlMontaje, revisionesConTodasLasRuedas } from "./ultimaMedicion";
import type { RuedaAlerta } from "../types/informes";

export interface RevisionDeHistorial {
  id: string;
  vehiculo_id: string;
  fecha_revision: string | null;
  km_vehiculo: number | null;
  tecnico_id: string | null;
}

export interface DetalleDeHistorial {
  revision_id: string;
  posicion_id: string | null;
  profundidad_mm: number | null;
}

export interface MontajeDeHistorial {
  vehiculo_id: string;
  posicion_id: string;
  fecha_montaje: string | null;
}

export interface HistorialParaJuicio {
  revisiones: RevisionDeHistorial[];
  detalles: DetalleDeHistorial[];
  montajes: MontajeDeHistorial[];
}

/** Las ruedas que la función da para cambiar: en su mínimo y confirmadas. */
export function esParaCambiar(r: RuedaAlerta): boolean {
  return !!r.neumatico_id && !r.presion_aviso_at
    && r.profundidad_mm != null && r.minimo_mm != null
    && r.profundidad_mm <= r.minimo_mm && (r.confirmada ?? true);
}

/**
 * La serie de cada rueda de un vehículo: sus lecturas de revisiones completas
 * posteriores a su montaje, de la más reciente a la más antigua, con sus km.
 */
export function seriesDelVehiculo(
  vehiculoId: string, h: HistorialParaJuicio,
): Map<string, LecturaConKm[]> {
  const revs = h.revisiones.filter((r) => r.vehiculo_id === vehiculoId && r.fecha_revision);
  const porId = new Map(revs.map((r) => [r.id, r]));
  const suyos = h.detalles.filter((d) => porId.has(d.revision_id));
  const completas = revisionesConTodasLasRuedas(suyos.map((d) => ({ ...d, neumatico_id: null, presion_bar: null })));
  const puntos: PuntoKm[] = revs.filter((r) => r.km_vehiculo != null && r.km_vehiculo > 0)
    .map((r) => ({ fecha: r.fecha_revision as string, km: Number(r.km_vehiculo) }));
  const montaje = new Map(h.montajes.filter((m) => m.vehiculo_id === vehiculoId).map((m) => [m.posicion_id, m.fecha_montaje]));

  const series = new Map<string, LecturaConKm[]>();
  for (const d of suyos) {
    if (!d.posicion_id || d.profundidad_mm == null || !completas.has(d.revision_id)) continue;
    const rev = porId.get(d.revision_id)!;
    // Solo las de la goma que hay montada hoy: una lectura anterior a su
    // montaje es de la goma de antes y falsearía su ritmo.
    if (!esPosteriorAlMontaje(rev.fecha_revision, montaje.get(d.posicion_id))) continue;
    const lista = series.get(d.posicion_id) ?? [];
    lista.push({
      mm: Number(d.profundidad_mm),
      fecha: rev.fecha_revision,
      km: rev.km_vehiculo != null && rev.km_vehiculo > 0 ? Number(rev.km_vehiculo) : kmEnFecha(puntos, rev.fecha_revision),
      manual: !!rev.tecnico_id,
    });
    series.set(d.posicion_id, lista);
  }
  for (const lista of series.values()) {
    lista.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }
  return series;
}

/**
 * Las filas, con las alertas que no caben en los kilómetros pasadas a «por
 * confirmar».
 */
export function aplicarJuicio(filas: RuedaAlerta[], h: HistorialParaJuicio): RuedaAlerta[] {
  const seriesPorVehiculo = new Map<string, Map<string, LecturaConKm[]>>();
  return filas.map((r) => {
    if (!esParaCambiar(r) || !r.vehiculo_id || !r.posicion_id) return r;
    let series = seriesPorVehiculo.get(r.vehiculo_id);
    if (!series) {
      series = seriesDelVehiculo(r.vehiculo_id, h);
      seriesPorVehiculo.set(r.vehiculo_id, series);
    }
    const suya = series.get(r.posicion_id);
    if (!suya) return r;
    // El ritmo de reserva: el medio de las DEMÁS ruedas del vehículo.
    const reserva = ritmoMedio([...series].filter(([pos]) => pos !== r.posicion_id).map(([, s]) => ritmoDeLaGoma(s)));
    const juicio = juzgarDesgaste(suya, reserva);
    if (juicio.creible !== false || !juicio.base) return r;
    return {
      ...r,
      profundidad_mm: juicio.base.mm,
      fecha_revision: juicio.base.fecha,
      confirmada: true,
      pendiente_mm: r.profundidad_mm,
      pendiente_fecha: r.fecha_revision,
      no_creible: juicio.explicacion,
    };
  });
}
