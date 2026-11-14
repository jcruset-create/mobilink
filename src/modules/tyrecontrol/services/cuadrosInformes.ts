/**
 * Lo que deja en pantalla cada cuadro de los informes al pulsarlo.
 *
 * La regla es la misma en todos: el cuadro es la pregunta y la lista de debajo
 * la respuesta, así que pulsarlo tiene que dejar solo lo suyo. Aquí está lo que
 * significa «lo suyo» en cada informe, separado de la pantalla para poder
 * probarlo. Desgaste tiene el suyo en `desgasteFiltro.ts`; la previsión de
 * compra, en `previsionMedida.ts`.
 *
 * No todos los cuadros pueden filtrar: el que da un total sin filas detrás
 * (un coste, unos kilómetros) no tiene nada que dejar, y no se le pone clic.
 */
import type { MontajesInforme, PresionNeumatico, ProductividadTecnico } from "../types/informes";

// ── Presiones ───────────────────────────────────────────────────────────────

export type EstadoPresion = "baja" | "alta" | "ok" | "sin_referencia";

export const NOMBRE_PRESION: Record<EstadoPresion, string> = {
  baja: "Presión baja", alta: "Sobrepresión", ok: "Correctas", sin_referencia: "Sin referencia",
};

/** Las gomas de ese estado; con `null`, todas (la misma lista). */
export function presionesDeEstado(items: PresionNeumatico[], estado: EstadoPresion | null): PresionNeumatico[] {
  return estado === null ? items : items.filter((i) => i.estado === estado);
}

// ── Productividad ───────────────────────────────────────────────────────────

export type MetricaProductividad = "revisiones" | "neumaticos_revisados" | "operaciones";

export const NOMBRE_METRICA: Record<MetricaProductividad, string> = {
  revisiones: "Revisiones", neumaticos_revisados: "Neumáticos revisados", operaciones: "Operaciones",
};

/**
 * Los técnicos que tienen algo de esa métrica, del que más al que menos.
 *
 * Aquí el cuadro no parte la lista en grupos —un técnico hace revisiones Y
 * operaciones—: elige por qué número se mira. Quien tiene cero de eso sale de
 * la lista, que es lo que se espera al pulsar «Operaciones».
 */
export function tecnicosPorMetrica(items: ProductividadTecnico[], metrica: MetricaProductividad | null): ProductividadTecnico[] {
  if (metrica === null) return items;
  return items
    .filter((i) => Number(i[metrica]) > 0)
    .sort((a, b) => Number(b[metrica]) - Number(a[metrica]) || a.tecnico.localeCompare(b.tecnico, "es"));
}

// ── Montajes ────────────────────────────────────────────────────────────────

export type CondicionMontaje = "nueva" | "usada" | "recauchutada";

export const NOMBRE_CONDICION: Record<CondicionMontaje, string> = {
  nueva: "Nuevos", usada: "Usados", recauchutada: "Recauchutados",
};

const CAMPO_VEHICULO: Record<CondicionMontaje, "nuevas" | "usadas" | "recauchutadas"> = {
  nueva: "nuevas", usada: "usadas", recauchutada: "recauchutadas",
};

/**
 * Lo que queda del informe de montajes al quedarse con una condición: las
 * referencias de esa condición, y los vehículos con cuántas de ESAS llevan
 * —no su total—, sin los que no llevan ninguna y del que más al que menos.
 */
export function montajesDeCondicion(
  data: Pick<MontajesInforme, "por_referencia" | "por_vehiculo">,
  condicion: CondicionMontaje | null,
): { referencias: MontajesInforme["por_referencia"]; vehiculos: { matricula: string; n: number }[] } {
  if (condicion === null) {
    return { referencias: data.por_referencia, vehiculos: data.por_vehiculo.map((v) => ({ matricula: v.matricula, n: v.n })) };
  }
  const campo = CAMPO_VEHICULO[condicion];
  return {
    referencias: data.por_referencia.filter((r) => r.condicion === condicion),
    vehiculos: data.por_vehiculo
      .map((v) => ({ matricula: v.matricula, n: Number(v[campo]) || 0 }))
      .filter((v) => v.n > 0)
      .sort((a, b) => b.n - a.n || a.matricula.localeCompare(b.matricula, "es")),
  };
}
