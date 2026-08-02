/**
 * Mobilink Assist Lite — reglas de dominio puras (sin base de datos).
 *
 * Aquí vive todo lo que debe poder probarse de forma aislada y compartirse
 * entre el backend, Central Pro y la APK: máquina de estados operativa,
 * requisitos de finalización, geovallas y cálculo de KPIs a partir del
 * historial oficial de estados (connect_status_history).
 *
 * IMPORTANTE: este módulo NO debe importar db.ts ni ningún servicio con
 * efectos secundarios; los tests lo cargan directamente.
 */

// ---------------------------------------------------------------------------
// Producto contratado por el taller
// ---------------------------------------------------------------------------

/**
 * `connect_workshops.integrationType` es el único eje que distingue a un
 * taller: qué producto tiene habilitado. Cambiarlo NO migra datos — el taller
 * conserva id, historial, KPIs, operarios, valoraciones y documentos.
 */
export const WORKSHOP_INTEGRATION_TYPES = ["assist", "lite", "external"] as const;
export type WorkshopIntegrationType = (typeof WORKSHOP_INTEGRATION_TYPES)[number];

/** Nombre normalizado del nivel de producto, para API y UI. */
export const WORKSHOP_TIER: Record<string, "FULL" | "LITE" | "EXTERNAL"> = {
  assist: "FULL",
  lite: "LITE",
  external: "EXTERNAL",
};

export const WORKSHOP_TIER_LABELS: Record<string, string> = {
  assist: "Mobilink Assist completo",
  lite: "Mobilink Assist Lite",
  external: "Taller externo (sin digitalizar)",
};

// ---------------------------------------------------------------------------
// Estados operativos (los mismos que Mobilink Assist completo)
// ---------------------------------------------------------------------------

/**
 * Ciclo operativo del taller, en el orden en que ocurre. Coincide uno a uno
 * con los estados del core (roadside_assistances) para que un taller FULL y
 * un taller LITE produzcan exactamente la misma línea temporal.
 *
 *   assigned              → Enviada al taller           (core: pendiente)
 *   technician_assigned   → Asignada al operario        (core: asignada)
 *   en_route              → En camino                   (core: en_camino)
 *   arrived               → En punto                    (core: en_punto)
 *   in_progress           → Trabajando                  (core: inicio_reparacion)
 *   finished              → Finalizada                  (core: finalizada)
 *   returning_to_workshop → Vuelta al taller            (core: en_camino_base)
 *   at_workshop           → En taller                   (core: llegada_taller)
 */
export const LITE_FLOW = [
  "assigned",
  "technician_assigned",
  "en_route",
  "arrived",
  "in_progress",
  "finished",
  "returning_to_workshop",
  "at_workshop",
] as const;

export type LiteStatus = (typeof LITE_FLOW)[number];

export const LITE_STATUS_LABELS: Record<LiteStatus, string> = {
  assigned: "Recibida",
  technician_assigned: "Asignada",
  en_route: "En camino",
  arrived: "En punto",
  in_progress: "Trabajando",
  finished: "Finalizada",
  returning_to_workshop: "Vuelta al taller",
  at_workshop: "En taller",
};

/** Estados desde los que el operario puede seguir avanzando (no terminales). */
export const LITE_ACTIVE_STATUSES: LiteStatus[] = [
  "assigned", "technician_assigned", "en_route", "arrived", "in_progress", "finished", "returning_to_workshop",
];

/**
 * Transiciones que la APK puede pedir. El backend valida SIEMPRE contra esta
 * tabla además de contra la máquina de estados general de Connect.
 *
 * Tras `finished` hay dos caminos: cerrar el ciclo con vuelta al taller o
 * terminar ahí (servicios en los que la unidad no regresa).
 */
export const LITE_TRANSITIONS: Record<LiteStatus, LiteStatus[]> = {
  assigned: ["technician_assigned", "en_route"],
  technician_assigned: ["en_route"],
  en_route: ["arrived"],
  arrived: ["in_progress", "finished"],
  in_progress: ["finished"],
  finished: ["returning_to_workshop"],
  returning_to_workshop: ["at_workshop"],
  at_workshop: [],
};

export function isLiteStatus(value: string): value is LiteStatus {
  return (LITE_FLOW as readonly string[]).includes(value);
}

