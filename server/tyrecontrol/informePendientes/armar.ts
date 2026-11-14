/**
 * Los vehículos que están EN BASE y pendientes de revisar, agrupados por base.
 *
 * Es la hoja de trabajo del patio: a quién se puede ir a buscar ahora mismo,
 * ordenado por lo que más corre. Lo que la pantalla «Vehículos en bases»
 * enseña en tarjetas, en papel y con todo lo que se sabe del vehículo.
 *
 * ── La regla de «pendiente» NO se reescribe aquí ────────────────────────────
 *
 * Sale de `tieneRevisionPendiente`, la misma función que usa la pantalla. Si
 * se copiara el criterio, el PDF y la pantalla acabarían discrepando el día
 * que alguien añada un estado, y entonces el papel dice una cosa y el panel
 * otra delante del cliente. Vive en `revisionPendiente.ts`, un módulo hoja:
 * importar `presenciaVista` entero traería al typecheck del servidor el
 * cliente de Supabase del navegador.
 *
 * Lo mismo con «en base»: solo `IN_BASE`. Un `STALE_POSITION` cae dentro del
 * recinto y probablemente siga ahí, pero «probablemente» no es a quien se
 * manda buscar al patio.
 *
 * Aquí no se dibuja ni se habla con la base: entran las tres fuentes, sale
 * la estructura del PDF.
 */

import type { RevisionEstado } from "../../../src/modules/tyrecontrol/types/index.ts";
import { prioridadRevision, tieneRevisionPendiente } from "../../../src/modules/tyrecontrol/services/revisionPendiente.ts";

/** Una fila de presencia, reducida a lo que esto necesita. */
export interface PresenciaFila {
  vehiculo_id: string;
  estado: string;
  delegacion_id: string | null;
  distancia_m: number | null;
  antiguedad_min: number | null;
  entrada_base_at: string | null;
  posicion_at: string | null;
  vehiculo?: { matricula?: string | null; numero_unidad?: string | null } | null;
  delegacion?: { id?: string; nombre?: string | null } | null;
}

