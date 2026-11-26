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