/** ¿Puede la APK pasar de `from` a `to`? */
export function canLiteTransition(from: string, to: string): boolean {
  if (!isLiteStatus(from) || !isLiteStatus(to)) return false;
  return LITE_TRANSITIONS[from].includes(to);
}

/** Siguiente estado sugerido (botón principal de la APK). */
export function nextLiteStatus(from: string): LiteStatus | null {
  if (!isLiteStatus(from)) return null;
  return LITE_TRANSITIONS[from][0] ?? null;
}

/**
 * Estados en los que la aplicación comparte ubicación. Fuera de estos estados
 * NO se hace seguimiento: es un requisito de privacidad, no una optimización.
 */
export const TRACKING_STATUSES: LiteStatus[] = ["en_route", "arrived", "in_progress", "returning_to_workshop"];

export function shouldTrack(status: string, trackWhileWorking = true): boolean {
  if (!isLiteStatus(status)) return false;
  if (status === "in_progress" && !trackWhileWorking) return false;
  return TRACKING_STATUSES.includes(status);
}

/**
 * Cadencia de envío de posiciones según estado y movimiento. Devuelve segundos.
 * En parado se espacia para no castigar la batería; en desplazamiento se afina.
 */
export function trackingIntervalSec(status: string, speedKmh: number | null | undefined): number {
  if (!shouldTrack(status)) return 0;
  if (status === "arrived" || status === "in_progress") return 120;
  const v = Number(speedKmh);
  if (!Number.isFinite(v) || v < 3) return 60; // detenido o sin dato
  if (v < 30) return 30;
  return 15;
}

// ---------------------------------------------------------------------------
// Geolocalización: validación y geovallas
// ---------------------------------------------------------------------------

export interface GpsPoint {
  lat: number;
  lng: number;
  ts: number;
  accuracyM?: number | null;
  speedKmh?: number | null;
  headingDeg?: number | null;
}

/** Descarta coordenadas imposibles, marcas de tiempo absurdas o precisión inútil. */
export function isValidPoint(p: Partial<GpsPoint>, nowMs = Date.now()): boolean {
  const lat = Number(p.lat), lng = Number(p.lng), ts = Number(p.ts);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  if (!Number.isFinite(ts) || ts <= 0) return false;
  // Hasta 7 días de antigüedad (cola offline larga) y 5 min de margen de reloj
  if (ts > nowMs + 5 * 60_000 || ts < nowMs - 7 * 24 * 3600_000) return false;
  const acc = Number(p.accuracyM);
  if (Number.isFinite(acc) && acc > 2000) return false;
  return true;
}

/** Elimina duplicados exactos y puntos consecutivos a menos de `minMeters`. */
export function dedupePoints(points: GpsPoint[], minMeters = 8): GpsPoint[] {
  const sorted = [...points].sort((a, b) => a.ts - b.ts);
  const out: GpsPoint[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.ts === p.ts && prev.lat === p.lat && prev.lng === p.lng) continue;
    if (prev && haversineMeters(prev.lat, prev.lng, p.lat, p.lng) < minMeters && p.ts - prev.ts < 60_000) continue;
    out.push(p);
  }
  return out;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeofenceConfig {
  /** Radio en zona urbana (m). Configurable desde Central Pro. */
  arrivalRadiusUrbanM: number;
  /** Radio en zona interurbana (m). */
  arrivalRadiusRuralM: number;
  /** Radio de la geovalla del taller (m). */
  workshopRadiusM: number;
  /** Precisión máxima aceptada para sugerir un cambio automático (m). */
  maxAccuracyM: number;
}

export const DEFAULT_GEOFENCE: GeofenceConfig = {
  arrivalRadiusUrbanM: 150,
  arrivalRadiusRuralM: 350,
  workshopRadiusM: 300,
  maxAccuracyM: 100,
};

export interface GeofenceHint {
  /** Estado sugerido, nunca aplicado automáticamente sin confirmación. */
  suggest: LiteStatus | null;
  distanceM: number | null;
  /** false cuando la precisión GPS no da garantías: la APK no debe sugerir nada. */
  reliable: boolean;
}

/**
 * Sugerencia de cambio de estado por proximidad. Devuelve siempre una
 * *sugerencia*: la decisión final es del operario (o de una regla de negocio
 * explícita en Central), nunca del GPS por sí solo.
 */
