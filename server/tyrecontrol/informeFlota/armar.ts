/**
 * El estado de la flota, de filas a hojas de Excel.
 *
 * Igual que en el informe de revisiones: aquí no se escribe ningún fichero y
 * no se habla con la base. Entran las filas, salen las hojas. Lo que decide
 * qué columnas hay y cómo se resume se puede probar; generar un .xlsx para
 * comprobar un total es una forma carísima de no comprobarlo.
 *
 * ── Dos hojas, y la segunda no es decorativa ────────────────────────────────
 *
 * «Flota» es la lista, una fila por vehículo. «Por cliente» es el recuento,
 * que es lo que alguien mira primero y lo que se pega en un correo. Van en
 * el mismo libro porque son la misma pregunta a dos distancias.
 *
 * ── Lo que NO se calcula aquí ───────────────────────────────────────────────
 *
 * El estado de cada vehículo —correcto, revisar, urgente, pendiente— lo
 * decide la base, con la misma cascada que alimenta la pantalla. Si se
 * recalculara aquí, el Excel y el panel acabarían diciendo cosas distintas
 * el día que alguien toque una de las dos.
 */

export type EstadoVehiculo = "correcto" | "revisar" | "urgente" | "pendiente";

/** Una fila tal como la devuelve `tc_informe_flota_detalle`. */
export interface FilaFlota {
  cliente: string | null;
  matricula: string | null;
  unidad: string | null;
  base: string | null;
  tipo: string | null;
  config: string | null;
  medida: string | null;
  estado: string | null;
  ultima_revision: string | null;
  dias_desde: number | null;
  ruedas_plano: number | null;
  ruedas_montadas: number | null;
  ruedas_medidas: number | null;
  profundidad_minima: number | null;
  bajo_minimo: number | null;
  en_aviso: number | null;
  km_actual: number | null;
}

const ESTADOS: EstadoVehiculo[] = ["urgente", "revisar", "pendiente", "correcto"];

const ETIQUETA: Record<EstadoVehiculo, string> = {
  urgente: "Urgente",
  revisar: "Revisar",
  pendiente: "Sin revisar",
  correcto: "Correcto",
};

export function estadoDe(v: string | null): EstadoVehiculo {
  return (ESTADOS as string[]).includes(v ?? "") ? (v as EstadoVehiculo) : "pendiente";
}

/**
 * El orden de la lista: primero lo que hay que atender.
 *
 * Un Excel ordenado por matrícula obliga a filtrar antes de poder usarlo.
 * Ordenado por urgencia, la primera pantalla ya es la lista de trabajo:
 * urgente, revisar, sin revisar y por último lo que está bien. Dentro de
 * cada grupo, el que lleva más tiempo sin mirarse va primero.
 */
export function ordenar(filas: FilaFlota[]): FilaFlota[] {
  const peso = (f: FilaFlota) => ESTADOS.indexOf(estadoDe(f.estado));
  return [...filas].sort((a, b) =>
    peso(a) - peso(b)
    // Sin revisión es «infinitos días»: va delante de cualquiera que sí la
    // tenga dentro de su grupo.
    || (b.dias_desde ?? Number.MAX_SAFE_INTEGER) - (a.dias_desde ?? Number.MAX_SAFE_INTEGER)
    || (a.cliente ?? "").localeCompare(b.cliente ?? "", "es")
    || (a.matricula ?? "").localeCompare(b.matricula ?? "", "es", { numeric: true }));
}

export interface ResumenCliente {
  cliente: string;
  vehiculos: number;
  urgente: number;
  revisar: number;
  pendiente: number;
  correcto: number;
  /** Ruedas bajo mínimo sumadas de la última revisión de cada vehículo. */
  bajoMinimo: number;
  /** Vehículos con menos ruedas montadas que posiciones tiene su plano. */
  planoIncompleto: number;
}

