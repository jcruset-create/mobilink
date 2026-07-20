import {
  DriverDTO,
  EngineHoursReadingDTO,
  MaintenanceEventDTO,
  OdometerReadingDTO,
  Page,
  PositionDTO,
  ProviderKey,
  VehicleDTO,
  VehicleStatusDTO,
} from './dtos';

/** Credenciales genéricas de una conexión a proveedor (por tenant). */
export interface ProviderCredentials {
  /** api_key | oauth2 | basic | session */
  kind: string;
  apiKey?: string;
  username?: string;
  password?: string;
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  /** Epoch ms de expiración del accessToken. */
  expiresAt?: number;
  /** Parámetros extra específicos del proveedor (account, baseUrl, ...). */
  extra?: Record<string, string>;
}

export interface ProviderCapabilities {
  vehicles: boolean;
  odometer: boolean;
  engineHours: boolean;
  drivers: boolean;
  positions: boolean;
  vehicleStatus: boolean;
  maintenanceEvents: boolean;
  canFmsData: boolean;
  webhooks: boolean;
  /** El hub puede escribir datos en el proveedor (ej. crear órdenes). */
  writeBack: boolean;
}

export interface SyncWindow {
  /** ISO desde el que sincronizar (exclusivo). */
  since: string | null;
  /** Cursor opaco de la última página sincronizada. */
  cursor: string | null;
}

/**
 * Contrato del patrón Adapter: cada plataforma de flotas implementa esta
 * interfaz. El resto del hub (sincronización, persistencia, API, webhooks)
 * solo conoce esta interfaz, nunca al proveedor concreto.
 */
export interface FleetProviderAdapter {
  readonly key: ProviderKey;
  readonly displayName: string;
  readonly capabilities: ProviderCapabilities;

  /** Comprueba credenciales; renueva/obtiene tokens si procede.
   *  Devuelve las credenciales posiblemente actualizadas para persistir. */
  authenticate(credentials: ProviderCredentials): Promise<ProviderCredentials>;

  /** Prueba de conectividad ligera (para el alta de la conexión en el panel). */
  healthCheck(credentials: ProviderCredentials): Promise<{ ok: boolean; detail?: string }>;

  listVehicles(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<VehicleDTO>>;
  listOdometerReadings(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<OdometerReadingDTO>>;
  listEngineHours(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<EngineHoursReadingDTO>>;
  listDrivers(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<DriverDTO>>;
  listPositions(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<PositionDTO>>;
  listVehicleStatus(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<VehicleStatusDTO>>;
  listMaintenanceEvents(credentials: ProviderCredentials, window: SyncWindow): Promise<Page<MaintenanceEventDTO>>;

  /** Verifica y normaliza un webhook entrante del proveedor (si soporta webhooks). */
  parseWebhook?(headers: Record<string, string>, body: unknown, secret: string | null): Promise<{
    valid: boolean;
    events: Array<{ type: string; payload: Record<string, unknown> }>;
  }>;
}
