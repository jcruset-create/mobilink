import { getSupabase } from './supabase.client';
import { logger } from '../utils/logger';
import { TelemetryEvent } from '../types/telemetry';

export class EventRepository {
  async insert(event: TelemetryEvent): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb.from('mte_events').insert({
      imei: event.imei,
      vehicle_id: event.vehicleId,
      type: event.type,
      ts: event.timestamp,
      data: event.data,
    });
    if (error) logger.error({ error, type: event.type }, 'Error insertando evento');
  }
}
