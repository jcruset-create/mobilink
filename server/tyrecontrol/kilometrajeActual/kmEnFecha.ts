/**
 * Los kilómetros de un vehículo: el último conocido y el de una fecha.
 *
 * Código PURO: recibe las lecturas ya leídas de la base y decide. Lo que pide
 * al proveedor (el odómetro de ahora, el de un instante pasado) lo hace el
 * router; aquí solo se elige entre lo que hay y se dice de dónde sale.
 *
 * ── Una lectura siempre lleva su fecha y su procedencia ─────────────────────
 *
 * Un «163.904 km» sin más invita a creérselo de hoy. La ficha enseña siempre
 * de cuándo es y de dónde sale (revisión, montaje, telemática), y en una fecha
 * pasada, cómo de fiable es: lectura real, telemática exacta, entre dos
 * lecturas o estimado con los km del mes.
 */

export type FuenteKm = "revision" | "operacion" | "telematica_mes" | "vehiculo";

export interface LecturaKm {
  km: number;
  /** `YYYY-MM-DD`. */
  fecha: string;
  fuente: FuenteKm;
  /** Texto para la pantalla: «revisión», «montaje», «telemática (cierre de sept.)»… */
  detalle: string;
}

/** Un mes de la telemática, con sus dos odómetros y lo que rodó. */
export interface MesTelematica {
  year: number;
  month: number;
  inicial: number | null;
  final: number | null;
  distancia: number | null;
  /** Solo un mes cerrado tiene un «final» que sea el del último día. */
  cerrado: boolean;
}

export type KmEnFecha =
  | { tipo: "lectura"; km: number; fecha: string; detalle: string }
  | { tipo: "telematica"; km: number; fecha: string; detalle: string }
  | { tipo: "interpolado"; km: number; fecha: string; anterior: LecturaKm; siguiente: LecturaKm }
  | { tipo: "estimado"; km: number; fecha: string; detalle: string }
  | { tipo: "sin_datos"; fecha: string; motivo: string };

const valido = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

const dia = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const DIA_MS = 86_400_000;
export const diasEntre = (a: string, b: string) => Math.round((dia(b) - dia(a)) / DIA_MS);
const diasDelMes = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");
const NOMBRE_MES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."];

/**
 * Los odómetros de los meses de la telemática, como lecturas con fecha: el
 * inicial vale el día 1 y el final el último día, este solo de un mes cerrado
 * (del mes en curso es el de la última sincronización, no el del día 31).
 */
export function lecturasDeMeses(meses: MesTelematica[]): LecturaKm[] {
  const out: LecturaKm[] = [];
  for (const m of meses) {
    const nombre = `${NOMBRE_MES[m.month - 1]} ${m.year}`;
    if (valido(m.inicial)) {
      out.push({ km: m.inicial, fecha: `${m.year}-${pad(m.month)}-01`, fuente: "telematica_mes", detalle: `telemática (inicio de ${nombre})` });
    }
    if (m.cerrado && valido(m.final)) {
      out.push({
        km: m.final, fecha: `${m.year}-${pad(m.month)}-${pad(diasDelMes(m.year, m.month))}`,
        fuente: "telematica_mes", detalle: `telemática (cierre de ${nombre})`,
      });
    }
  }
  return out;
}

/** Lo que un cuentakilómetros puede «bajar» sin que sea un error (redondeos). */
const HOLGURA_KM = 5;

/** Con qué facilidad se aparta una lectura cuando hay que elegir: primero lo tecleado. */
const FRAGILIDAD: Record<FuenteKm, number> = { operacion: 3, revision: 2, vehiculo: 1, telematica_mes: 0 };

/**
 * Aparta las lecturas que no cuadran con las demás.
 *
 * Un cuentakilómetros solo sube: si una lectura es MAYOR que otra de una fecha
 * posterior, una de las dos está mal. Pasa con los km tecleados a mano en un
 * montaje (92.748 en un autobús que marca 150.000). Se quita la que choca con
 * más lecturas —con empate, la tecleada antes que la de la telemática— y se
 * repite hasta que no quede ningún choque. Las apartadas no se tiran: se
 * devuelven para poder avisar de ellas.
 */