export function geofenceHint(opts: {
  status: string;
  point: GpsPoint;
  target?: { lat: number; lng: number } | null;
  workshop?: { lat: number; lng: number } | null;
  urban?: boolean;
  config?: Partial<GeofenceConfig>;
}): GeofenceHint {
  const cfg = { ...DEFAULT_GEOFENCE, ...(opts.config ?? {}) };
  const acc = Number(opts.point.accuracyM);
  const reliable = !Number.isFinite(acc) || acc <= cfg.maxAccuracyM;

  if (opts.status === "en_route" && opts.target) {
    const d = haversineMeters(opts.point.lat, opts.point.lng, opts.target.lat, opts.target.lng);
    const radius = opts.urban === false ? cfg.arrivalRadiusRuralM : cfg.arrivalRadiusUrbanM;
    return { suggest: reliable && d <= radius ? "arrived" : null, distanceM: Math.round(d), reliable };
  }
  if (opts.status === "returning_to_workshop" && opts.workshop) {
    const d = haversineMeters(opts.point.lat, opts.point.lng, opts.workshop.lat, opts.workshop.lng);
    return { suggest: reliable && d <= cfg.workshopRadiusM ? "at_workshop" : null, distanceM: Math.round(d), reliable };
  }
  return { suggest: null, distanceM: null, reliable };
}

/** ETA sencilla y honesta: distancia en línea recta con factor de ruta. */
export function estimateEtaMinutes(distanceM: number, avgKmh = 45): number {
  const routeKm = (distanceM / 1000) * 1.3;
  return Math.max(1, Math.round((routeKm / avgKmh) * 60));
}

// ---------------------------------------------------------------------------
// Requisitos de finalización
// ---------------------------------------------------------------------------

export interface FinishRules {
  minPhotos: number;
  requireSignature: boolean;
  requireSignerName: boolean;
  requireResolutionNotes: boolean;
  requireResult: boolean;
  requireOdometer: boolean;
  /** Categorías de foto obligatorias (códigos de EVIDENCE_CATEGORIES). */
  requiredPhotoCategories: string[];
}

export const DEFAULT_FINISH_RULES: FinishRules = {
  minPhotos: 1,
  requireSignature: false,
  requireSignerName: true,
  requireResolutionNotes: true,
  requireResult: true,
  requireOdometer: false,
  requiredPhotoCategories: [],
};

export interface FinishPayload {
  result?: string | null;
  resolutionNotes?: string | null;
  odometerKm?: number | null;
  signature?: { signerName?: string | null } | null;
  photos?: { category: string }[];
}

/** Valida el cierre contra las reglas del servicio. Devuelve los fallos. */
export function validateFinish(rules: FinishRules, payload: FinishPayload): string[] {
  const errors: string[] = [];
  const photos = payload.photos ?? [];

  if (rules.minPhotos > 0 && photos.length < rules.minPhotos) {
    errors.push(`Faltan fotografías: se requieren ${rules.minPhotos} y hay ${photos.length}.`);
  }
  for (const cat of rules.requiredPhotoCategories) {
    if (!photos.some((p) => p.category === cat)) {
      errors.push(`Falta una fotografía de la categoría "${EVIDENCE_CATEGORY_LABELS[cat] ?? cat}".`);
    }
  }
  if (rules.requireResult && !String(payload.result || "").trim()) {
    errors.push("Indica el resultado del servicio.");
  }
  if (rules.requireResolutionNotes && !String(payload.resolutionNotes || "").trim()) {
    errors.push("Indica una observación de resolución.");
  }
  if (rules.requireSignature && !payload.signature) {
    errors.push("Falta la firma del cliente.");
  }
  if (rules.requireSignature && rules.requireSignerName && !String(payload.signature?.signerName || "").trim()) {
    errors.push("Falta el nombre del firmante.");
  }
  if (rules.requireOdometer && !Number.isFinite(Number(payload.odometerKm))) {
    errors.push("Faltan los kilómetros del vehículo.");
  }
  return errors;
}

/** Categorías de evidencia por defecto (Central puede ampliarlas). */
export const EVIDENCE_CATEGORY_LABELS: Record<string, string> = {
  arrival: "Vehículo al llegar",
  damage: "Daño o avería",
  work: "Trabajo realizado",
  part: "Pieza sustituida",
  finished: "Vehículo finalizado",
  document: "Documento",
  signature: "Firma",
  other: "Otros",
};

