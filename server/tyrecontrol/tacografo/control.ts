/**
 * El estado de tacógrafo de cada vehículo: una sola fuente para las dos
 * pantallas.
 *
 * ── Por qué esto existe en vez de calcularlo dos veces ──────────────────────
 *
 * Lo mismo se enseña en dos sitios: la sección Tacógrafo de la ficha de un
 * vehículo y la pantalla de Control de tacógrafos, que lista la flota. Si
 * cada una lo calculara por su cuenta, un día un jefe de taller abriría la
 * ficha de un autobús, leería «vence el 14/04», abriría el control, leería
 * otra fecha, y a partir de ahí no se fiaría de ninguna de las dos.
 *
 * Así que la ficha es exactamente UNA fila de esta lista, con su histórico al
 * lado. No hay dos criterios porque no hay dos cálculos.
 *
 * ── Los datos técnicos no son «los de la última intervención» ───────────────
 *
 * Son los más recientes de CADA campo, que no es lo mismo: la última
 * intervención puede ser una transferencia que no trae número de serie ni
 * medida, y enseñar huecos cuando el dato existe —tres meses atrás— sería
 * esconderlo.
 *
 * Cada valor viaja con la fecha de la intervención de la que sale, porque un
 * número de serie sin fecha no dice si es el de ahora o el de hace cuatro
 * años.
 *
 * Aquí no se habla con la base: entran las intervenciones y los vehículos,
 * sale el estado.
 */

import { calcular, type EstadoTacografo, type Regla } from "./vencimiento.ts";
import { generacionDeTacografo, type Generacion, type GeneracionTacografo } from "./generacion.ts";

/** Una intervención, reducida a lo que el estado necesita. */
export interface IntervencionTac {
  id: string;
  vehiculoId: string | null;
  idOrigen: string;
  fecha: string;
  tipoOperacion: string | null;
  resultado: string | null;
  medidaNorm: string | null;
  medidaOrigen: string | null;
  kmNuevo: number | null;
  kmSospechoso: boolean;
  paramL: string | null;
  paramW: string | null;
  paramK: string | null;
  referencia: string | null;
  version: string | null;
  numSerie: string | null;
  numSensor: string | null;
  tipoTacografo: string | null;
  fabricante: string | null;
  /** El bastidor tal y como venía en el impreso (E23) o en el Excel. */
  bastidor: string | null;
  tecnico: string | null;
  observaciones: string | null;
}

/** Un vehículo de la flota, con lo que los filtros necesitan. */
export interface VehiculoTac {
  id: string;
  matricula: string | null;
  numeroUnidad: string | null;
  baseId: string | null;
  base: string | null;
  activo: boolean;
}

/** Un valor con la fecha de la intervención de la que sale. */
export interface Fechado {
  valor: string;
  fecha: string;
  idOrigen: string;
}

export interface DatosTecnicos {
  tipoTacografo: Fechado | null;
  fabricante: Fechado | null;
  referencia: Fechado | null;
  numSerie: Fechado | null;
  numSensor: Fechado | null;
  version: Fechado | null;
  /**
   * El bastidor que dice el tacógrafo.
   *
   * No es un dato del aparato sino del vehículo, y está aquí porque es la
   * única parte del sistema que lo trae: el centro técnico lo apunta en cada
   * intervención (campo E23 del impreso) y en TyreControl 682 autobuses de
   * la flota lo tienen vacío. Con su fecha, como los demás: un bastidor sin
   * saber de cuándo es no se puede contrastar con nada.
   */
  bastidor: Fechado | null;
  paramL: Fechado | null;
  paramW: Fechado | null;
  paramK: Fechado | null;
  medida: Fechado | null;
}

export interface FilaControl {
  vehiculoId: string;
  matricula: string | null;
  numeroUnidad: string | null;
  baseId: string | null;
  base: string | null;
  activo: boolean;

