import {
  EngineHoursReadingDTO,
  OdometerReadingDTO,
  Page,
  PositionDTO,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderError,
  SyncWindow,
  VehicleDTO,
  VehicleStatusDTO,
} from '@fih/domain';
import { BaseFleetAdapter, providerFetch } from '../base.adapter';

interface MteCurrentPosition {
  imei: string;
  vehicle_id: string | null;
  device_type: string | null;
  ts: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  ignition: boolean | null;
  movement: boolean | null;
  rpm: number | null;
  engine_hours: number | null;
  engine_temperature: number | null;
  odometer: number | null;
  odometer_source: 'can' | 'gps' | null;
  fuel_level: number | null;
  fuel_consumed: number | null;
}

/**
 * Adaptador del Mobilink Telematics Engine (MTE): el motor telemático propio
 * (Teltonika FMC150/FMC650) se consume por el hub exactamente igual que
 * cualquier proveedor externo, a través de su API REST.
 *
 * Credenciales: { kind: 'api_key', apiKey: <API_KEY del MTE>,
 *                 extra: { baseUrl: 'http://vps:8080' } }
 */
export class MteAdapter extends BaseFleetAdapter {
  readonly key = 'mte';
  readonly displayName = 'Mobilink Telematics Engine';
  readonly capabilities: ProviderCapabilities = {
    vehicles: true,
    odometer: true,
    engineHours: true,
    drivers: false,
    positions: true,
    vehicleStatus: true,
    maintenanceEvents: false,
    canFmsData: true,
    webhooks: false, // el MTE ofrece WebSocket; el hub usa polling incremental
    writeBack: false,
  };

  private baseUrl(c: ProviderCredentials): string {
    const url = c.extra?.baseUrl;
    if (!url) throw new ProviderError('auth', 'MTE: falta extra.baseUrl');
    return url.replace(/\/$/, '');
  }

  private async current(c: ProviderCredentials): Promise<MteCurrentPosition[]> {
    const res = await providerFetch(`${this.baseUrl(c)}/api/v1/positions/current`, {
      headers: { 'x-api-key': c.apiKey ?? '' },
    });
    return (await res.json()) as MteCurrentPosition[];
  }

  async authenticate(credentials: ProviderCredentials): Promise<ProviderCredentials> {
    await this.current(credentials);
    return credentials;
  }

  async healthCheck(credentials: ProviderCredentials): Promise<{ ok: boolean; detail?: string }> {
    try {
      const res = await providerFetch(`${this.baseUrl(credentials)}/health`);
      const body = (await res.json()) as { status?: string };
      return { ok: body.status === 'ok' };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async listVehicles(c: ProviderCredentials, _w: SyncWindow): Promise<Page<VehicleDTO>> {
    const rows = await this.current(c);
    return {
      items: rows.map((r) => ({
        externalId: r.imei,
        provider: this.key,
        plate: null, // la matrícula vive en Mobilink Fleet, enlazada por vehicle_id
        vin: null,
        name: r.vehicle_id,
        brand: null,
        model: r.device_type,
        category: 'other' as const,
        axleConfiguration: null,
        active: true,
      })),
      nextCursor: null,
    };
  }

  async listOdometerReadings(c: ProviderCredentials, _w: SyncWindow): Promise<Page<OdometerReadingDTO>> {
    const rows = await this.current(c);
    return {
      items: rows
        .filter((r) => typeof r.odometer === 'number')
        .map((r) => ({
          externalVehicleId: r.imei,
          provider: this.key,
          timestamp: r.ts,
          odometerMeters: r.odometer as number,
          source: r.odometer_source ?? 'unknown',
        })),
      nextCursor: null,
    };
  }

  async listEngineHours(c: ProviderCredentials, _w: SyncWindow): Promise<Page<EngineHoursReadingDTO>> {
    const rows = await this.current(c);
    return {
      items: rows
        .filter((r) => typeof r.engine_hours === 'number')
        .map((r) => ({
          externalVehicleId: r.imei,
          provider: this.key,
          timestamp: r.ts,
          engineHours: r.engine_hours as number,
        })),
      nextCursor: null,
    };
  }

  async listPositions(c: ProviderCredentials, _w: SyncWindow): Promise<Page<PositionDTO>> {
    const rows = await this.current(c);
    return {
      items: rows.map((r) => ({
        externalVehicleId: r.imei,
        provider: this.key,
        timestamp: r.ts,
        latitude: r.latitude,
        longitude: r.longitude,
        speed: r.speed,
        heading: r.heading,
        ignition: r.ignition,
      })),
      nextCursor: null,
    };
  }

  async listVehicleStatus(c: ProviderCredentials, _w: SyncWindow): Promise<Page<VehicleStatusDTO>> {
    const rows = await this.current(c);
    return {
      items: rows.map((r) => ({
        externalVehicleId: r.imei,
        provider: this.key,
        timestamp: r.ts,
        ignition: r.ignition,
        moving: r.movement,
        can:
          r.rpm !== null || r.fuel_level !== null
            ? {
                rpm: r.rpm ?? undefined,
                fuelLevelPercent: r.fuel_level ?? undefined,
                engineTemperature: r.engine_temperature ?? undefined,
                totalFuelConsumedLiters: r.fuel_consumed ?? undefined,
              }
            : null,
      })),
      nextCursor: null,
    };
  }
}
