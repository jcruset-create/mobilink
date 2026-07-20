import { AvlRecord } from '../../types/avl';
import { NormalizedTelemetry } from '../../types/telemetry';
import { COMMON_IO_MAP, IoDefinition, mapIoElements } from '../../decoders/teltonika/avl-io.mapper';

/**
 * Driver base para dispositivos Teltonika.
 * Un driver traduce registros AVL crudos al modelo unificado de Mobilink,
 * aplicando el conocimiento específico del modelo de dispositivo.
 */
export abstract class BaseTeltonikaDriver {
  abstract readonly deviceType: string;

  /** Mapa de IOs soportado por el modelo concreto. */
  protected get ioMap(): Record<number, IoDefinition> {
    return COMMON_IO_MAP;
  }

  normalize(imei: string, record: AvlRecord, vehicleId: string | null): NormalizedTelemetry {
    const { named, raw } = mapIoElements(record.io.elements, this.ioMap);

    const telemetry: NormalizedTelemetry = {
      deviceType: this.deviceType,
      imei,
      vehicleId,
      timestamp: record.timestamp.toISOString(),
      priority: record.priority,
      eventIoId: record.io.eventIoId,
      gps: {
        latitude: record.gps.latitude,
        longitude: record.gps.longitude,
        altitude: record.gps.altitude,
        speed: record.gps.speed,
        heading: record.gps.angle,
        satellites: record.gps.satellites,
        valid: record.gps.satellites > 0 && (record.gps.latitude !== 0 || record.gps.longitude !== 0),
      },
      engine: {
        ignition: typeof named.ignition === 'boolean' ? named.ignition : undefined,
      },
      vehicle: {},
      power: {
        externalVoltage: named.externalVoltage as number | undefined,
        batteryVoltage: named.batteryVoltage as number | undefined,
        batteryCurrent: named.batteryCurrent as number | undefined,
      },
      movement: typeof named.movement === 'boolean' ? named.movement : undefined,
      io: named,
      raw,
    };

    if (typeof named.totalOdometerGps === 'number') {
      telemetry.vehicle.odometer = named.totalOdometerGps;
      telemetry.vehicle.odometerSource = 'gps';
    }

    this.enrich(telemetry, named);
    return telemetry;
  }

  /** Punto de extensión para modelos concretos (CAN, tacógrafo, ...). */
  protected enrich(_telemetry: NormalizedTelemetry, _named: Record<string, number | boolean>): void {
    // Por defecto no hay enriquecimiento adicional.
  }
}
