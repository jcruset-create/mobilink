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
  | { tipo: "reconstruido"; km: number; fecha: string; detalle: string; ancla: LecturaKm; rodados: number }
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
      // El odómetro «al empezar» es el del final del día anterior al 1: todas
      // las lecturas se entienden al acabar su día.
      const fechaIni = m.month === 1 ? `${m.year - 1}-12-31` : `${m.year}-${pad(m.month - 1)}-${pad(diasDelMes(m.year, m.month - 1))}`;
      out.push({ km: m.inicial, fecha: fechaIni, fuente: "telematica_mes", detalle: `telemática (inicio de ${nombre})` });
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
  for (const l of descartarIncoherentes(lecturas.filter((x) => x.km < ODOMETRO_IMPOSIBLE_KM)).buenas) {
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
export function kmRodadosEntre(desde: string, hasta: string, meses: MesTelematica[], hoy?: string): number {
  let total = 0;
  for (const m of meses) {
    if (!valido(m.distancia)) continue;
    // Del mes en curso, la distancia es la de los días que van, no la del mes
    // entero: se reparte entre los días transcurridos.
    const enCurso = !!hoy && !m.cerrado && hoy.slice(0, 7) === `${m.year}-${pad(m.month)}`;
    const dias = enCurso ? Math.max(1, +hoy!.slice(8, 10)) : diasDelMes(m.year, m.month);
    const ini = `${m.year}-${pad(m.month)}-01`;
    const fin = `${m.year}-${pad(m.month)}-${pad(dias)}`;
    const a = desde > ini ? desde : null;          // el día «desde» no cuenta
    const b = hasta < fin ? hasta : fin;
    const primero = a ? diasEntre(ini, a) + 1 : 0;  // días del mes ya pasados
    const ultimo = diasEntre(ini, b) + 1;
    const n = Math.min(dias, Math.max(0, ultimo - primero));
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

// ── Odómetro reconstruido ───────────────────────────────────────────────────
//
// El odómetro de Movertis no vale hoy para la mayoría de la flota (parado
// desde 08/2026, acumulado por GPS desde la instalación, o en otra unidad: hay
// vehículos con 8 millones de km). La DISTANCIA de sus viajes sí vale. Así que
// el km de cualquier día se reconstruye desde la lectura REAL más cercana
// (revisión o montaje con el km del salpicadero) sumando o restando los km de
// viajes entre las dos fechas. Cada lectura real nueva lo vuelve a anclar: el
// error de la distancia GPS no se acumula.

/** Lo que ningún vehículo de la flota puede marcar: un odómetro así es de otra unidad. */
export const ODOMETRO_IMPOSIBLE_KM = 3_000_000;

const esReal = (l: LecturaKm) => l.fuente === "revision" || l.fuente === "operacion";

/** Las lecturas reales (revisiones y montajes) que cuadran entre sí. */
export function anclas(lecturas: LecturaKm[]): LecturaKm[] {
  return descartarIncoherentes(lecturas.filter(esReal)).buenas;
}

const mesDe = (f: string) => f.slice(0, 7);
function mesesDelTramo(a: string, b: string): string[] {
  const [desde, hasta] = a <= b ? [a, b] : [b, a];
  const out: string[] = [];
  let y = +desde.slice(0, 4), m = +desde.slice(5, 7);
  const fy = +hasta.slice(0, 4), fm = +hasta.slice(5, 7);
  while (y < fy || (y === fy && m <= fm)) {
    out.push(`${y}-${pad(m)}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export interface Reconstruido {
  km: number;
  fecha: string;
  ancla: LecturaKm;
  /** Km de viajes entre la lectura real y la fecha (negativo si la fecha es anterior). */
  rodados: number;
}

/**
 * El odómetro de un día reconstruido desde la lectura real más cercana y los
 * km de viajes. `null` si no hay lectura real o si algún mes del tramo no
 * tiene dato de viajes (un mes con error no se puede dar por «no rodó»).
 */
export function reconstruir(fecha: string, lecturas: LecturaKm[], meses: MesTelematica[], hoy?: string): Reconstruido | null {
  return reconstruirDesde(fecha, anclas(lecturas), meses, hoy);
}

/** Igual que `reconstruir`, con las lecturas reales ya depuradas (para no repetirlo en bucle). */
function reconstruirDesde(fecha: string, lasAnclas: LecturaKm[], meses: MesTelematica[], hoy?: string): Reconstruido | null {
  const conDato = new Set(meses.map((m) => `${m.year}-${pad(m.month)}`));
  const candidatas = lasAnclas
    .map((l) => ({ l, d: Math.abs(diasEntre(l.fecha, fecha)) }))
    .sort((a, b) => a.d - b.d || (a.l.fecha <= fecha ? -1 : 1));
  for (const { l } of candidatas) {
    if (l.fecha === fecha) return { km: Math.round(l.km), fecha, ancla: l, rodados: 0 };
    // Del mes de la lectura no hace falta dato si la fecha cae en el mismo mes y no rodó…
    // pero sin dato de viajes no se sabe; se exige en todo el tramo.
    if (!mesesDelTramo(l.fecha, fecha).every((m) => conDato.has(m))) continue;
    const rodados = l.fecha < fecha ? kmRodadosEntre(l.fecha, fecha, meses, hoy) : -kmRodadosEntre(fecha, l.fecha, meses, hoy);
    return { km: Math.round(l.km + rodados), fecha, ancla: l, rodados: Math.round(rodados) };
  }
  return null;
}

/** ¿Dos odómetros dicen lo mismo? Con holgura: la distancia GPS no es exacta. */
const cuadran = (a: number, b: number) => Math.abs(a - b) <= Math.max(500, 0.03 * Math.max(a, b));

export interface OdometroMes {
  year: number;
  month: number;
  /** Odómetro al empezar el mes (fin del día anterior al 1). */
  inicio: number | null;
  cierre: number | null;
  fuenteInicio: "movertis" | "reconstruido" | null;
  fuenteCierre: "movertis" | "reconstruido" | null;
  /** Lo que daba Movertis cuando no cuadra con lo reconstruido (para tacharlo). */
  movertisInicio: number | null;
  movertisCierre: number | null;
}

const ultimoDia = (y: number, m: number) => `${y}-${pad(m)}-${pad(diasDelMes(y, m))}`;
const diaAnteriorAl1 = (y: number, m: number) => (m === 1 ? ultimoDia(y - 1, 12) : ultimoDia(y, m - 1));

/**
 * Los odómetros de cada mes: el de Movertis si cuadra con lo reconstruido (o
 * si no hay con qué contrastarlo y es posible), y si no, el reconstruido.
 */
export function odometrosDeMeses(meses: MesTelematica[], lecturas: LecturaKm[], hoy?: string): OdometroMes[] {
  const lasAnclas = anclas(lecturas);
  return meses.map((m) => {
    const elegir = (mov: number | null, fecha: string | null) => {
      const rec = fecha ? reconstruirDesde(fecha, lasAnclas, meses, hoy) : null;
      const movOk = valido(mov) && mov < ODOMETRO_IMPOSIBLE_KM ? mov : null;
      if (movOk != null && (!rec || cuadran(movOk, rec.km))) return { km: movOk, fuente: "movertis" as const, tachado: null };
      if (rec) return { km: rec.km, fuente: "reconstruido" as const, tachado: valido(mov) ? mov : null };
      return { km: null, fuente: null, tachado: valido(mov) ? mov : null };
    };
    const i = elegir(m.inicial, diaAnteriorAl1(m.year, m.month));
    const c = m.cerrado ? elegir(m.final, ultimoDia(m.year, m.month)) : { km: null, fuente: null, tachado: null };
    return {
      year: m.year, month: m.month,
      inicio: i.km, cierre: c.km, fuenteInicio: i.fuente, fuenteCierre: c.fuente,
      movertisInicio: i.tachado, movertisCierre: c.tachado,
    };
  });
}

/**
 * Los meses con los odómetros de Movertis que no cuadran (o son imposibles)
 * quitados: la distancia se queda, que es lo fiable. Es lo que se le pasa a
 * todo lo demás para que un odómetro malo no se cuele como lectura.
 */
export function mesesDepurados(meses: MesTelematica[], lecturas: LecturaKm[], hoy?: string): MesTelematica[] {
  const odos = odometrosDeMeses(meses, lecturas, hoy);
  return meses.map((m, i) => ({
    ...m,
    inicial: odos[i].fuenteInicio === "movertis" ? m.inicial : null,
    final: odos[i].fuenteCierre === "movertis" ? m.final : null,
  }));
}

/** Cuánto se aleja como mucho una lectura vecina para interpolar entre dos. */
export const MAX_DIAS_INTERPOLAR = 62;

/**
 * Los km en una fecha, sin preguntar al proveedor: lectura real de ese día,
 * entre dos lecturas cercanas o estimado con los km del mes, siempre con las
 * lecturas que cuadran entre sí. La telemática exacta la pide el router ANTES
 * de llamar a esto; esto es lo que queda si el proveedor no la da.
 */
export function kmEnFecha(fecha: string, lecturas: LecturaKm[], mesesBrutos: MesTelematica[], hoy?: string): KmEnFecha {
  const meses = mesesDepurados(mesesBrutos, lecturas, hoy);
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
    // Repartido según los viajes de cada día si los hay; si no, en línea recta.
    const viajesTotal = kmRodadosEntre(antes.fecha, despues.fecha, meses, hoy);
    const total = diasEntre(antes.fecha, despues.fecha);
    const parte = viajesTotal > 0
      ? kmRodadosEntre(antes.fecha, fecha, meses, hoy) / viajesTotal
      : total === 0 ? 0 : diasEntre(antes.fecha, fecha) / total;
    const km = antes.km + (despues.km - antes.km) * parte;
    return { tipo: "interpolado", km: Math.round(km), fecha, anterior: antes, siguiente: despues };
  }

  // 3. Reconstruido: la lectura real más cercana ± los km de viajes.
  const rec = reconstruir(fecha, lecturas, meses, hoy);
  if (rec) {
    const fmt = (n: number) => Math.round(n).toLocaleString("es-ES");
    return {
      tipo: "reconstruido", km: rec.km, fecha, ancla: rec.ancla, rodados: rec.rodados,
      detalle: `${rec.ancla.detalle} (${fmt(rec.ancla.km)}) ${rec.rodados >= 0 ? "+" : "−"} ${fmt(Math.abs(rec.rodados))} km de viajes`,
    };
  }

  // 4. Estimado con el mes: odómetro del día 1 + lo que rodó, repartido por días.
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
