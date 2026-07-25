/**
 * Centro de Inteligencia Operacional — modelos predictivos v1.
 *
 * Tres modelos, todos explicables y auditables (cap. 16 del diseño): cada
 * predicción guarda en ai_prediction las variables que ha usado y, cuando se
 * conoce el resultado real, su error. Esa comparación previsión/realidad es la
 * que alimenta la mejora continua y el reentrenamiento.
 *
 *   1. Demanda   — media estacional por zona y franja (naive estacional + IC 80 %).
 *   2. ETA       — distancia real corregida por tráfico horario y por el
 *                  histórico de llegadas del taller.
 *   3. Riesgo de retraso — puntuación 0..1 por reglas ponderadas sobre el
 *                  tiempo de SLA restante, la posición de la unidad y el
 *                  rendimiento histórico del proveedor.
 *
 * No se usa ningún servicio externo: son modelos estadísticos sobre los datos
 * del propio centro de control, sin exponer datos de un cliente a otro.
 */

import db from "../../db.ts";

const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades geográficas y de zona
// ─────────────────────────────────────────────────────────────────────────────

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface Zone {
  id: string;          // "ws:<workshopId>" o "far" si no hay taller cercano
  label: string;
  latitude: number;
  longitude: number;
  workshopId: number | null;
}

/**
 * Las zonas se derivan de la red existente: cada asistencia pertenece a la zona
 * del taller más cercano. Así no hay que mantener un catálogo geográfico nuevo
 * y las recomendaciones de cobertura se expresan en términos que el operador ya
 * conoce ("área de <taller>").
 */
export async function loadZones(): Promise<Zone[]> {
  const r = await db.query(
    `SELECT id, name, latitude, longitude FROM connect_workshops WHERE "connectStatus" <> 'excluded'`,
  );
  return r.rows.map((w) => ({
    id: `ws:${w.id}`,
    label: `Área de ${w.name}`,
    latitude: Number(w.latitude),
    longitude: Number(w.longitude),
    workshopId: w.id as number,
  }));
}

