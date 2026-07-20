import {
  FleetProviderAdapter,
  Page,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderError,
  ProviderKey,
  SyncWindow,
  VehicleDTO,
  OdometerReadingDTO,
  EngineHoursReadingDTO,
  DriverDTO,
  PositionDTO,
  VehicleStatusDTO,
  MaintenanceEventDTO,
} from '@fih/domain';

const emptyPage = <T>(): Page<T> => ({ items: [], nextCursor: null });

/**
 * Adaptador base: implementa todas las capacidades como "unsupported" para
 * que los adaptadores concretos solo sobrescriban lo que su plataforma
 * realmente ofrece. `capabilities` debe ser coherente con lo sobrescrito.
 */
export abstract class BaseFleetAdapter implements FleetProviderAdapter {
  abstract readonly key: ProviderKey;
  abstract readonly displayName: string;
  abstract readonly capabilities: ProviderCapabilities;

  abstract authenticate(credentials: ProviderCredentials): Promise<ProviderCredentials>;
  abstract healthCheck(credentials: ProviderCredentials): Promise<{ ok: boolean; detail?: string }>;

  protected unsupported(what: string): never {
    throw new ProviderError('unsupported', `${this.displayName} no soporta ${what}`);
  }

  async listVehicles(_c: ProviderCredentials, _w: SyncWindow): Promise<Page<VehicleDTO>> {
    return this.capabilities.vehicles ? emptyPage() : this.unsupported('vehículos');
  }
  async listOdometerReadings(_c: ProviderCredentials, _w: SyncWindow): Promise<Page<OdometerReadingDTO>> {
    return this.capabilities.odometer ? emptyPage() : this.unsupported('odómetro');
  }
  async listEngineHours(_c: ProviderCredentials, _w: SyncWindow): Promise<Page<EngineHoursReadingDTO>> {
    return this.capabilities.engineHours ? emptyPage() : this.unsupported('horas de motor');
  }
  async listDrivers(_c: ProviderCredentials, _w: SyncWindow): Promise<Page<DriverDTO>> {
    return this.capabilities.drivers ? emptyPage() : this.unsupported('conductores');
  }
  async listPositions(_c: ProviderCredentials, _w: SyncWindow): Promise<Page<PositionDTO>> {
    return this.capabilities.positions ? emptyPage() : this.unsupported('posiciones');
  }
  async listVehicleStatus(_c: ProviderCredentials, _w: SyncWindow): Promise<Page<VehicleStatusDTO>> {
    return this.capabilities.vehicleStatus ? emptyPage() : this.unsupported('estado del vehículo');
  }
  async listMaintenanceEvents(_c: ProviderCredentials, _w: SyncWindow): Promise<Page<MaintenanceEventDTO>> {
    return this.capabilities.maintenanceEvents ? emptyPage() : this.unsupported('eventos de mantenimiento');
  }
}

/** fetch con clasificación de errores del hub (rate limit, transitorios...). */
export async function providerFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ProviderError('transient', `Error de red llamando a ${url}`, undefined, err);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ProviderError('auth', `Autenticación rechazada (${res.status}) en ${url}`);
  }
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '30', 10) * 1000;
    throw new ProviderError('rate_limit', `Rate limit en ${url}`, retryAfter);
  }
  if (res.status >= 500) {
    throw new ProviderError('transient', `Error ${res.status} del proveedor en ${url}`);
  }
  if (!res.ok) {
    throw new ProviderError('permanent', `Error ${res.status} en ${url}: ${await res.text()}`);
  }
  return res;
}
