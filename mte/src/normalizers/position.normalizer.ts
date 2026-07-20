import { NormalizedTelemetry } from '../types/telemetry';

/**
 * Saneado de la posición GPS: coordenadas fuera de rango o (0,0) marcan
 * la posición como no válida para que los servicios de dominio la ignoren.
 */
export function normalizePosition(t: NormalizedTelemetry): void {
  const { latitude, longitude } = t.gps;
  if (
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    t.gps.valid = false;
  }
  if (t.gps.speed < 0 || t.gps.speed > 250) t.gps.speed = 0;
  t.gps.heading = ((t.gps.heading % 360) + 360) % 360;
}
