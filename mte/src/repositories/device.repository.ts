import { getSupabase } from './supabase.client';
import { logger } from '../utils/logger';

export interface DeviceRow {
  imei: string;
  device_type: string;
  vehicle_id: string | null;
  authorized: boolean;
  last_seen_at: string | null;
  last_ip: string | null;
}

export class DeviceRepository {
  async findByImei(imei: string): Promise<DeviceRow | null> {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb.from('mte_devices').select('*').eq('imei', imei).maybeSingle();
    if (error) {
      logger.error({ error, imei }, 'Error consultando dispositivo');
      return null;
    }
    return data as DeviceRow | null;
  }

  async upsertUnknown(imei: string): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb
      .from('mte_devices')
      .upsert({ imei, device_type: 'UNKNOWN', authorized: false }, { onConflict: 'imei', ignoreDuplicates: true });
    if (error) logger.error({ error, imei }, 'Error registrando dispositivo desconocido');
  }

  async markSeen(imei: string, ip: string): Promise<void> {
    const sb = getSupabase();
    if (!sb) return;
    const { error } = await sb
      .from('mte_devices')
      .update({ last_seen_at: new Date().toISOString(), last_ip: ip })
      .eq('imei', imei);
    if (error) logger.error({ error, imei }, 'Error actualizando last_seen del dispositivo');
  }
}
