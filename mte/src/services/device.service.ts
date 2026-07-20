import { config } from '../config';
import { DeviceRepository } from '../repositories/device.repository';
import { logger } from '../utils/logger';

export interface DeviceAuthResult {
  authorized: boolean;
  deviceType: string | null;
  vehicleId: string | null;
}

/**
 * Validación y gestión de dispositivos.
 * Cachea el resultado de autorización para no golpear la BD en cada reconexión.
 */
export class DeviceService {
  private readonly cache = new Map<string, { result: DeviceAuthResult; at: number }>();
  private readonly cacheTtlMs = 60_000;

  constructor(private readonly repo: DeviceRepository = new DeviceRepository()) {}

  async authorize(imei: string): Promise<DeviceAuthResult> {
    const cached = this.cache.get(imei);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.result;

    const row = await this.repo.findByImei(imei);
    let result: DeviceAuthResult;

    if (row) {
      result = { authorized: row.authorized, deviceType: row.device_type, vehicleId: row.vehicle_id };
    } else if (config.devices.authMode === 'open') {
      // Solo para desarrollo/pruebas: acepta cualquier IMEI
      logger.warn({ imei }, 'IMEI desconocido aceptado (modo open); no usar en producción');
      result = { authorized: true, deviceType: null, vehicleId: null };
    } else if (config.devices.authMode === 'permissive') {
      await this.repo.upsertUnknown(imei);
      logger.info({ imei }, 'IMEI desconocido auto-registrado (modo permissive), pendiente de autorización');
      result = { authorized: false, deviceType: null, vehicleId: null };
    } else {
      result = { authorized: false, deviceType: null, vehicleId: null };
    }

    this.cache.set(imei, { result, at: Date.now() });
    return result;
  }

  async markConnected(imei: string, ip: string): Promise<void> {
    await this.repo.markSeen(imei, ip);
  }

  invalidateCache(imei?: string): void {
    if (imei) this.cache.delete(imei);
    else this.cache.clear();
  }
}
