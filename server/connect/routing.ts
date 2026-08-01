/**
 * Rutas por carretera para el mapa operativo (Google Routes API v2, la misma
 * que ya usa el core para calcular ETAs con `GOOGLE_MAPS_API_KEY`).
 *
 * El mapa se refresca cada 15 s y puede haber varias asistencias en curso, así
 * que se cachea en memoria: solo se vuelve a pedir la ruta si la furgoneta se
 * ha movido de verdad, si cambia el destino o si la ruta ya es vieja. Sin ese
 * freno, cada pantalla abierta dispararía una llamada facturable por unidad y
 * por refresco.
 */

export interface DrivingRoute {
  points: [number, number][];
  distanceKm: number;
  etaMinutes: number;
  computedAtMs: number;
}

interface CacheEntry extends DrivingRoute {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
}

const cache = new Map<number, CacheEntry>();

/** Vigencia máxima de una ruta cacheada. */
const MAX_AGE_MS = 90_000;
/** Movimiento del vehículo que obliga a recalcular. */
const MOVED_M = 250;

function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Decodifica el formato polyline de Google (precisión 1e-5). */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0, lat = 0, lng = 0;

  while (index < encoded.length) {
    let result = 0, shift = 0, b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0; shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

/**
 * Ruta en coche del vehículo al punto de la asistencia. Devuelve null si no
 * hay clave configurada o si Google no encuentra ruta: en ese caso el mapa
 * dibuja la línea recta y lo indica, en vez de inventarse un trazado.
 */
export async function drivingRoute(
  assistanceId: number,
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
): Promise<DrivingRoute | null> {
  const cached = cache.get(assistanceId);
  if (
    cached &&
    Date.now() - cached.computedAtMs < MAX_AGE_MS &&
    meters(cached.origin, origin) < MOVED_M &&
    meters(cached.destination, destination) < 50
  ) {
    return cached;
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE",
        polylineQuality: "HIGH_QUALITY",
      }),
    });
    if (!res.ok) {
      console.error(`[Connect] Routes API ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const route = data.routes?.[0];
    const encoded = route?.polyline?.encodedPolyline;
    if (!encoded) return null;

    const entry: CacheEntry = {
      points: decodePolyline(encoded),
      distanceKm: Math.round((route.distanceMeters / 1000) * 10) / 10,
      etaMinutes: Math.round(parseInt(String(route.duration).replace("s", ""), 10) / 60),
      computedAtMs: Date.now(),
      origin, destination,
    };
    cache.set(assistanceId, entry);
    return entry;
  } catch (err: any) {
    console.error("[Connect] error calculando ruta:", err?.message);
    return null;
  }
}

/** Olvida la ruta de una asistencia (al cerrarla o reasignarla). */
export function forgetRoute(assistanceId: number): void {
  cache.delete(assistanceId);
}