export function descartarIncoherentes(lecturas: LecturaKm[]): { buenas: LecturaKm[]; descartadas: LecturaKm[] } {
  const buenas = lecturas.filter((l) => valido(l.km));
  const descartadas: LecturaKm[] = [];
  for (;;) {
    const choques = buenas.map(() => 0);
    let alguno = false;
    for (let i = 0; i < buenas.length; i++) {
      for (let j = 0; j < buenas.length; j++) {
        const a = buenas[i], b = buenas[j];
        if (a.fecha < b.fecha && a.km > b.km + HOLGURA_KM) { choques[i]++; choques[j]++; alguno = true; }
      }
    }
    if (!alguno) break;
    let peor = 0;
    for (let i = 1; i < buenas.length; i++) {
      const masChoques = choques[i] > choques[peor];
      const empateMasFragil = choques[i] === choques[peor] && FRAGILIDAD[buenas[i].fuente] > FRAGILIDAD[buenas[peor].fuente];
      if (masChoques || empateMasFragil) peor = i;
    }
    descartadas.push(...buenas.splice(peor, 1));
  }
  return { buenas, descartadas };
}

/**
 * El último km conocido: el MAYOR de las lecturas que cuadran entre sí,
 * porque un cuentakilómetros solo sube. Con empate, la más reciente.
 */
export function ultimoConocido(lecturas: LecturaKm[]): LecturaKm | null {
  let mejor: LecturaKm | null = null;
  for (const l of descartarIncoherentes(lecturas).buenas) {
    if (!valido(l.km)) continue;
    if (!mejor || l.km > mejor.km || (l.km === mejor.km && l.fecha > mejor.fecha)) mejor = l;
  }
  return mejor;
}

/**
 * Km que la telemática dice que rodó el vehículo entre dos fechas (excluida
 * la primera, incluida la segunda), repartiendo cada mes por días. Es la
 * DISTANCIA de los viajes, que el proveedor sigue dando aunque el odómetro
 * del equipo se quede parado.
 */
export function kmRodadosEntre(desde: string, hasta: string, meses: MesTelematica[]): number {
  let total = 0;
  for (const m of meses) {
    if (!valido(m.distancia)) continue;
    const dias = diasDelMes(m.year, m.month);
    const ini = `${m.year}-${pad(m.month)}-01`;
    const fin = `${m.year}-${pad(m.month)}-${pad(dias)}`;
    const a = desde > ini ? desde : null;          // el día «desde» no cuenta
    const b = hasta < fin ? hasta : fin;
    const primero = a ? diasEntre(ini, a) + 1 : 0;  // días del mes ya pasados
    const ultimo = diasEntre(ini, b) + 1;
    const n = Math.max(0, ultimo - primero);
    total += m.distancia * (n / dias);
  }
  return total;
}

/** Por debajo de esto no se juzga si el odómetro se ha movido: ruido. */
const MIN_KM_PARA_JUZGAR = 500;

/**
 * ¿Es creíble un odómetro de la telemática para esta fecha?
 *
 * Pasa: el equipo de Movertis del 8378NBC se quedó clavado en 66.690 km el
 * 30/05/2026 y siguió contestando ese número —con fecha de hoy— mientras sus
 * viajes sumaban miles de km. Un odómetro así no es «exacto», es viejo. Se
 * rechaza si:
 *   · es MENOR que una lectura buena anterior (un cuentakilómetros no baja), o
 *   · desde la última lectura que alcanza apenas ha subido, cuando los viajes
 *     de la propia telemática dicen que el vehículo rodó bastante más.
 * Devuelve el motivo para enseñarlo, o `null` si es creíble.
 */