export function zoneFor(zones: Zone[], lat: number | null, lng: number | null): Zone | null {
  if (lat == null || lng == null || !zones.length) return null;
  let best: Zone | null = null;
  let bestKm = Infinity;
  for (const z of zones) {
    const km = haversineKm(lat, lng, z.latitude, z.longitude);
    if (km < bestKm) { bestKm = km; best = z; }
  }
  return bestKm <= 120 ? best : null; // más de 120 km: fuera del área operada
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Predicción de demanda
// ─────────────────────────────────────────────────────────────────────────────

export interface DemandForecastSlot {
  zoneId: string;
  zoneLabel: string;
  workshopId: number | null;
  targetAtMs: number;
  hour: number;
  predicted: number;
  confidenceMin: number;
  confidenceMax: number;
  confidenceScore: number;   // 0..1 según tamaño de muestra
  vsAveragePct: number | null;
  sampleSize: number;
  recommendedUnits: number;
  factors: string[];
}

interface HistoricalPoint { zoneId: string; dayStart: number; hour: number; weekday: number; count: number }

/** Histórico de asistencias por zona, día y hora (ventana de N días). */
async function loadDemandHistory(days: number, serviceType?: string | null): Promise<{ zones: Zone[]; points: HistoricalPoint[] }> {
  const zones = await loadZones();
  const since = Date.now() - days * DAY_MS;
  const params: unknown[] = [since];
  let where = `ca."createdAtMs" >= $1 AND ca.status <> 'draft' AND ca.latitude IS NOT NULL AND ca.longitude IS NOT NULL`;
  if (serviceType) { params.push(serviceType); where += ` AND ca."serviceType" = $${params.length}`; }

  const r = await db.query(
    `SELECT ca.latitude, ca.longitude, ca."createdAtMs" FROM connect_assistances ca WHERE ${where}`,
    params,
  );

  const buckets = new Map<string, HistoricalPoint>();
  for (const row of r.rows) {
    const z = zoneFor(zones, Number(row.latitude), Number(row.longitude));
    if (!z) continue;
    const ts = Number(row.createdAtMs);
    const d = new Date(ts);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const hour = d.getHours();
    const key = `${z.id}|${dayStart}|${hour}`;
    const prev = buckets.get(key);
    if (prev) prev.count++;
    else buckets.set(key, { zoneId: z.id, dayStart, hour, weekday: d.getDay(), count: 1 });
  }
  return { zones, points: [...buckets.values()] };
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Previsión para las próximas `hours` horas: para cada zona y franja horaria se
 * toma el histórico de esa misma franja y día de la semana. Si la muestra es
 * pequeña se mezcla con la media de la franja en cualquier día (suavizado), y
 * la confianza publicada baja en consecuencia.
 */
export async function forecastDemand(opts: {
  hours?: number;
  historyDays?: number;
  serviceType?: string | null;
  zoneId?: string | null;
} = {}): Promise<DemandForecastSlot[]> {
  const hours = Math.min(opts.hours ?? 12, 72);
  const historyDays = opts.historyDays ?? 90;
  const { zones, points } = await loadDemandHistory(historyDays, opts.serviceType);
  if (!zones.length) return [];

  // Índices: por (zona, weekday, hora) y por (zona, hora)
  const byWeekdayHour = new Map<string, number[]>();
  const byHour = new Map<string, number[]>();
  const daysObserved = new Map<string, Set<number>>();
  for (const p of points) {
    const k1 = `${p.zoneId}|${p.weekday}|${p.hour}`;
    const k2 = `${p.zoneId}|${p.hour}`;
    (byWeekdayHour.get(k1) ?? byWeekdayHour.set(k1, []).get(k1)!).push(p.count);
    (byHour.get(k2) ?? byHour.set(k2, []).get(k2)!).push(p.count);
    const ds = daysObserved.get(p.zoneId) ?? daysObserved.set(p.zoneId, new Set()).get(p.zoneId)!;
    ds.add(p.dayStart);
  }

  // Las franjas sin ninguna asistencia no generan fila histórica: se completan
  // con ceros usando el número de días observados, o el histórico se sesgaría al alza.
  const observedDays = Math.max(1, Math.round(historyDays));
  const fill = (samples: number[], expected: number): number[] => {
    const zeros = Math.max(0, expected - samples.length);
    return zeros > 0 ? samples.concat(new Array(zeros).fill(0)) : samples;
  };

  const now = Date.now();
  const out: DemandForecastSlot[] = [];
  const targetZones = opts.zoneId ? zones.filter((z) => z.id === opts.zoneId) : zones;

  for (const z of targetZones) {
    const zoneAll = [...byHour.entries()].filter(([k]) => k.startsWith(`${z.id}|`)).flatMap(([, v]) => v);
    const zoneHourlyMean = zoneAll.length ? mean(fill(zoneAll, observedDays * 24)) : 0;

    for (let i = 1; i <= hours; i++) {
      const target = new Date(now + i * HOUR_MS);
      target.setMinutes(0, 0, 0);
      const hour = target.getHours();
      const weekday = target.getDay();

      const rawWeekday = byWeekdayHour.get(`${z.id}|${weekday}|${hour}`) ?? [];
      const rawHour = byHour.get(`${z.id}|${hour}`) ?? [];
      // Franjas sin asistencias también son información: se completan con ceros
      // hasta el número de ocurrencias que hubo en la ventana histórica.
      const sameWeekday = fill(rawWeekday, Math.floor(observedDays / 7));
      const sameHour = fill(rawHour, observedDays);

      // La confianza se mide con las observaciones REALES (no con los ceros)
      const nSeason = rawWeekday.length;
      // Peso del componente estacional según la muestra (k = 4 observaciones)
      const w = nSeason / (nSeason + 4);
      const predicted = w * mean(sameWeekday) + (1 - w) * mean(sameHour);
      const sd = Math.max(stddev(nSeason >= 3 ? sameWeekday : sameHour), 0.4);
      const confidenceScore = Math.round(Math.min(1, nSeason / 8) * 100) / 100;

      const factors: string[] = [
        `Histórico de ${historyDays} días en ${z.label}`,
        `${nSeason} observaciones del mismo día de la semana y franja`,
      ];
      if (opts.serviceType) factors.push(`Filtrado por tipo de servicio ${opts.serviceType}`);
      const isWeekend = weekday === 0 || weekday === 6;
      if (isWeekend) factors.push("Franja de fin de semana");
      if (hour >= 7 && hour <= 9) factors.push("Hora punta de mañana");
      if (hour >= 17 && hour <= 20) factors.push("Hora punta de tarde");

      out.push({
        zoneId: z.id,
        zoneLabel: z.label,
        workshopId: z.workshopId,
        targetAtMs: target.getTime(),
        hour,
        predicted: Math.round(predicted * 10) / 10,
        confidenceMin: Math.max(0, Math.round((predicted - 1.28 * sd) * 10) / 10),
        confidenceMax: Math.round((predicted + 1.28 * sd) * 10) / 10,
        confidenceScore,
        vsAveragePct: zoneHourlyMean > 0 ? Math.round(((predicted - zoneHourlyMean) / zoneHourlyMean) * 1000) / 10 : null,
        sampleSize: nSeason,
        // Una unidad cubre ~1,5 asistencias/hora; se redondea al alza
        recommendedUnits: Math.max(0, Math.ceil(predicted / 1.5)),
        factors,
      });
    }
  }
  return out;
}

/** Persiste la previsión del día para poder medir después su precisión. */
export async function persistDemandForecast(slots: DemandForecastSlot[]): Promise<number> {
  const now = Date.now();
  let n = 0;
  for (const s of slots) {
    await db.query(
      `INSERT INTO ai_prediction
         ("predictionType","entityType","entityId","predictedValue","confidenceMin","confidenceMax",
          "confidenceScore","predictionAtMs","targetAtMs","modelVersion","inputReference","createdAtMs")
       VALUES ('demand','zone',$1,$2,$3,$4,$5,$6,$7,'v1',$8,$6)`,
      [
        s.zoneId, s.predicted, s.confidenceMin, s.confidenceMax, s.confidenceScore,
        now, s.targetAtMs,
        JSON.stringify({ zoneLabel: s.zoneLabel, hour: s.hour, sampleSize: s.sampleSize, factors: s.factors }),
      ],
    );
    n++;
  }
  return n;
}

/** Compara la demanda prevista con la real ya ocurrida (aprendizaje continuo). */
export async function evaluateDemandPredictions(): Promise<number> {
  const now = Date.now();
  const pending = await db.query(
    `SELECT id, "entityId", "predictedValue", "targetAtMs" FROM ai_prediction
      WHERE "predictionType" = 'demand' AND "evaluatedAtMs" IS NULL AND "targetAtMs" < $1
      ORDER BY id LIMIT 500`,
    [now - HOUR_MS],
  );
  if (!pending.rows.length) return 0;
  const zones = await loadZones();

  for (const p of pending.rows) {
    const from = Number(p.targetAtMs);
    const to = from + HOUR_MS;
    const r = await db.query(
      `SELECT latitude, longitude FROM connect_assistances
        WHERE "createdAtMs" >= $1 AND "createdAtMs" < $2 AND status <> 'draft'
          AND latitude IS NOT NULL AND longitude IS NOT NULL`,
      [from, to],
    );
    let actual = 0;
    for (const row of r.rows) {
      const z = zoneFor(zones, Number(row.latitude), Number(row.longitude));
      if (z && z.id === p.entityId) actual++;
    }
    await db.query(
      `UPDATE ai_prediction SET "actualValue" = $1, "errorValue" = $1 - "predictedValue", "evaluatedAtMs" = $2 WHERE id = $3`,
      [actual, now, p.id],
    );
  }
  return pending.rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Predicción del ETA
// ─────────────────────────────────────────────────────────────────────────────

export interface EtaPrediction {
  assistanceId: number;
  etaMinutes: number;
  confidenceMin: number;
  confidenceMax: number;
  confidenceScore: number;
  distanceKm: number | null;
  origin: "mobile_unit" | "workshop" | "none";
  factors: Array<{ name: string; value: string; effect: string }>;
  explanation: string;
}

/** Factor de tráfico por hora del día (1 = fluido). */
function trafficFactor(date: Date): { factor: number; label: string } {
  const h = date.getHours();
  const weekend = date.getDay() === 0 || date.getDay() === 6;
  if (weekend) return { factor: 0.95, label: "fin de semana, tráfico fluido" };
  if (h >= 7 && h <= 9) return { factor: 1.25, label: "hora punta de mañana" };
  if (h >= 17 && h <= 20) return { factor: 1.3, label: "hora punta de tarde" };
  if (h >= 23 || h <= 5) return { factor: 0.85, label: "tráfico nocturno" };
  return { factor: 1, label: "tráfico normal" };
}

/** Minutos de preparación antes de salir, por tipo de servicio. */
const PREP_MINUTES: Record<string, number> = {
  tow_truck: 8, heavy_vehicle: 12, machinery: 12, electric_vehicle: 6,
  mechanical: 5, tyres: 6, battery: 4, fuel: 4, lockout: 4, other: 5,
};

/**
 * ETA avanzado de una asistencia. Usa la posición real de la unidad móvil
 * cuando existe y, si no, la del taller asignado. Corrige con el ratio
 * histórico real/previsto del taller, que es el aprendizaje del modelo.
 */
export async function predictEta(assistanceId: number, opts: { persist?: boolean } = {}): Promise<EtaPrediction | null> {
  const r = await db.query(
    `SELECT ca.id, ca.latitude, ca.longitude, ca."serviceType", ca.priority, ca.status,
            ca."workshopId", ca."locationDetails",
            w.name AS workshop_name, w.latitude AS w_lat, w.longitude AS w_lng,
            mu.id AS unit_id, mu.name AS unit_name, mu.latitude AS u_lat, mu.longitude AS u_lng,
            mu."lastReportAtMs", mu.status AS unit_status
       FROM connect_assistances ca
       LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN connect_mobile_units mu ON mu."activeAssistanceId" = ca.id
      WHERE ca.id = $1 LIMIT 1`,
    [assistanceId],
  );
  const a = r.rows[0];
  if (!a) return null;

  const factors: EtaPrediction["factors"] = [];
  const now = new Date();

  let originLat: number | null = null;
  let originLng: number | null = null;
  let origin: EtaPrediction["origin"] = "none";
  if (a.u_lat != null && a.u_lng != null) {
    originLat = Number(a.u_lat); originLng = Number(a.u_lng); origin = "mobile_unit";
    factors.push({ name: "Origen", value: `Unidad ${a.unit_name}`, effect: "posición GPS real de la unidad" });
  } else if (a.w_lat != null && a.w_lng != null) {
    originLat = Number(a.w_lat); originLng = Number(a.w_lng); origin = "workshop";
    factors.push({ name: "Origen", value: a.workshop_name, effect: "base del taller (sin GPS de unidad)" });
  }

  if (originLat == null || originLng == null || a.latitude == null || a.longitude == null) {
    return {
      assistanceId, etaMinutes: 0, confidenceMin: 0, confidenceMax: 0, confidenceScore: 0,
      distanceKm: null, origin, factors,
      explanation: "No se puede calcular el ETA: falta la posición del punto de asistencia o del recurso asignado.",
    };
  }

  const straightKm = haversineKm(originLat, originLng, Number(a.latitude), Number(a.longitude));
  const roadKm = straightKm * 1.4; // factor de red viaria sobre la distancia recta
  factors.push({ name: "Distancia", value: `${Math.round(roadKm * 10) / 10} km por carretera`, effect: `${Math.round(straightKm * 10) / 10} km en línea recta × 1,4` });

  const traffic = trafficFactor(now);
  factors.push({ name: "Tráfico", value: traffic.label, effect: `×${traffic.factor}` });

  const details = safeJson(a.locationDetails);
  const onHighway = typeof details?.road === "string" && /^(ap|a|ae|e)-?\d/i.test(details.road.trim());
  const speedKmh = (onHighway ? 85 : 58) / traffic.factor;
  if (onHighway) factors.push({ name: "Tipo de vía", value: `Autovía/autopista ${details.road}`, effect: "velocidad media superior" });

  const prep = PREP_MINUTES[String(a.serviceType)] ?? 5;
  factors.push({ name: "Preparación", value: `${prep} min`, effect: `tipo de servicio ${a.serviceType}` });

  // Aprendizaje: ratio entre el tiempo real de llegada y el previsto del taller
  let learnFactor = 1;
  let learnSample = 0;
  if (a.workshopId) {
    const hist = await db.query(
      `SELECT AVG(act.min) AS avg_real, COUNT(*)::int AS n
         FROM connect_assistances ca
         JOIN LATERAL (
           SELECT (arr."occurredAtMs" - asg."occurredAtMs")/60000.0 AS min
             FROM connect_status_history asg
             JOIN connect_status_history arr ON arr."assistanceId" = asg."assistanceId" AND arr."toStatus" = 'arrived'
            WHERE asg."assistanceId" = ca.id AND asg."toStatus" = 'assigned' LIMIT 1) act ON true
        WHERE ca."workshopId" = $1 AND ca."createdAtMs" >= $2`,
      [a.workshopId, Date.now() - 90 * DAY_MS],
    );
    learnSample = hist.rows[0].n ?? 0;
    const avgReal = hist.rows[0].avg_real != null ? Number(hist.rows[0].avg_real) : null;
    if (avgReal != null && learnSample >= 5) {
      const baseline = (roadKm / speedKmh) * 60 + prep;
      const ratio = avgReal / Math.max(baseline, 1);
      learnFactor = Math.min(2.5, Math.max(0.6, ratio));
      factors.push({
        name: "Histórico del proveedor",
        value: `${Math.round(avgReal)} min de media real (${learnSample} servicios)`,
        effect: `×${Math.round(learnFactor * 100) / 100}`,
      });
    }
  }

  const eta = Math.max(3, Math.round(((roadKm / speedKmh) * 60 + prep) * learnFactor));
  // Confianza: sube con la muestra histórica y con tener GPS de la unidad
  const confidenceScore = Math.round(Math.min(1, (learnSample / 20) * 0.7 + (origin === "mobile_unit" ? 0.3 : 0.1)) * 100) / 100;
  const spread = Math.max(4, Math.round(eta * (0.35 - 0.2 * confidenceScore)));

  const prediction: EtaPrediction = {
    assistanceId,
    etaMinutes: eta,
    confidenceMin: Math.max(1, eta - spread),
    confidenceMax: eta + spread,
    confidenceScore,
    distanceKm: Math.round(roadKm * 10) / 10,
    origin,
    factors,
    explanation:
      `ETA de ${eta} min: ${Math.round(roadKm)} km desde ${origin === "mobile_unit" ? `la unidad ${a.unit_name}` : a.workshop_name ?? "la base"}` +
      ` a ${Math.round(speedKmh)} km/h medios (${traffic.label}), ${prep} min de preparación` +
      (learnFactor !== 1 ? ` y corrección ×${Math.round(learnFactor * 100) / 100} por el histórico real del proveedor.` : "."),
  };

  if (opts.persist) {
    await db.query(
      `INSERT INTO ai_prediction
         ("predictionType","entityType","entityId","predictedValue","confidenceMin","confidenceMax",
          "confidenceScore","predictionAtMs","targetAtMs","modelVersion","inputReference","createdAtMs")
       VALUES ('eta','assistance',$1,$2,$3,$4,$5,$6,$7,'v1',$8,$6)`,
      [
        String(assistanceId), eta, prediction.confidenceMin, prediction.confidenceMax, confidenceScore,
        Date.now(), Date.now() + eta * 60_000,
        JSON.stringify({ factors, distanceKm: prediction.distanceKm, origin, explanation: prediction.explanation }),
      ],
    );
  }
  return prediction;
}

/**
 * Cierra las predicciones de ETA con la llegada real: guarda los dos valores
 * (ETA comunicado y llegada real) y su error, que es lo que mide la precisión.
 */
export async function evaluateEtaPredictions(): Promise<number> {
  const now = Date.now();
  const pending = await db.query(
    `SELECT p.id, p."entityId", p."predictedValue", p."predictionAtMs",
            arr."occurredAtMs" AS arrived_at
       FROM ai_prediction p
       JOIN connect_status_history arr
         ON arr."assistanceId" = p."entityId"::int AND arr."toStatus" = 'arrived'
      WHERE p."predictionType" = 'eta' AND p."evaluatedAtMs" IS NULL
        AND arr."occurredAtMs" >= p."predictionAtMs"
      ORDER BY p.id LIMIT 500`,
  );
  for (const p of pending.rows) {
    const actualMin = Math.round((Number(p.arrived_at) - Number(p.predictionAtMs)) / 60000);
    await db.query(
      `UPDATE ai_prediction SET "actualValue" = $1, "errorValue" = $1 - "predictedValue", "evaluatedAtMs" = $2 WHERE id = $3`,
      [actualMin, now, p.id],
    );
  }
  return pending.rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Riesgo de retraso
// ─────────────────────────────────────────────────────────────────────────────

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface DelayRisk {
  assistanceId: number;
  score: number;         // 0..1
  level: RiskLevel;
  minutesToDeadline: number | null;
  etaMinutes: number | null;
  factors: Array<{ name: string; weight: number; detail: string }>;
  explanation: string;
}

function levelFor(score: number): RiskLevel {
  if (score >= 0.8) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

/** Riesgo de todas las asistencias activas (lo refresca el worker cada minuto). */
export async function computeDelayRisks(opts: { persist?: boolean } = {}): Promise<DelayRisk[]> {
  const now = Date.now();
  const r = await db.query(
    `SELECT ca.id, ca.status, ca.priority, ca."serviceType", ca."createdAtMs",
            ca."slaDeadlineAtMs", ca."workshopId", ca.latitude, ca.longitude,
            w.name AS workshop_name, w."currentScore",
            mu.id AS unit_id, mu."lastReportAtMs", mu.latitude AS u_lat, mu.longitude AS u_lng,
            h.assigned_at, h.en_route_at
       FROM connect_assistances ca
       LEFT JOIN connect_workshops w ON w.id = ca."workshopId"
       LEFT JOIN connect_mobile_units mu ON mu."activeAssistanceId" = ca.id
       LEFT JOIN LATERAL (
         SELECT MIN("occurredAtMs") FILTER (WHERE "toStatus" = 'assigned') AS assigned_at,
                MIN("occurredAtMs") FILTER (WHERE "toStatus" = 'en_route') AS en_route_at
           FROM connect_status_history WHERE "assistanceId" = ca.id) h ON true
      WHERE ca.status IN ('pending','searching','awaiting_acceptance','assigned','technician_assigned','en_route')`,
  );

  // Saturación por zona: asistencias activas frente a unidades disponibles
  const zones = await loadZones();
  const saturation = await zoneSaturation();

  const risks: DelayRisk[] = [];
  for (const a of r.rows) {
    const factors: DelayRisk["factors"] = [];
    let score = 0;

    const deadline = a.slaDeadlineAtMs != null ? Number(a.slaDeadlineAtMs) : null;
    const minutesToDeadline = deadline != null ? Math.round((deadline - now) / 60000) : null;

    // ETA estimado con la posición actual del recurso
    let etaMinutes: number | null = null;
    if (a.latitude != null && a.longitude != null) {
      const originLat = a.u_lat != null ? Number(a.u_lat) : null;
      const originLng = a.u_lng != null ? Number(a.u_lng) : null;
      if (originLat != null && originLng != null) {
        const km = haversineKm(originLat, originLng, Number(a.latitude), Number(a.longitude)) * 1.4;
        etaMinutes = Math.round((km / 58) * 60 * trafficFactor(new Date(now)).factor);
      }
    }

    // Factor 1 — margen de SLA (el más determinante)
    if (minutesToDeadline != null) {
      const eta = etaMinutes ?? 25;
      const margin = minutesToDeadline - eta;
      let w = 0;
      if (margin < 0) w = 0.5;
      else if (margin < 10) w = 0.35;
      else if (margin < 25) w = 0.18;
      else if (margin < 45) w = 0.07;
      if (w > 0) {
        score += w;
        factors.push({
          name: "Margen de SLA", weight: w,
          detail: margin < 0
            ? `El ETA supera el límite de SLA en ${Math.abs(margin)} min`
            : `Solo quedan ${margin} min de margen sobre el límite de SLA`,
        });
      }
    } else {
      factors.push({ name: "SLA", weight: 0, detail: "La asistencia no tiene SLA definido" });
    }

    // Factor 2 — todavía sin asignar
    const ageMin = Math.round((now - Number(a.createdAtMs)) / 60000);
    if (["pending", "searching", "awaiting_acceptance"].includes(a.status)) {
      const w = ageMin > 30 ? 0.3 : ageMin > 15 ? 0.18 : ageMin > 7 ? 0.08 : 0.02;
      score += w;
      factors.push({ name: "Sin asignar", weight: w, detail: `${ageMin} min desde la recepción sin proveedor confirmado` });
    }

    // Factor 3 — asignada pero sin salir
    if (["assigned", "technician_assigned"].includes(a.status) && a.assigned_at && !a.en_route_at) {
      const waiting = Math.round((now - Number(a.assigned_at)) / 60000);
      if (waiting > 10) {
        const w = waiting > 25 ? 0.2 : 0.1;
        score += w;
        factors.push({ name: "Sin iniciar desplazamiento", weight: w, detail: `${waiting} min desde la asignación sin salir` });
      }
    }

    // Factor 4 — GPS obsoleto
    if (a.unit_id) {
      const last = a.lastReportAtMs != null ? Number(a.lastReportAtMs) : null;
      const staleMin = last != null ? Math.round((now - last) / 60000) : null;
      if (staleMin == null || staleMin > 15) {
        score += 0.12;
        factors.push({ name: "GPS", weight: 0.12, detail: staleMin == null ? "La unidad no reporta posición" : `Última posición hace ${staleMin} min` });
      }
    } else if (["assigned", "technician_assigned", "en_route"].includes(a.status)) {
      score += 0.08;
      factors.push({ name: "Sin unidad identificada", weight: 0.08, detail: "No hay unidad móvil vinculada a la asistencia" });
    }

    // Factor 5 — rendimiento histórico del proveedor
    const providerScore = a.currentScore != null ? Number(a.currentScore) : null;
    if (providerScore != null && providerScore < 70) {
      const w = providerScore < 55 ? 0.12 : 0.06;
      score += w;
      factors.push({ name: "Proveedor", weight: w, detail: `${a.workshop_name} tiene un score de ${Math.round(providerScore)}` });
    }

    // Factor 6 — saturación de la zona
    const z = zoneFor(zones, a.latitude != null ? Number(a.latitude) : null, a.longitude != null ? Number(a.longitude) : null);
    const sat = z ? saturation[z.id] : undefined;
    if (sat && sat.ratio > 1) {
      const w = sat.ratio > 2 ? 0.12 : 0.06;
      score += w;
      factors.push({ name: "Saturación de zona", weight: w, detail: `${z!.label}: ${sat.active} servicios activos y ${sat.availableUnits} unidades disponibles` });
    }

    // Factor 7 — prioridad urgente
    if (a.priority === "urgente") {
      score += 0.05;
      factors.push({ name: "Prioridad", weight: 0.05, detail: "Servicio marcado como urgente" });
    }

    score = Math.min(1, Math.round(score * 100) / 100);
    const level = levelFor(score);
    const top = [...factors].sort((x, y) => y.weight - x.weight).slice(0, 2).map((x) => x.detail);

    risks.push({
      assistanceId: a.id,
      score,
      level,
      minutesToDeadline,
      etaMinutes,
      factors,
      explanation: top.length
        ? `Riesgo ${level} (${Math.round(score * 100)} %): ${top.join("; ")}.`
        : `Riesgo ${level}: no se detectan factores de retraso.`,
    });

    if (opts.persist) {
      await db.query(
        `INSERT INTO ai_prediction
           ("predictionType","entityType","entityId","predictedValue","confidenceScore",
            "predictionAtMs","targetAtMs","modelVersion","inputReference","createdAtMs")
         VALUES ('delay_risk','assistance',$1,$2,$3,$4,$5,'v1',$6,$4)`,
        [
          String(a.id), score, 0.6, now, deadline ?? now + 3600_000,
          JSON.stringify({ level, factors, etaMinutes, minutesToDeadline }),
        ],
      );
    }
  }
  return risks.sort((x, y) => y.score - x.score);
}

/** Riesgo de una asistencia concreta (endpoint por servicio). */
export async function delayRiskFor(assistanceId: number): Promise<DelayRisk | null> {
  const all = await computeDelayRisks();
  return all.find((r) => r.assistanceId === assistanceId) ?? null;
}

/** Cierra las predicciones de riesgo comparándolas con el resultado real. */
export async function evaluateDelayRiskPredictions(): Promise<number> {
  const now = Date.now();
  const pending = await db.query(
    `SELECT p.id, p."entityId", ca.status, ca."slaDeadlineAtMs",
            arr."occurredAtMs" AS arrived_at
       FROM ai_prediction p
       JOIN connect_assistances ca ON ca.id = p."entityId"::int
       LEFT JOIN LATERAL (SELECT MIN("occurredAtMs") AS "occurredAtMs" FROM connect_status_history
          WHERE "assistanceId" = ca.id AND "toStatus" = 'arrived') arr ON true
      WHERE p."predictionType" = 'delay_risk' AND p."evaluatedAtMs" IS NULL
        AND ca.status IN ('arrived','in_progress','finished','cancelled')
      ORDER BY p.id LIMIT 500`,
  );
  for (const p of pending.rows) {
    const deadline = p.slaDeadlineAtMs != null ? Number(p.slaDeadlineAtMs) : null;
    const arrived = p.arrived_at != null ? Number(p.arrived_at) : null;
    // 1 = acabó incumpliendo (o sin llegar), 0 = llegó dentro de plazo
    const actual = deadline == null ? null : arrived == null ? 1 : arrived <= deadline ? 0 : 1;
    if (actual == null) {
      await db.query(`UPDATE ai_prediction SET "evaluatedAtMs" = $1 WHERE id = $2`, [now, p.id]);
      continue;
    }
    await db.query(
      `UPDATE ai_prediction SET "actualValue" = $1, "errorValue" = $1 - "predictedValue", "evaluatedAtMs" = $2 WHERE id = $3`,
      [actual, now, p.id],
    );
  }
  return pending.rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cobertura y saturación por zona
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoneLoad {
  zoneId: string;
  label: string;
  active: number;
  availableUnits: number;
  ratio: number; // servicios activos por unidad disponible
}

/** Carga actual por zona: activas frente a unidades disponibles del taller. */
export async function zoneSaturation(): Promise<Record<string, ZoneLoad>> {
  const zones = await loadZones();
  const [assist, units] = await Promise.all([
    db.query(
      `SELECT latitude, longitude FROM connect_assistances
        WHERE status IN ('pending','searching','awaiting_acceptance','assigned','technician_assigned','en_route','arrived','in_progress')
          AND latitude IS NOT NULL AND longitude IS NOT NULL`,
    ),
    db.query(
      `SELECT latitude, longitude, status FROM connect_mobile_units
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL`,
    ),
  ]);

  const out: Record<string, ZoneLoad> = {};
  for (const z of zones) out[z.id] = { zoneId: z.id, label: z.label, active: 0, availableUnits: 0, ratio: 0 };
  for (const a of assist.rows) {
    const z = zoneFor(zones, Number(a.latitude), Number(a.longitude));
    if (z) out[z.id].active++;
  }
  for (const u of units.rows) {
    if (!["available", "at_base"].includes(String(u.status))) continue;
    const z = zoneFor(zones, Number(u.latitude), Number(u.longitude));
    if (z) out[z.id].availableUnits++;
  }
  for (const z of Object.values(out)) {
    z.ratio = z.availableUnits > 0 ? Math.round((z.active / z.availableUnits) * 100) / 100 : (z.active > 0 ? 99 : 0);
  }
  return out;
}

/** Precisión de cada modelo con las predicciones ya evaluadas. */
export async function modelAccuracy(days = 30): Promise<Array<Record<string, unknown>>> {
  const since = Date.now() - days * DAY_MS;
  const r = await db.query(
    `SELECT "predictionType", "modelVersion",
            COUNT(*)::int AS evaluated,
            AVG(ABS("errorValue")) AS mae,
            AVG(ABS("errorValue") / NULLIF(ABS(NULLIF("actualValue", 0)), 0)) * 100 AS mape,
            AVG("errorValue") AS bias
       FROM ai_prediction
      WHERE "evaluatedAtMs" IS NOT NULL AND "actualValue" IS NOT NULL AND "predictionAtMs" >= $1
      GROUP BY 1, 2 ORDER BY 1`,
    [since],
  );
  return r.rows.map((x) => ({
    predictionType: x.predictionType,
    modelVersion: x.modelVersion,
    evaluated: x.evaluated,
    mae: x.mae != null ? Math.round(Number(x.mae) * 100) / 100 : null,
    mape: x.mape != null ? Math.round(Number(x.mape) * 10) / 10 : null,
    bias: x.bias != null ? Math.round(Number(x.bias) * 100) / 100 : null,
  }));
}

/** Guarda la precisión medida en el registro de modelos (gobierno de la IA). */
export async function refreshModelAccuracy(): Promise<number> {
  const rows = await modelAccuracy(30);
  const now = Date.now();
  for (const m of rows) {
    await db.query(
      `UPDATE ai_model_registry
          SET "accuracyMetrics" = $1, "lastEvaluatedAtMs" = $2
        WHERE "modelType" = $3 AND status = 'active'`,
      [JSON.stringify(m), now, m.predictionType],
    );
  }
  return rows.length;
}

function safeJson(v: unknown): any {
  try { return typeof v === "string" ? JSON.parse(v) : (v ?? {}); } catch { return {}; }
}
