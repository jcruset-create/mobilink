import { getSupabase } from './supabase.client';
import { logger } from '../utils/logger';
import { NormalizedTelemetry } from '../types/telemetry';

function toRow(t: NormalizedTelemetry) {
  return {
    imei: t.imei,
    vehicle_id: t.vehicleId,
    device_type: t.deviceType,
    ts: t.timestamp,
    priority: t.priority,
    event_io_id: t.eventIoId,
    latitude: t.gps.latitude,
    longitude: t.gps.longitude,
    altitude: t.gps.altitude ?? null,
    speed: t.gps.speed,
    heading: t.gps.heading,
    satellites: t.gps.satellites ?? null,
    gps_valid: t.gps.valid,
    ignition: t.engine.ignition ?? null,
    movement: t.movement ?? null,
    rpm: t.engine.rpm ?? null,
    engine_hours: t.engine.hours ?? null,
    engine_temperature: t.engine.temperature ?? null,
    odometer: t.vehicle.odometer ?? null,
    odometer_source: t.vehicle.odometerSource ?? null,
    fuel_level: t.vehicle.fuelLevel ?? null,
    fuel_consumed: t.vehicle.fuelConsumed ?? null,
    external_voltage: t.power.externalVoltage ?? null,
    io: t.io,
    raw: t.raw,
  };
}

export class PositionRepository {
  /** Inserta un lote de posiciones en el histórico. Ignora duplicados (imei, ts, event_io_id). */
  async insertHistory(batch: NormalizedTelemetry[]): Promise<void> {
    const sb = getSupabase();
    if (!sb || batch.length === 0) return;
    const { error } = await sb
      .from('mte_positions')
      .upsert(batch.map(toRow), { onConflict: 'imei,ts,event_io_id', ignoreDuplicates: true });
    if (error) logger.error({ error }, 'Error insertando histórico de posiciones');
  }

  /** Actualiza la posición actual (una fila por IMEI). */
  async upsertCurrent(t: NormalizedTelemetry): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb
      .from('mte_current_positions')
      .upsert({ ...toRow(t), updated_at: new Date().toISOString() }, { onConflict: 'imei' });
    if (error) logger.error({ error, imei: t.imei }, 'Error actualizando posición actual');
  }

  async getCurrent(imei?: string): Promise<Record<string, unknown>[]> {
    const sb = getSupabase();
    if (!sb) return [];
    let q = sb.from('mte_current_positions').select('*');
    if (imei) q = q.eq('imei', imei);
    const { data, error } = await q;
    if (error) {
      logger.error({ error }, 'Error consultando posiciones actuales');
      return [];
    }
    return data ?? [];
  }

  async getHistory(imei: string, from: string, to: string, limit = 5000): Promise<Record<string, unknown>[]> {
    const sb = getSupabase();
    if (!sb) return [];
    const { data, error } = await sb
      .from('mte_positions')
      .select('*')
      .eq('imei', imei)
      .gte('ts', from)
      .lte('ts', to)
      .order('ts', { ascending: true })
      .limit(limit);
    if (error) {
      logger.error({ error, imei }, 'Error consultando histórico');
      return [];
    }
    return data ?? [];
  }
}
