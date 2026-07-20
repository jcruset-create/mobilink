import { getSupabase } from '../repositories/supabase.client';
import { NormalizedTelemetry } from '../types/telemetry';
import { haversineMeters } from '../utils/geo';
import { logger } from '../utils/logger';

interface ActiveTrip {
  startedAt: string;
  startLat: number;
  startLon: number;
  lastLat: number;
  lastLon: number;
  distanceM: number;
  maxSpeed: number;
}

/**
 * Cálculo de recorridos y kilómetros.
 * Un viaje empieza con ignición ON y termina con ignición OFF.
 * La distancia se acumula por haversine entre posiciones válidas consecutivas.
 */
export class TripService {
  private readonly active = new Map<string, ActiveTrip>();

  async process(t: NormalizedTelemetry): Promise<void> {
    const trip = this.active.get(t.imei);
    const ignition = t.engine.ignition;

    if (ignition === true && !trip && t.gps.valid) {
      this.active.set(t.imei, {
        startedAt: t.timestamp,
        startLat: t.gps.latitude,
        startLon: t.gps.longitude,
        lastLat: t.gps.latitude,
        lastLon: t.gps.longitude,
        distanceM: 0,
        maxSpeed: t.gps.speed,
      });
      return;
    }

    if (trip && t.gps.valid) {
      const step = haversineMeters(trip.lastLat, trip.lastLon, t.gps.latitude, t.gps.longitude);
      // Filtro de saltos GPS: ignorar pasos absurdos (> 5 km entre posiciones)
      if (step < 5000) {
        trip.distanceM += step;
        trip.lastLat = t.gps.latitude;
        trip.lastLon = t.gps.longitude;
      }
      trip.maxSpeed = Math.max(trip.maxSpeed, t.gps.speed);
    }

    if (ignition === false && trip) {
      this.active.delete(t.imei);
      await this.closeTrip(t, trip);
    }
  }

  private async closeTrip(t: NormalizedTelemetry, trip: ActiveTrip): Promise<void> {
    const durationS = Math.round((new Date(t.timestamp).getTime() - new Date(trip.startedAt).getTime()) / 1000);
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('mte_trips').insert({
      imei: t.imei,
      vehicle_id: t.vehicleId,
      started_at: trip.startedAt,
      ended_at: t.timestamp,
      start_latitude: trip.startLat,
      start_longitude: trip.startLon,
      end_latitude: t.gps.valid ? t.gps.latitude : trip.lastLat,
      end_longitude: t.gps.valid ? t.gps.longitude : trip.lastLon,
      distance_m: Math.round(trip.distanceM),
      duration_s: durationS,
      max_speed: trip.maxSpeed,
    });
    if (error) logger.error({ error, imei: t.imei }, 'Error guardando viaje');
    else logger.info({ imei: t.imei, km: (trip.distanceM / 1000).toFixed(2), durationS }, 'Viaje cerrado');
  }
}
