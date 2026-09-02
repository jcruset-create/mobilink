import type { PartePdf, NeumaticoPdf, NuevoPdf } from "./generarPdf.ts";

/**
 * De lo que Mobilink ya guarda al papel del parte.
 *
 * Esta es la pieza que hace que «el parte alimente lo que ya hay» valga de
 * algo: el PDF no se rellena a mano, se DERIVA de la intervención y sus
 * operaciones. Si mañana cambia una operación, el parte reimpreso dice lo que
 * de verdad pasó.
 *
 * Sin base de datos a propósito: recibe filas y devuelve el parte, así que se
 * puede probar entero sin levantar nada.
 */

/** Una fila de tc_operacion_movimientos con lo que hace falta, ya unida. */
export interface MovimientoFila {
  movimiento_tipo: string;              // montaje | desmontaje | cambio_posicion…
  profundidad_anterior?: number | null;
  profundidad_final?: number | null;
  presion_bar?: number | null;
  posicion?: string | null;             // codigo_posicion del vehículo
  marca?: string | null;
  modelo?: string | null;
  medida?: string | null;
  serie?: string | null;                // numero_serie o DOT
  /** De la operación a la que pertenece. */
  motivo?: string | null;
  destino?: string | null;
  origen?: string | null;               // de dónde salió la goma montada
  /** true si la goma se dio de alta como nueva en esta intervención. */
  es_nuevo?: boolean | null;
}

export interface IntervencionFila {
  numero?: string | null;
  fecha?: string | null;
  orden_flota?: string | null;
  lugar_servicio?: string | null;
  inicio_at?: string | null;
  fin_at?: string | null;
  mecanico_inicio_at?: string | null;
  mecanico_fin_at?: string | null;
  mecanico_km?: number | null;
  firma_cliente_nombre?: string | null;
  firma_cliente_dni?: string | null;
  firma_tecnico_nombre?: string | null;
  matricula?: string | null;
  flota?: string | null;
  km?: number | null;
}

export interface ServicioFila { servicio: string; cantidad: number }

/** La hora, en HH:MM. El parte es de papel: la fecha ya está en su casilla. */
export function hora(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** La fecha en el formato del papel: dd/mm/aaaa. */
export function fechaCorta(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/**
 * «Descripción de la Dimensión y Modelo»: una sola columna en el papel.
 *
 * Se pone la medida primero porque es lo que se busca al repasar el parte, y
 * marca y modelo detrás. Lo que no se sepa se omite, sin dejar huecos ni
 * guiones sueltos que parezcan un dato.
 */
export function descripcion(m: MovimientoFila): string {
  return [m.medida, m.marca, m.modelo].map((x) => (x ?? "").trim()).filter(Boolean).join(" ");
}

const UN_DECIMAL = (n: number | null | undefined): string | null =>
  n == null ? null : n.toFixed(1);

function aNeumatico(m: MovimientoFila, montado: boolean): NeumaticoPdf {
  return {
    posicion: m.posicion ?? null,
    descripcion: descripcion(m),
    // En el desmontado interesa CON QUÉ se retiró; en el montado, con qué
    // entra. Son dos medidas distintas de la misma rueda.
    mm: UN_DECIMAL(montado ? m.profundidad_final : m.profundidad_anterior),
    serie: m.serie ?? null,
    ...(montado
      ? { origen: m.origen ?? null }
      : { bar: m.presion_bar != null ? m.presion_bar.toFixed(1) : null,
          razon: m.motivo ?? null, destino: m.destino ?? null }),
  };
}

/**
 * Los neumáticos nuevos montados, agrupados por marca, medida y modelo con su
 * cantidad — que es como los pide el papel, no uno por línea.
 */
export function agruparNuevos(movs: MovimientoFila[]): NuevoPdf[] {
  const cuenta = new Map<string, NuevoPdf & { unidades: number }>();
  for (const m of movs) {
    if (!m.es_nuevo || m.movimiento_tipo !== "montaje") continue;
    const clave = [m.marca, m.medida, m.modelo].map((x) => (x ?? "").trim().toUpperCase()).join("|");
    const ya = cuenta.get(clave);
    if (ya) ya.unidades += 1;
    else cuenta.set(clave, {
      marca: m.marca ?? null, dimension: m.medida ?? null,
      modelo: m.modelo ?? null, unidades: 1,
    });
  }
  return [...cuenta.values()];
}

export function armarParte(
  i: IntervencionFila,
  movimientos: MovimientoFila[],
  servicios: ServicioFila[] = [],
): PartePdf {
  // Un cambio de posición es un desmontaje Y un montaje en el papel, pero en
  // la base de datos es UN movimiento. Se cuenta en las dos tablas: el parte
  // tiene que enseñar de dónde salió y dónde acabó.
  const esDesmontaje = (m: MovimientoFila) =>
    m.movimiento_tipo === "desmontaje" || m.movimiento_tipo === "cambio_posicion";
  const esMontaje = (m: MovimientoFila) =>
    m.movimiento_tipo === "montaje" || m.movimiento_tipo === "cambio_posicion";

  const servs: Record<string, number> = {};
  for (const s of servicios) {
    if (s.cantidad > 0) servs[s.servicio] = s.cantidad;
  }

  return {
    numero: i.numero ?? null,
    orden_flota: i.orden_flota ?? null,
    flota: i.flota ?? null,
    matricula: i.matricula ?? null,
    km: i.km != null ? String(i.km) : null,
    fecha: fechaCorta(i.fecha),
    lugar: (i.lugar_servicio as PartePdf["lugar"]) ?? null,
    inicio_servicio: hora(i.inicio_at),
    fin_servicio: hora(i.fin_at),
    inicio_mecanico: hora(i.mecanico_inicio_at),
    fin_mecanico: hora(i.mecanico_fin_at),
    km_mecanico: i.mecanico_km != null ? String(i.mecanico_km) : null,
    desmontados: movimientos.filter(esDesmontaje).map((m) => aNeumatico(m, false)),
    montados: movimientos.filter(esMontaje).map((m) => aNeumatico(m, true)),
    nuevos: agruparNuevos(movimientos),
    servicios: servs,
    cliente_nombre: i.firma_cliente_nombre ?? null,
    cliente_dni: i.firma_cliente_dni ?? null,
    tecnico_nombre: i.firma_tecnico_nombre ?? null,
  };
}
