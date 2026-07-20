import {
  DriverDTO,
  EngineHoursReadingDTO,
  OdometerReadingDTO,
  Page,
  PositionDTO,
  ProviderCapabilities,
  ProviderCredentials,
  SyncWindow,
  VehicleDTO,
} from '@fih/domain';
import { BaseFleetAdapter } from '../base.adapter';
import { MovertisClient } from './movertis.client';
import { mapDriver, mapEngineHours, mapOdometer, mapPosition, mapVehicle } from './movertis.mapper';

/**
 * Adaptador de ejemplo: Movertis (España).
 * Sirve como plantilla de referencia para incorporar el resto de plataformas:
 *   cliente HTTP (movertis.client) + mapper (movertis.mapper) + este adaptador.
 */
export class MovertisAdapter extends BaseFleetAdapter {
  readonly key = 'movertis';
  readonly displayName = 'Movertis';
  readonly capabilities: ProviderCapabilities = {
    vehicles: true,
    odometer: true,
    engineHours: true,
    drivers: true,
    positions: true,
    vehicleStatus: false,
    maintenanceEvents: false,
    canFmsData: false,
    webhooks: false,
    writeBack: false,
  };

  private client(credentials: ProviderCredentials): MovertisClient {
    return new MovertisClient(credentials);
  }

  async authenticate(credentials: ProviderCredentials): Promise<ProviderCredentials> {
    // Movertis usa token estático de API: no hay flujo de refresco.
    await this.client(credentials).ping();
    return credentials;
  }

  async healthCheck(credentials: ProviderCredentials): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.client(credentials).ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async listVehicles(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<VehicleDTO>> {
    const res = await this.client(credentials).vehicles(window.cursor ?? undefined);
    return { items: res.data.map(mapVehicle), nextCursor: res.next ?? null };
  }

  async listOdometerReadings(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<OdometerReadingDTO>> {
    // Movertis expone el odómetro como atributo del vehículo: se lee el
    // listado de vehículos y se materializa una lectura con timestamp actual.
    const res = await this.client(credentials).vehicles(window.cursor ?? undefined);
    const now = new Date().toISOString();
    return {
      items: res.data.map((v) => mapOdometer(v, now)).filter((x): x is OdometerReadingDTO => x !== null),
      nextCursor: res.next ?? null,
    };
  }

  async listEngineHours(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<EngineHoursReadingDTO>> {
    const res = await this.client(credentials).vehicles(window.cursor ?? undefined);
    const now = new Date().toISOString();
    return {
      items: res.data.map((v) => mapEngineHours(v, now)).filter((x): x is EngineHoursReadingDTO => x !== null),
      nextCursor: res.next ?? null,
    };
  }

  async listDrivers(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<DriverDTO>> {
    const res = await this.client(credentials).drivers(window.cursor ?? undefined);
    return { items: res.data.map(mapDriver), nextCursor: res.next ?? null };
  }

  async listPositions(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<PositionDTO>> {
    const res = await this.client(credentials).positions(window.since ?? undefined, window.cursor ?? undefined);
    return { items: res.data.map(mapPosition), nextCursor: res.next ?? null };
  }
}
