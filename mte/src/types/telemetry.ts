/**
 * Modelo de datos unificado del Mobilink Telematics Engine.
 * Todos los dispositivos, de cualquier fabricante, se normalizan a este modelo.
 */

export type DeviceType = 'FMC150' | 'FMC650' | string;

export interface GpsData {
  latitude: number;
  longitude: number;
  altitude?: number;
  speed: number; // km/h
  heading: number; // grados 0-359
  satellites?: number;
  valid: boolean;
}

export interface EngineData {
  rpm?: number;
  hours?: number; // horas de motor
  ignition?: boolean;
  temperature?: number; // ºC refrigerante
}

export interface VehicleData {
  odometer?: number; // metros (odómetro real CAN si existe, si no GPS)
  odometerSource?: 'can' | 'gps';
  fuelLevel?: number; // %
  fuelConsumed?: number; // litros acumulados
  canSpeed?: number; // km/h desde CAN
  pto?: boolean;
}

export interface PowerData {
  externalVoltage?: number; // V
  batteryVoltage?: number; // V
  batteryCurrent?: number; // A
}

export interface NormalizedTelemetry {
  deviceType: DeviceType;
  imei: string;
  vehicleId: string | null;
  timestamp: string; // ISO 8601
  priority: number;
  eventIoId: number; // ID del IO que disparó el registro (0 = periódico)
  gps: GpsData;
  engine: EngineData;
  vehicle: VehicleData;
  power: PowerData;
  movement?: boolean;
  io: Record<string, number | boolean>;
  raw: Record<string, string | number>;
}

/** Evento de dominio generado a partir de la telemetría normalizada. */
export type TelemetryEventType =
  | 'position'
  | 'ignition_on'
  | 'ignition_off'
  | 'movement_start'
  | 'movement_stop'
  | 'geofence_enter'
  | 'geofence_exit'
  | 'arrival_assistance'
  | 'arrival_customer'
  | 'arrival_workshop'
  | 'alert';

export interface TelemetryEvent {
  type: TelemetryEventType;
  imei: string;
  vehicleId: string | null;
  timestamp: string;
  data: Record<string, unknown>;
}
