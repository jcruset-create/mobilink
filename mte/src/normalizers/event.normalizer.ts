import { NormalizedTelemetry, TelemetryEvent } from '../types/telemetry';

/** Convierte una telemetría normalizada en un evento de posición publicable. */
export function toPositionEvent(t: NormalizedTelemetry): TelemetryEvent {
  return {
    type: 'position',
    imei: t.imei,
    vehicleId: t.vehicleId,
    timestamp: t.timestamp,
    data: {
      latitude: t.gps.latitude,
      longitude: t.gps.longitude,
      speed: t.gps.speed,
      heading: t.gps.heading,
      ignition: t.engine.ignition,
      odometer: t.vehicle.odometer,
    },
  };
}