/**
 * El recuento por cliente.
 *
 * `planoIncompleto` sale aquí y no de la base porque es una comparación
 * entre dos columnas que ya vienen, y porque no es un «estado» del vehículo:
 * un camión puede estar correcto de profundidad y tener una rueda sin
 * fichar. Son dos problemas distintos y se cuentan por separado.
 */
export function resumenPorCliente(filas: FilaFlota[]): ResumenCliente[] {
  const m = new Map<string, ResumenCliente>();
  for (const f of filas) {
    const cliente = f.cliente ?? "(sin cliente)";
    const r = m.get(cliente) ?? {
      cliente, vehiculos: 0, urgente: 0, revisar: 0, pendiente: 0, correcto: 0,
      bajoMinimo: 0, planoIncompleto: 0,
    };
    r.vehiculos += 1;
    r[estadoDe(f.estado)] += 1;
    r.bajoMinimo += f.bajo_minimo ?? 0;
    if ((f.ruedas_plano ?? 0) > 0 && (f.ruedas_montadas ?? 0) < (f.ruedas_plano ?? 0)) r.planoIncompleto += 1;
    m.set(cliente, r);
  }
  return [...m.values()].sort((a, b) =>
    b.urgente - a.urgente || b.revisar - a.revisar || b.vehiculos - a.vehiculos
    || a.cliente.localeCompare(b.cliente, "es"));
}

/** Una fila de la hoja «Flota», ya con los nombres de columna del Excel. */
export type FilaHoja = Record<string, string | number | null>;

export function hojaFlota(filas: FilaFlota[]): FilaHoja[] {
  return ordenar(filas).map((f) => ({
    Cliente: f.cliente ?? "",
    Matrícula: f.matricula ?? "",
    Unidad: f.unidad ?? "",
    Base: f.base ?? "",
    Estado: ETIQUETA[estadoDe(f.estado)],
    "Última revisión": f.ultima_revision ?? "",
    "Días desde": f.dias_desde,
    "Ruedas del plano": f.ruedas_plano,
    "Ruedas montadas": f.ruedas_montadas,
    // Se dice en una columna en vez de obligar a restar dos: es el aviso que
    // de verdad se busca al abrir esto.
    "Faltan por fichar": (f.ruedas_plano ?? 0) > 0
      ? Math.max(0, (f.ruedas_plano ?? 0) - (f.ruedas_montadas ?? 0)) : null,
    "Ruedas medidas": f.ruedas_medidas,
    "Prof. mínima (mm)": f.profundidad_minima,
    "Bajo mínimo": f.bajo_minimo,
    "En aviso": f.en_aviso,
    Tipo: f.tipo ?? "",
    "Config. ejes": f.config ?? "",
    Medida: f.medida ?? "",
    Km: f.km_actual,
  }));
}

export function hojaPorCliente(filas: FilaFlota[]): FilaHoja[] {
  const r = resumenPorCliente(filas);
  const total: FilaHoja = {
    Cliente: "TOTAL",
    Vehículos: r.reduce((s, x) => s + x.vehiculos, 0),
    Urgente: r.reduce((s, x) => s + x.urgente, 0),
    Revisar: r.reduce((s, x) => s + x.revisar, 0),
    "Sin revisar": r.reduce((s, x) => s + x.pendiente, 0),
    Correcto: r.reduce((s, x) => s + x.correcto, 0),
    "Ruedas bajo mínimo": r.reduce((s, x) => s + x.bajoMinimo, 0),
    "Con ruedas sin fichar": r.reduce((s, x) => s + x.planoIncompleto, 0),
  };
  const filasCliente = r.map<FilaHoja>((x) => ({
    Cliente: x.cliente,
    Vehículos: x.vehiculos,
    Urgente: x.urgente,
    Revisar: x.revisar,
    "Sin revisar": x.pendiente,
    Correcto: x.correcto,
    "Ruedas bajo mínimo": x.bajoMinimo,
    "Con ruedas sin fichar": x.planoIncompleto,
  }));
  // El total va al final y solo si hay más de un cliente: con uno sería la
  // misma fila repetida.
  return filasCliente.length > 1 ? [...filasCliente, total] : filasCliente;
}