  estado: EstadoTacografo;
  ultima: string | null;
  proxima: string | null;
  diasRestantes: number | null;
  /** Tipo y resultado de la intervención que fijó la fecha. */
  ultimoTipo: string | null;
  ultimoResultado: string | null;
  intervenciones: number;
  /**
   * La generación del tacógrafo, deducida de la versión de software.
   *
   * Va en la fila de la flota y no solo en la ficha porque la pregunta que se
   * hace con esto es de flota: cuántos autobuses llevan todavía un digital
   * del reglamento viejo. Ver `generacion.ts`: NO se puede sacar de la
   * referencia, por más que lo parezca.
   */
  generacion: GeneracionTacografo;
}

export interface FichaTacografo {
  fila: FilaControl;
  tecnicos: DatosTecnicos;
  historico: IntervencionTac[];
}

const masReciente = (a: IntervencionTac, b: IntervencionTac) => b.fecha.localeCompare(a.fecha);

/**
 * El valor más reciente de cada campo, con su fecha.
 *
 * Se recorre de la más nueva a la más vieja y se toma el primer valor no
 * vacío de cada campo. Un campo que nunca se informó queda a `null`, que es
 * distinto de «no lo trae la última».
 */
export function datosTecnicos(intervenciones: IntervencionTac[]): DatosTecnicos {
  const orden = [...intervenciones].sort(masReciente);
  const primero = (f: (i: IntervencionTac) => string | null): Fechado | null => {
    for (const i of orden) {
      const v = f(i);
      if (v != null && String(v).trim() !== "") {
        return { valor: String(v), fecha: i.fecha, idOrigen: i.idOrigen };
      }
    }
    return null;
  };
  return {
    tipoTacografo: primero((i) => i.tipoTacografo),
    fabricante: primero((i) => i.fabricante),
    referencia: primero((i) => i.referencia),
    numSerie: primero((i) => i.numSerie),
    numSensor: primero((i) => i.numSensor),
    version: primero((i) => i.version),
    bastidor: primero((i) => i.bastidor),
    paramL: primero((i) => i.paramL),
    paramW: primero((i) => i.paramW),
    paramK: primero((i) => i.paramK),
    medida: primero((i) => i.medidaNorm ?? i.medidaOrigen),
  };
}

/** El estado de un vehículo a partir de sus intervenciones. */
export function filaDe(
  v: VehiculoTac, intervenciones: IntervencionTac[], regla: Regla, hoy: string,
): FilaControl {
  const venc = calcular(
    intervenciones.map((i) => ({
      fecha: i.fecha, tipoOperacion: i.tipoOperacion, resultado: i.resultado,
    })), regla, hoy);

  // La que fijó la fecha, no la última del histórico: con un filtro de tipos
  // pueden no ser la misma, y enseñar la otra haría que la fecha no cuadrase
  // con el tipo que se lee al lado.
  const marcadora = venc.ultima
    ? ([...intervenciones].filter((i) => i.fecha === venc.ultima).sort(masReciente)[0] ?? null)
    : null;

  return {
    vehiculoId: v.id,
    matricula: v.matricula,
    numeroUnidad: v.numeroUnidad,
    baseId: v.baseId,
    base: v.base,
    activo: v.activo,
    estado: venc.estado,
    ultima: venc.ultima,
    proxima: venc.proxima,
    diasRestantes: venc.diasRestantes,
    ultimoTipo: marcadora?.tipoOperacion ?? null,
    ultimoResultado: marcadora?.resultado ?? null,
    intervenciones: intervenciones.length,
    // Del MISMO sitio del que sale el dato técnico de la ficha: la
    // intervención más reciente que informó la versión, que no tiene por qué
    // ser la última.
    generacion: generacionDeFicha(datosTecnicos(intervenciones)),
  };
}

/** La generación a partir de los datos técnicos ya resueltos. */
function generacionDeFicha(t: DatosTecnicos): GeneracionTacografo {
  return generacionDeTacografo(t.version?.valor ?? null, t.fabricante?.valor ?? null);
}

export interface Filtros {
  baseId?: string | null;
  /** Subcadena de matrícula o de número de unidad. */
  texto?: string | null;
  estados?: EstadoTacografo[] | null;
  /** Solo los que vencen hasta esta fecha, inclusive. */
  venceAntesDe?: string | null;
  /** Por defecto solo los activos: a uno de baja no hay que ir a revisarlo. */
  incluirBaja?: boolean;
  /**
   * Generaciones de tacógrafo a enseñar. La pregunta real es «cuántos llevan
   * todavía un digital del reglamento viejo», y para eso hay que poder
   * quedarse con esos.
   */
  generaciones?: Generacion[] | null;
}