export function odometroNoFiable(km: number, fecha: string, lecturas: LecturaKm[], meses: MesTelematica[]): string | null {
  const fmt = (n: number) => Math.round(n).toLocaleString("es-ES");
  const buenas = descartarIncoherentes([...lecturas, ...lecturasDeMeses(meses)]).buenas.filter((l) => l.fecha <= fecha);
  const mayor = buenas.reduce<LecturaKm | null>((m, l) => (!m || l.km > m.km ? l : m), null);
  if (mayor && km < mayor.km - HOLGURA_KM) {
    return `La telemática marca ${fmt(km)} km, menos que el ${mayor.detalle} (${fmt(mayor.km)} km): su odómetro parece parado.`;
  }
  // La lectura más reciente a la que llega este odómetro: desde ahí, ¿cuánto rodó?
  const ref = buenas.filter((l) => l.km <= km + HOLGURA_KM).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
  if (!ref || ref.fecha >= fecha) return null;
  const rodados = kmRodadosEntre(ref.fecha, fecha, meses);
  if (rodados >= MIN_KM_PARA_JUZGAR && km - ref.km < rodados * 0.3) {
    return `La telemática marca ${fmt(km)} km, casi lo mismo que el ${ref.detalle} (${fmt(ref.km)} km), ` +
      `pero sus viajes suman unos ${fmt(rodados)} km desde entonces: su odómetro parece parado.`;
  }
  return null;
}

/** Cuánto se aleja como mucho una lectura vecina para interpolar entre dos. */
export const MAX_DIAS_INTERPOLAR = 62;

/**
 * Los km en una fecha, sin preguntar al proveedor: lectura real de ese día,
 * entre dos lecturas cercanas o estimado con los km del mes, siempre con las
 * lecturas que cuadran entre sí. La telemática exacta la pide el router ANTES
 * de llamar a esto; esto es lo que queda si el proveedor no la da.
 */
export function kmEnFecha(fecha: string, lecturas: LecturaKm[], meses: MesTelematica[]): KmEnFecha {
  const todas = descartarIncoherentes([...lecturas, ...lecturasDeMeses(meses)]).buenas;

  // 1. Una lectura de ese mismo día (si hay varias, la mayor: se tomó más tarde).
  const delDia = todas.filter((l) => l.fecha === fecha && l.fuente !== "telematica_mes");
  if (delDia.length) {
    const l = delDia.reduce((a, b) => (b.km > a.km ? b : a));
    return { tipo: "lectura", km: Math.round(l.km), fecha, detalle: l.detalle };
  }

  // 2. Entre dos lecturas cercanas, una antes y otra después (o del mismo día
  //    de la telemática). Se interpola en línea recta por días.
  const antes = todas.filter((l) => l.fecha <= fecha && diasEntre(l.fecha, fecha) <= MAX_DIAS_INTERPOLAR)
    .sort((a, b) => (a.fecha === b.fecha ? b.km - a.km : b.fecha.localeCompare(a.fecha)))[0];
  const despues = todas.filter((l) => l.fecha >= fecha && diasEntre(fecha, l.fecha) <= MAX_DIAS_INTERPOLAR)
    .sort((a, b) => (a.fecha === b.fecha ? a.km - b.km : a.fecha.localeCompare(b.fecha)))[0];
  if (antes && despues && despues.km >= antes.km) {
    const total = diasEntre(antes.fecha, despues.fecha);
    const km = total === 0 ? antes.km : antes.km + (despues.km - antes.km) * (diasEntre(antes.fecha, fecha) / total);
    return { tipo: "interpolado", km: Math.round(km), fecha, anterior: antes, siguiente: despues };
  }

  // 3. Estimado con el mes: odómetro del día 1 + lo que rodó, repartido por días.
  const y = +fecha.slice(0, 4), mo = +fecha.slice(5, 7), d = +fecha.slice(8, 10);
  const mes = meses.find((m) => m.year === y && m.month === mo);
  if (mes && valido(mes.inicial) && valido(mes.distancia)) {
    const dias = diasDelMes(y, mo);
    const km = mes.inicial + mes.distancia * (d / dias);
    return {
      tipo: "estimado", km: Math.round(km), fecha,
      detalle: `repartiendo los ${Math.round(mes.distancia).toLocaleString("es-ES")} km de ${NOMBRE_MES[mo - 1]} ${y} por días`,
    };
  }

  return {
    tipo: "sin_datos", fecha,
    motivo: "No hay ninguna lectura de km cerca de esa fecha (ni revisiones, ni montajes, ni telemática).",
  };
}