export const EVIDENCE_CATEGORIES = Object.keys(EVIDENCE_CATEGORY_LABELS);

/** Resultados de servicio por defecto (Central puede ampliarlos). */
export const SERVICE_RESULT_LABELS: Record<string, string> = {
  repaired_on_site: "Reparado en carretera",
  towed: "Trasladado",
  not_repaired: "No reparado",
  customer_absent: "Cliente ausente",
  cancelled_on_site: "Servicio cancelado",
  taken_to_workshop: "Vehículo llevado al taller",
  other: "Otro",
};

export const SERVICE_RESULTS = Object.keys(SERVICE_RESULT_LABELS);

// ---------------------------------------------------------------------------
// KPIs a partir del historial oficial de estados
// ---------------------------------------------------------------------------

export interface StatusHistoryEntry {
  toStatus: string;
  occurredAtMs: number;
}

export interface LiteKpis {
  acceptMin: number | null;
  acceptToEnRouteMin: number | null;
  travelMin: number | null;
  assignToArrivalMin: number | null;
  onSiteBeforeWorkMin: number | null;
  workMin: number | null;
  totalMin: number | null;
  returnMin: number | null;
  cycleMin: number | null;
  slaMet: boolean | null;
  etaMet: boolean | null;
}

function firstAt(history: StatusHistoryEntry[], status: string): number | null {
  const hit = history.find((h) => h.toStatus === status);
  return hit ? Number(hit.occurredAtMs) : null;
}

function diffMin(from: number | null, to: number | null): number | null {
  if (from == null || to == null || to < from) return null;
  return Math.round((to - from) / 60000);
}

/**
 * Calcula los KPIs operativos con marcas de tiempo del servidor. Se usan los
 * mismos nombres para talleres FULL y LITE, de modo que los informes de
 * Central Pro no distinguen el origen.
 */
export function computeLiteKpis(
  history: StatusHistoryEntry[],
  opts: { acceptedAtMs?: number | null; slaDeadlineAtMs?: number | null; etaAtMs?: number | null } = {},
): LiteKpis {
  const sorted = [...history].sort((a, b) => Number(a.occurredAtMs) - Number(b.occurredAtMs));
  const assigned = firstAt(sorted, "assigned") ?? firstAt(sorted, "awaiting_acceptance");
  const accepted = opts.acceptedAtMs ?? firstAt(sorted, "technician_assigned");
  const enRoute = firstAt(sorted, "en_route");
  const arrived = firstAt(sorted, "arrived");
  const working = firstAt(sorted, "in_progress");
  const finished = firstAt(sorted, "finished");
  const returning = firstAt(sorted, "returning_to_workshop");
  const atWorkshop = firstAt(sorted, "at_workshop");

  return {
    acceptMin: diffMin(assigned, accepted),
    acceptToEnRouteMin: diffMin(accepted, enRoute),
    travelMin: diffMin(enRoute, arrived),
    assignToArrivalMin: diffMin(assigned, arrived),
    onSiteBeforeWorkMin: diffMin(arrived, working),
    workMin: diffMin(working ?? arrived, finished),
    totalMin: diffMin(assigned, finished),
    returnMin: diffMin(returning, atWorkshop),
    cycleMin: diffMin(assigned, atWorkshop ?? finished),
    slaMet: opts.slaDeadlineAtMs && arrived ? arrived <= Number(opts.slaDeadlineAtMs) : null,
    etaMet: opts.etaAtMs && arrived ? arrived <= Number(opts.etaAtMs) : null,
  };
}

/**
 * Calidad de actualización de estados: mide si el operario fue registrando el
 * ciclo o si Central tuvo que corregirlo. 0-100.
 */
export function statusQualityScore(history: StatusHistoryEntry[], manualCorrections = 0): number {
  const expected: LiteStatus[] = ["technician_assigned", "en_route", "arrived", "in_progress", "finished"];
  const present = expected.filter((s) => history.some((h) => h.toStatus === s)).length;
  const base = (present / expected.length) * 100;
  return Math.max(0, Math.round(base - manualCorrections * 15));
}
