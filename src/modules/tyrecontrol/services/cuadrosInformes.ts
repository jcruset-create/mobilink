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
import type {
  CeldaInventario, DimensionTotal, EstadoDeFlota, MarcaMedidaTotal, MontajesInforme, OperacionesInforme,
  PresionNeumatico, ProductividadTecnico, ProfundidadDistribucion, VehiculoFlota,
} from "../types/informes";

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

// ── Inventario ──────────────────────────────────────────────────────────────

/** Los estados que tienen cuadro en el inventario. */
export type EstadoInventario = "montado" | "almacen" | "reparacion" | "descartado";

export const NOMBRE_ESTADO_INVENTARIO: Record<EstadoInventario, string> = {
  montado: "Montados", almacen: "En almacén", reparacion: "En reparación", descartado: "Descartados",
};

/** Los números de los cuadros: todos los neumáticos, los del histórico también. */
export function cuadrosDelInventario(celdas: CeldaInventario[]): Record<"total" | EstadoInventario, number> {
  const n = { total: 0, montado: 0, almacen: 0, reparacion: 0, descartado: 0 };
  for (const c of celdas) {
    n.total += c.n;
    if (c.estado in n && c.estado !== "total") n[c.estado as EstadoInventario] += c.n;
  }
  return n;
}

function sumarPor(celdas: CeldaInventario[], clave: (c: CeldaInventario) => string): DimensionTotal[] {
  const por = new Map<string, number>();
  for (const c of celdas) por.set(clave(c), (por.get(clave(c)) ?? 0) + c.n);
  return [...por].map(([etiqueta, total]) => ({ etiqueta, total }))
    .sort((a, b) => b.total - a.total || a.etiqueta.localeCompare(b.etiqueta, "es"));
}

export interface TablasInventario {
  porMarca: DimensionTotal[];
  porMedida: DimensionTotal[];
  porModelo: DimensionTotal[];
  porEstado: DimensionTotal[];
  marcaMedida: MarcaMedidaTotal[];
  profundidad: ProfundidadDistribucion[];
  /** Cuántos neumáticos entran en el filtro, los del histórico incluidos. */
  enElFiltro: number;
  /** Cuántos de ésos son fichas del histórico: cuentan arriba y no en las tablas. */
  delHistorico: number;
}

/**
 * Las tablas del inventario, enteras (`estado` null) o de un solo estado.
 *
 * Reproduce a las funciones de la base que había, que no cuentan todas lo
 * mismo y así tiene que seguir:
 *
 *   · por marca, medida, modelo, estado y marca + medida NO cuentan las fichas
 *     que creó la importación del histórico;
 *   · la distribución por profundidad SÍ, y solo los que tienen alguna medida.
 *
 * Comprobado contra producción: sin filtro, de las celdas salen las mismas
 * filas que dan esas funciones, sin una diferencia.
 */
export function tablasDelInventario(celdas: CeldaInventario[], estado: EstadoInventario | null): TablasInventario {
  const suyas = estado === null ? celdas : celdas.filter((c) => c.estado === estado);
  const propias = suyas.filter((c) => !c.de_lote);

  const mm = new Map<string, MarcaMedidaTotal>();
  for (const c of propias) {
    const k = `${c.marca}\u0000${c.medida}`;
    const f = mm.get(k) ?? { marca: c.marca, medida: c.medida, total: 0 };
    f.total += c.n;
    mm.set(k, f);
  }

  const prof = new Map<string, ProfundidadDistribucion>();
  for (const c of suyas) {
    if (c.rango === null) continue;
    const f = prof.get(c.marca) ?? { marca: c.marca, r0_2: 0, r2_4: 0, r4_6: 0, r6_8: 0, r8_10: 0, r10: 0, total: 0 };
    f[c.rango] += c.n;
    f.total += c.n;
    prof.set(c.marca, f);
  }

  return {
    porMarca: sumarPor(propias, (c) => c.marca),
    porMedida: sumarPor(propias, (c) => c.medida),
    porModelo: sumarPor(propias, (c) => c.modelo),
    porEstado: sumarPor(propias, (c) => c.estado),
    marcaMedida: [...mm.values()].sort((a, b) => b.total - a.total || a.marca.localeCompare(b.marca, "es") || a.medida.localeCompare(b.medida, "es")),
    profundidad: [...prof.values()].sort((a, b) => b.total - a.total || a.marca.localeCompare(b.marca, "es")),
    enElFiltro: suyas.reduce((s, c) => s + c.n, 0),
    delHistorico: suyas.reduce((s, c) => s + (c.de_lote ? c.n : 0), 0),
  };
}

// ── Operaciones ─────────────────────────────────────────────────────────────

/** Si la base ya manda el reparto por tipo: sin él los cuadros no pueden filtrar. */
export function operacionesSePuedenFiltrar(data: OperacionesInforme): boolean {
  return Array.isArray(data.por_tipo_motivo) && Array.isArray(data.evolucion_tipo);
}

/**
 * Los motivos y la evolución mensual de un solo tipo de operación; con `null`
 * (o si la base no manda el reparto), los de todas.
 */
export function operacionesDeTipo(
  data: OperacionesInforme,
  tipo: string | null,
): Pick<OperacionesInforme, "por_motivo" | "evolucion"> {
  if (tipo === null || !operacionesSePuedenFiltrar(data)) {
    return { por_motivo: data.por_motivo, evolucion: data.evolucion };
  }
  return {
    por_motivo: (data.por_tipo_motivo ?? []).filter((x) => x.tipo === tipo)
      .map((x) => ({ motivo: x.motivo, n: x.n }))
      .sort((a, b) => b.n - a.n || a.motivo.localeCompare(b.motivo, "es")),
    // Los meses en los que ese tipo no tuvo ninguna salen a cero, no
    // desaparecen: una gráfica que se salta meses miente sobre el ritmo.
    evolucion: data.evolucion.map((e) => ({
      mes: e.mes,
      n: (data.evolucion_tipo ?? []).find((x) => x.mes === e.mes && x.tipo === tipo)?.n ?? 0,
    })),
  };
}

// ── Estado de flota ─────────────────────────────────────────────────────────

export const NOMBRE_ESTADO_FLOTA: Record<EstadoDeFlota, string> = {
  urgente: "Urgente", revisar: "Revisar", pendiente: "Pendiente", correcto: "Correcto",
};

/** De lo que más prisa corre a lo que menos. */
const GRAVEDAD: Record<EstadoDeFlota, number> = { urgente: 0, revisar: 1, pendiente: 2, correcto: 3 };

/**
 * Los vehículos de ese estado (o todos), con lo peor primero: por gravedad,
 * dentro de ella la profundidad más baja delante —sin dato, al final— y a
 * igualdad por matrícula.
 */
export function vehiculosDeEstado(vehiculos: VehiculoFlota[], estado: EstadoDeFlota | null): VehiculoFlota[] {
  const suyos = estado === null ? [...vehiculos] : vehiculos.filter((v) => v.estado === estado);
  return suyos.sort((a, b) =>
    (GRAVEDAD[a.estado] ?? 9) - (GRAVEDAD[b.estado] ?? 9)
    || (a.prof_min ?? Number.POSITIVE_INFINITY) - (b.prof_min ?? Number.POSITIVE_INFINITY)
    || (a.matricula ?? "").localeCompare(b.matricula ?? "", "es"));
}
