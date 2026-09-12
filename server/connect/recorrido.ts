/**
 * Kilómetros recorridos, a partir del rastro GPS del móvil.
 *
 * Hasta ahora los kilómetros del servicio los teclea una persona, y lo normal
 * es que lleguen a cero. El rastro ya está guardado —`connect_assistance_tracks`
 * para Lite, `roadside_operator_track` para la app del técnico de Assist—, así
 * que la cifra se puede calcular en vez de preguntarla.
 *
 * LA SUMA CRUDA NO VALE. Un GPS parado no está quieto: la deriva de un
 * receptor en el arcén inventa varios kilómetros a lo largo de una hora de
 * trabajo, y eso acabaría en una factura. Por eso antes de sumar se filtra:
 *
 *   · Fuera los puntos con la precisión que dice el propio receptor por encima
 *     de PRECISION_MAXIMA_M. Un punto con ±200 m no sitúa nada.
 *   · Fuera los saltos imposibles: si entre dos puntos sale una velocidad
 *     mayor que VELOCIDAD_IMPOSIBLE_KMH, el que salta es el GPS, no la
 *     furgoneta.
 *   · No se suman los tramos por debajo de TRAMO_MINIMO_M. Es la deriva del
 *     aparato quieto; sumarla es cobrar por estar parado.
 *
 * Y se dice SIEMPRE lo que no se sabe. Un rastro con agujeros —permiso
 * denegado, app matada por el sistema, un tramo sin cobertura que no llegó a
 * recuperarse— da de menos, y eso no se nota mirando el número. Por eso se
 * devuelven los huecos junto a la cifra: quien decide facturarla tiene que
 * poder ver de qué se fía.
 */

import { haversineMeters } from "./liteRules.ts";

/** Por encima de esto el punto no sitúa nada: se descarta. */
export const PRECISION_MAXIMA_M = 50;
/** Entre dos puntos, una velocidad mayor es un salto del receptor. */
export const VELOCIDAD_IMPOSIBLE_KMH = 200;
/** Por debajo de esto es deriva del aparato quieto, no desplazamiento. */
export const TRAMO_MINIMO_M = 25;
/** Silencio mayor que esto entre dos puntos: hueco del que no se sabe nada. */
export const HUECO_MINIMO_MS = 5 * 60_000;

export interface PuntoRastro {
  lat: number;
  lng: number;
  ts: number;
  accuracyM?: number | null;
  /** Estado de la asistencia cuando se registró, si se conoce. */
  status?: string | null;
}

export interface Hueco {
  desdeMs: number;
  hastaMs: number;
  minutos: number;
  /** Lo que se recorrió en línea recta durante el silencio: el mínimo perdido. */
  kmEnLineaRecta: number;
}

export interface Recorrido {
  /** Kilómetros por tramo del servicio, ya filtrados. */
  ida: number;
  trabajo: number;
  vuelta: number;
  otros: number;
  total: number;
  /** Lo que se propone como kilómetros del servicio: ida y vuelta. */
  propuestaKm: number;
  puntos: number;
  puntosDescartados: number;
  huecos: Hueco[];
  /** Minutos de rastro que faltan, sumando los huecos. */
  minutosSinRastro: number;
  desdeMs: number | null;
  hastaMs: number | null;
  /** Qué tal está el rastro: 'bueno' | 'con_huecos' | 'insuficiente'. */
  calidad: "bueno" | "con_huecos" | "insuficiente";
}

/* Los estados en los que la furgoneta se está moviendo por el servicio. */
const IDA = new Set(["en_route", "en_camino", "asignada", "assigned"]);
const TRABAJO = new Set(["arrived", "in_progress", "en_punto", "inicio_reparacion"]);
const VUELTA = new Set(["returning_to_workshop", "en_camino_base"]);

function tramoDe(status: string | null | undefined): "ida" | "trabajo" | "vuelta" | "otros" {
  const s = String(status ?? "");
  if (IDA.has(s)) return "ida";
  if (TRABAJO.has(s)) return "trabajo";
  if (VUELTA.has(s)) return "vuelta";
  return "otros";
}

const redondear = (km: number) => Math.round(km * 100) / 100;

/**
 * Calcula el recorrido a partir de los puntos, ya ordenados por hora.
 *
 * Es una función pura a propósito: es donde está el criterio que acaba en una
 * factura, y tiene que poder probarse con puntos inventados sin base de datos
 * de por medio.
 */
