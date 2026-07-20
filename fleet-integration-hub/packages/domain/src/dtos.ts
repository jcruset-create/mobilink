/**
 * DTOs comunes del Fleet Integration Hub.
 * Todos los proveedores (Movertis, Webfleet, Geotab, MTE propio, ...) se
 * normalizan a estas estructuras. Es el contrato que consume la aplicación
 * de gestión de neumáticos (TyreControl) y el resto de módulos Mobilink.
 */

export type ProviderKey =
  | 'movertis'
  | 'webfleet'
  | 'geotab'
  | 'samsara'
  | 'wialon'
  | 'mapon'
  | 'verizon-connect'
  | 'michelin-connected-fleet'
  | 'mte' // motor telemático propio de Mobilink
  | string;

export type VehicleCategory = 'truck' | 'bus' | 'van' | 'trailer' | 'car' | 'machine' | 'other';

export interface VehicleDTO {
  /** ID canónico dentro del hub (null hasta persistir). */
  id?: string;
  /** ID del vehículo en el sistema del proveedor. */
  externalId: string;
  provider: ProviderKey;
  plate: string | null;
  vin: string | null;
  name: string | null;
  brand: string | null;
  model: string | null;
  category: VehicleCategory;
  /** Configuración de ejes/neumáticos si el proveedor la expone (raro). */
  axleConfiguration: string | null;
  active: boolean;
  raw?: Record<string, unknown>;
}

export interface OdometerReadingDTO {
  externalVehicleId: string;
  provider: ProviderKey;
  timestamp: string; // ISO 8601
  /** Kilometraje en metros. */
  odometerMeters: number;
  source: 'can' | 'gps' | 'declared' | 'unknown';
}

export interface EngineHoursReadingDTO {
  externalVehicleId: string;
  provider: ProviderKey;
  timestamp: string;
  engineHours: number;
}

export interface DriverDTO {
  externalId: string;
  provider: ProviderKey;
  name: string | null;
  phone: string | null;
  email: string | null;
  licenseNumber: string | null;
  /** Vehículo asignado actualmente, si el proveedor lo expone. */
  currentVehicleExternalId: string | null;
}

export interface PositionDTO {
  externalVehicleId: string;
  provider: ProviderKey;
  timestamp: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  ignition: boolean | null;
}

export interface VehicleStatusDTO {
  externalVehicleId: string;
  provider: ProviderKey;
  timestamp: string;
  ignition: boolean | null;
  moving: boolean | null;
  /** Datos CAN/FMS si existen. */
  can: {
    fuelLevelPercent?: number;
    rpm?: number;
    engineTemperature?: number;
    totalFuelConsumedLiters?: number;
  } | null;
}

export interface MaintenanceEventDTO {
  externalId: string;
  externalVehicleId: string;
  provider: ProviderKey;
  timestamp: string;
  type: string; // service_due | dtc_fault | inspection | custom...
  description: string | null;
  data: Record<string, unknown>;
}

/** Página genérica para sincronización incremental. */
export interface Page<T> {
  items: T[];
  /** Cursor opaco del proveedor para la siguiente página; null = fin. */
  nextCursor: string | null;
}