const normaliza = (s: string) =>
  s.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");

/**
 * El orden: lo que más corre, primero.
 *
 * Vencidos antes que próximos, próximos antes que vigentes, y dentro de cada
 * grupo el que lleva más retraso. Los «sin datos» al final: no es que estén
 * bien, es que no se sabe, y mezclarlos arriba taparía a los vencidos de
 * verdad.
 */
const PESO: Record<EstadoTacografo, number> = { vencida: 0, proxima: 1, vigente: 2, sin_datos: 3 };

export function ordenarPorVencimiento(filas: FilaControl[]): FilaControl[] {
  return [...filas].sort((a, b) =>
    PESO[a.estado] - PESO[b.estado]
    || (a.diasRestantes ?? Number.MAX_SAFE_INTEGER) - (b.diasRestantes ?? Number.MAX_SAFE_INTEGER)
    || String(a.matricula ?? "").localeCompare(String(b.matricula ?? ""), "es", { numeric: true }));
}

export interface Control {
  filas: FilaControl[];
  /** Recuento por estado ANTES de filtrar: el resumen no se encoge al filtrar. */
  resumen: Record<EstadoTacografo, number>;
  /** Y por generación, también antes de filtrar, y por la misma razón. */
  porGeneracion: Record<Generacion, number>;
  total: number;
  mostrados: number;
}

export function construirControl(
  vehiculos: VehiculoTac[],
  intervenciones: IntervencionTac[],
  regla: Regla,
  hoy: string,
  filtros: Filtros = {},
): Control {
  const porVehiculo = new Map<string, IntervencionTac[]>();
  for (const i of intervenciones) {
    if (!i.vehiculoId) continue;
    if (!porVehiculo.has(i.vehiculoId)) porVehiculo.set(i.vehiculoId, []);
    porVehiculo.get(i.vehiculoId)!.push(i);
  }

  const base = vehiculos
    .filter((v) => filtros.incluirBaja || v.activo)
    .map((v) => filaDe(v, porVehiculo.get(v.id) ?? [], regla, hoy));

  // El resumen se calcula sobre TODOS, no sobre lo filtrado: si al filtrar
  // por una base el contador de vencidos bajara, parecería que se han
  // arreglado solos.
  const resumen: Record<EstadoTacografo, number> =
    { vigente: 0, proxima: 0, vencida: 0, sin_datos: 0 };
  const porGeneracion: Record<Generacion, number> =
    { digital: 0, inteligente_v1: 0, inteligente_v2: 0, desconocida: 0 };
  for (const f of base) {
    resumen[f.estado] += 1;
    porGeneracion[f.generacion.generacion] += 1;
  }

  const texto = filtros.texto ? normaliza(filtros.texto) : null;
  const filas = base.filter((f) => {
    if (filtros.baseId && f.baseId !== filtros.baseId) return false;
    if (filtros.estados?.length && !filtros.estados.includes(f.estado)) return false;
    if (filtros.venceAntesDe && (!f.proxima || f.proxima > filtros.venceAntesDe)) return false;
    if (texto && !normaliza(`${f.matricula ?? ""}${f.numeroUnidad ?? ""}`).includes(texto)) return false;
    if (filtros.generaciones?.length && !filtros.generaciones.includes(f.generacion.generacion)) return false;
    return true;
  });

  return {
    filas: ordenarPorVencimiento(filas),
    resumen,
    porGeneracion,
    total: base.length,
    mostrados: filas.length,
  };
}

/** La sección de la ficha: la misma fila, más los datos y el histórico. */
export function fichaDe(
  v: VehiculoTac, intervenciones: IntervencionTac[], regla: Regla, hoy: string,
): FichaTacografo {
  return {
    fila: filaDe(v, intervenciones, regla, hoy),
    tecnicos: datosTecnicos(intervenciones),
    historico: [...intervenciones].sort(masReciente),
  };
}