export function calcularRecorrido(puntos: PuntoRastro[]): Recorrido {
  const km = { ida: 0, trabajo: 0, vuelta: 0, otros: 0 };
  const huecos: Hueco[] = [];

  const utiles = puntos
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.ts))
    .filter((p) => p.accuracyM == null || p.accuracyM <= PRECISION_MAXIMA_M)
    .sort((a, b) => a.ts - b.ts);

  let descartados = puntos.length - utiles.length;
  let anterior: PuntoRastro | null = null;

  for (const p of utiles) {
    if (!anterior) { anterior = p; continue; }

    const metros = haversineMeters(anterior.lat, anterior.lng, p.lat, p.lng);
    const segundos = (p.ts - anterior.ts) / 1000;

    // Salto del receptor: ni se suma, ni se toma como referencia para el
    // siguiente tramo, porque arrastraría el error.
    if (segundos > 0 && (metros / segundos) * 3.6 > VELOCIDAD_IMPOSIBLE_KMH) {
      descartados++;
      continue;
    }

    // Silencio largo: se anota el hueco. La distancia en línea recta de ese
    // salto SÍ se suma, porque el vehículo estuvo allí de verdad; es el
    // mínimo que recorrió, nunca de más.
    if (p.ts - anterior.ts >= HUECO_MINIMO_MS) {
      huecos.push({
        desdeMs: anterior.ts,
        hastaMs: p.ts,
        minutos: Math.round((p.ts - anterior.ts) / 60_000),
        kmEnLineaRecta: redondear(metros / 1000),
      });
    }

    if (metros >= TRAMO_MINIMO_M) {
      // El tramo cuenta en el estado en el que EMPEZÓ: el cambio de estado lo
      // marca el operario al llegar, así que el trayecto es del estado previo.
      km[tramoDe(anterior.status)] += metros / 1000;
    }
    anterior = p;
  }

  const total = km.ida + km.trabajo + km.vuelta + km.otros;
  const minutosSinRastro = huecos.reduce((s, h) => s + h.minutos, 0);

  const calidad: Recorrido["calidad"] =
    utiles.length < 5 ? "insuficiente"
    : huecos.length > 0 ? "con_huecos"
    : "bueno";

  return {
    ida: redondear(km.ida),
    trabajo: redondear(km.trabajo),
    vuelta: redondear(km.vuelta),
    otros: redondear(km.otros),
    total: redondear(total),
    // Ida y vuelta: es lo que consume la furgoneta. Lo que se hace dentro del
    // punto de servicio no es desplazamiento y no se propone cobrarlo.
    propuestaKm: Math.round(km.ida + km.vuelta),
    puntos: utiles.length,
    puntosDescartados: descartados,
    huecos,
    minutosSinRastro,
    desdeMs: utiles[0]?.ts ?? null,
    hastaMs: utiles[utiles.length - 1]?.ts ?? null,
    calidad,
  };
}

/**
 * Reparte los puntos por el estado en que estaba la asistencia a esa hora.
 *
 * El rastro de la app del técnico de Assist solo guarda punto y hora: no
 * lleva el estado dentro, como sí hace el de Lite. Pero el historial de
 * estados tiene la hora de cada cambio, así que el estado de un punto es el
 * del último cambio anterior a él. Con eso sale el mismo desglose —ida,
 * trabajo, vuelta— sin tocar la app ni pedirle nada más al técnico.
 */
export function conEstadoDelHistorial(
  puntos: PuntoRastro[],
  historial: Array<{ status: string; ts: number }>,
): PuntoRastro[] {
  const cambios = [...historial].sort((a, b) => a.ts - b.ts);
  return puntos.map((p) => {
    let estado: string | null = null;
    for (const c of cambios) {
      if (c.ts > p.ts) break;
      estado = c.status;
    }
    return { ...p, status: estado };
  });
}

/**
 * El rastro de una asistencia de Connect.
 *
 * Se mira primero el de Lite, que es el completo —lleva precisión y el estado
 * de cada punto— y, si no hay, el de la app del técnico de Assist a través de
 * la asistencia del core. Ese solo guarda punto y hora: sin precisión, el
 * filtro de puntos malos no puede actuar y solo queda el de saltos, así que
 * sale una cifra algo más ruidosa. Se dice en `origen` para que quien la mire
 * sepa de qué se fía.
 */
export async function recorridoDeAsistencia(
  assistanceId: number,
): Promise<(Recorrido & { origen: "lite" | "assist" | "sin_rastro" }) | null> {
  // La base se pide aquí y no arriba: así el cálculo —que es lo que hay que
  // poder probar— no arrastra la conexión ni exige DATABASE_URL.
  const db = (await import("../db.ts")).default;
  const lite = await db.query(
    `SELECT lat, lng, "accuracyM", status, "deviceTsMs" AS ts
       FROM connect_assistance_tracks
      WHERE "assistanceId" = $1
      ORDER BY "deviceTsMs"`,
    [assistanceId],
  );
  if (lite.rows.length > 0) {
    return {
      ...calcularRecorrido(lite.rows.map((r: any) => ({
        lat: Number(r.lat), lng: Number(r.lng), ts: Number(r.ts),
        accuracyM: r.accuracyM == null ? null : Number(r.accuracyM),
        status: r.status,
      }))),
      origen: "lite",
    };
  }

  const core = await db.query(
    `SELECT ca."coreAssistanceId" AS id FROM connect_assistances ca WHERE ca.id = $1`,
    [assistanceId],
  );
  const coreId = core.rows[0]?.id;
  if (coreId != null) {
    const r = await recorridoDeAsistenciaCore(Number(coreId));
    if (r.puntos > 0) return { ...r, origen: "assist" };
  }

  return { ...calcularRecorrido([]), origen: "sin_rastro" };
}

/**
 * El rastro de una asistencia de Mobilink Assist, por su id del core.
 *
 * Sirve tanto al panel de Assist como al espejo de Connect: es el mismo
 * rastro y el mismo criterio, y tenerlo en un solo sitio evita que dentro de
 * un año los dos paneles enseñen kilómetros distintos del mismo servicio.
 */
export async function recorridoDeAsistenciaCore(coreAssistanceId: number): Promise<Recorrido> {
  const db = (await import("../db.ts")).default;
  const [puntos, historial] = await Promise.all([
    db.query(
      `SELECT lat, lng, ts FROM roadside_operator_track
        WHERE "assistanceId" = $1 ORDER BY ts`,
      [coreAssistanceId],
    ),
    db.query(
      `SELECT status, "createdAtMs" AS ts FROM roadside_assistance_events
        WHERE "assistanceId" = $1 ORDER BY "createdAtMs"`,
      [coreAssistanceId],
    ),
  ]);
  return calcularRecorrido(conEstadoDelHistorial(
    puntos.rows.map((r: any) => ({ lat: Number(r.lat), lng: Number(r.lng), ts: Number(r.ts) })),
    historial.rows.map((r: any) => ({ status: String(r.status), ts: Number(r.ts) })),
  ));
}