/** Lo que `tc_informe_flota_detalle` sabe de cada vehículo, por matrícula. */
export interface FichaVehiculo {
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

export interface VehiculoPendiente {
  matricula: string;
  unidad: string | null;
  /** Cuánto lleva dentro de la base, en minutos. */
  enBaseMin: number | null;
  /** Antigüedad de la última posición, en minutos. */
  posicionMin: number | null;
  distanciaM: number | null;
  /** Lo que dice la periodicidad: vencida, próxima, sin revisión… */
  periodicidad: string;
  diasVencido: number | null;
  ultimaRevision: string | null;
  ultimaRevisionPor: string | null;
  /** Lo que sabemos de la ficha; vacío si el vehículo no salió en la flota. */
  ficha: FichaVehiculo | null;
}

export interface BaseDoc {
  baseId: string;
  nombre: string;
  vehiculos: VehiculoPendiente[];
  vencidos: number;
}

export interface DocumentoPendientes {
  titulo: string;
  empresa: string;
  generado: string;
  /** Nombre de la base cuando se ha filtrado por una; null si son todas. */
  baseFiltrada: string | null;
  total: number;
  bases: BaseDoc[];
  advertencias: string[];
}

/**
 * Qué va primero.
 *
 * Vencida antes que próxima, y sin revisión antes que nada: un vehículo del
 * que no se sabe nada es el que peor se conoce. Dentro del mismo estado,
 * más días vencido primero.
 *
 * El criterio es el MISMO que ordena la pantalla, no una copia: sale de
 * `revisionPendiente.ts`, igual que «qué cuenta como pendiente». Se
 * reexporta con el nombre corto porque aquí no hay otra prioridad.
 */
export { prioridadRevision as prioridad } from "../../../src/modules/tyrecontrol/services/revisionPendiente.ts";

export interface OpcionesPendientes {
  /** Id de la base a la que acotar; null son todas. */
  baseId: string | null;
  ahora?: Date;
}

export function armarPendientes(
  presencia: PresenciaFila[],
  revisiones: Map<string, RevisionEstado>,
  fichas: Map<string, FichaVehiculo>,
  nombreEmpresa: string,
  op: OpcionesPendientes,
): DocumentoPendientes {
  const advertencias: string[] = [];
  const ahora = op.ahora ?? new Date();

  const dentro = presencia.filter((p) => p.estado === "IN_BASE");
  const pendientes = dentro.filter((p) => tieneRevisionPendiente(revisiones.get(p.vehiculo_id)));

  // Un vehículo dentro de una base cuya delegación no se sabe no se puede
  // agrupar. Se dice en vez de meterlo en un cajón llamado «otras».
  const sinBase = pendientes.filter((p) => !p.delegacion_id).length;
  if (sinBase > 0) {
    advertencias.push(`${sinBase} vehículo(s) pendientes están en base pero sin delegación identificada: no salen agrupados.`);
  }

  const elegidos = pendientes.filter((p) =>
    p.delegacion_id && (!op.baseId || p.delegacion_id === op.baseId));

  // El nombre de la base filtrada se busca en TODA la presencia, no solo en
  // los que salen: si esa base no tiene a nadie pendiente, la cabecera tiene
  // que seguir diciendo de qué base habla. Si no, una hoja vacía de Reus se
  // imprime como «todas las bases» y parece que no hay nada pendiente en
  // ninguna parte.
  const baseFiltrada = op.baseId
    ? (presencia.find((p) => p.delegacion_id === op.baseId)?.delegacion?.nombre
       ?? "(base sin nombre)")
    : null;

  const porBase = new Map<string, BaseDoc>();

  for (const p of elegidos) {
    const baseId = p.delegacion_id!;
    const nombre = p.delegacion?.nombre ?? "(base sin nombre)";
    const rev = revisiones.get(p.vehiculo_id);
    const matricula = p.vehiculo?.matricula ?? "—";
    const b = porBase.get(baseId) ?? { baseId, nombre, vehiculos: [], vencidos: 0 };
    b.vehiculos.push({
      matricula,
      unidad: p.vehiculo?.numero_unidad ?? null,
      enBaseMin: minutosDesde(p.entrada_base_at, ahora),
      posicionMin: p.antiguedad_min ?? minutosDesde(p.posicion_at, ahora),
      distanciaM: p.distancia_m,
      periodicidad: rev?.estado ?? "sin_revision",
      diasVencido: rev?.dias_vencido ?? null,
      ultimaRevision: rev?.ultima_revision ?? null,
      ultimaRevisionPor: rev?.ultima_revision_por ?? null,
      ficha: fichas.get(clave(matricula)) ?? null,
    });
    if (rev?.estado === "vencida" || rev?.estado === "sin_revision") b.vencidos += 1;
    porBase.set(baseId, b);
  }

  for (const b of porBase.values()) {
    b.vehiculos.sort((a, z) =>
      prioridadRevision(a.periodicidad) - prioridadRevision(z.periodicidad)
      || (z.diasVencido ?? 0) - (a.diasVencido ?? 0)
      // Más tiempo dentro primero: lleva más rato disponible y puede irse
      // antes que el que acaba de entrar.
      || (z.enBaseMin ?? 0) - (a.enBaseMin ?? 0)
      || a.matricula.localeCompare(z.matricula, "es", { numeric: true }));
  }

  const bases = [...porBase.values()].sort((a, b) =>
    b.vencidos - a.vencidos || b.vehiculos.length - a.vehiculos.length
    || a.nombre.localeCompare(b.nombre, "es"));

  const total = bases.reduce((s, b) => s + b.vehiculos.length, 0);
  if (total === 0) advertencias.push(porQueVacio(presencia, dentro, pendientes, op.baseId));

  const faltanFichas = bases.flatMap((b) => b.vehiculos).filter((v) => !v.ficha).length;
  if (faltanFichas > 0) {
    advertencias.push(`${faltanFichas} vehículo(s) salen sin los datos de su ficha: no estaban en la flota activa al generar el informe.`);
  }

  return {
    titulo: "Pendientes de revisar, en base ahora",
    empresa: nombreEmpresa,
    generado: ahora.toISOString(),
    baseFiltrada,
    total,
    bases,
    advertencias,
  };
}


/**
 * Por qué no sale nadie.
 *
 * «No hay ningún vehículo pendiente» se lee como «está todo al día», y eso
 * es verdad en un caso de cuatro. En los otros tres el papel estaría
 * diciendo algo que no ha comprobado: que no hay barrido de posiciones, que
 * nadie está dentro de una base, o que los que están ya se revisaron. Cada
 * uno se arregla en un sitio distinto, así que cada uno se dice.
 */
function porQueVacio(
  presencia: PresenciaFila[],
  dentro: PresenciaFila[],
  pendientes: PresenciaFila[],
  baseId: string | null,
): string {
  if (presencia.length === 0) {
    return "No hay ningún barrido de posiciones para esta empresa, así que no se sabe quién está "
      + "en base. Se activa dando de alta su cuenta de telemática en el Hub.";
  }
  if (dentro.length === 0) {
    return `Ninguno de los ${presencia.length} vehículos con posición está dentro de una base `
      + "ahora mismo.";
  }
  if (pendientes.length === 0) {
    return `Los ${dentro.length} vehículos que están en base tienen la revisión al día.`;
  }
  return baseId
    ? "Ahora mismo no hay ningún vehículo pendiente de revisar dentro de esa base."
    : "Ahora mismo no hay ningún vehículo pendiente de revisar dentro de una base.";
}

/** Las matrículas se cruzan normalizadas: en la flota pueden traer espacios. */
export function clave(matricula: string | null | undefined): string {
  return (matricula ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function indexarFichas(filas: FichaVehiculo[]): Map<string, FichaVehiculo> {
  const m = new Map<string, FichaVehiculo>();
  for (const f of filas) {
    const k = clave(f.matricula);
    if (k && !m.has(k)) m.set(k, f);
  }
  return m;
}

/** Minutos desde un instante. `null` si no hay instante o no se entiende. */
export function minutosDesde(iso: string | null | undefined, ahora: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.round((ahora.getTime() - t) / 60000));
}

/** «3 d 7 h», «45 min». Lo mismo que enseña la pantalla. */
export function enPalabras(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${min % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
