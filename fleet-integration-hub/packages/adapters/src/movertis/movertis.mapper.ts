import {
  DriverDTO,
  EngineHoursReadingDTO,
  OdometerReadingDTO,
  PositionDTO,
  VehicleCategory,
  VehicleDTO,
} from '@fih/domain';
import { MovertisDriver, MovertisPosition, MovertisVehicle } from './movertis.client';

const PROVIDER = 'movertis' as const;

function mapCategory(type?: string): VehicleCategory {
  switch ((type ?? '').toLowerCase()) {
    case 'truck':
    case 'camion':
    case 'camión':
      return 'truck';
    case 'bus':
    case 'autobus':
    case 'autobús':
      return 'bus';
    case 'van':
    case 'furgoneta':
      return 'van';
    case 'trailer':
    case 'remolque':
      return 'trailer';
    default:
      return 'other';
  }
}

export function mapVehicle(v: MovertisVehicle): VehicleDTO {
  return {
    externalId: v.id,
    provider: PROVIDER,
    plate: v.registration ?? null,
    vin: v.vin ?? null,
    name: v.alias ?? null,
    brand: v.brand ?? null,
    model: v.model ?? null,
    category: mapCategory(v.type),
    axleConfiguration: null,
    active: v.active ?? true,
    raw: v as unknown as Record<string, unknown>,
  };
}

export function mapOdometer(v: MovertisVehicle, timestamp: string): OdometerReadingDTO | null {
  if (typeof v.odometer_km !== 'number') return null;
  return {
    externalVehicleId: v.id,
    provider: PROVIDER,
    timestamp,
    odometerMeters: Math.round(v.odometer_km * 1000),
    source: 'unknown',
  };
}

export function mapEngineHours(v: MovertisVehicle, timestamp: string): EngineHoursReadingDTO | null {
  if (typeof v.engine_hours !== 'number') return null;
  return { externalVehicleId: v.id, provider: PROVIDER, timestamp, engineHours: v.engine_hours };
}

export function mapPosition(p: MovertisPosition): PositionDTO {
  return {
    externalVehicleId: p.vehicle_id,
    provider: PROVIDER,
    timestamp: p.timestamp,
    latitude: p.lat,
    longitude: p.lon,
    speed: p.speed_kmh ?? null,
    heading: p.heading ?? null,
    ignition: p.ignition ?? null,
  };
}

export function mapDriver(d: MovertisDriver): DriverDTO {
  return {
    externalId: d.id,
    provider: PROVIDER,
    name: d.name ?? null,
    phone: d.phone ?? null,
    email: d.email ?? null,
    licenseNumber: null,
    currentVehicleExternalId: d.vehicle_id ?? null,
  };
}
