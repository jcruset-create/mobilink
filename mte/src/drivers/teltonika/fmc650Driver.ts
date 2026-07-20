import { BaseTeltonikaDriver } from './baseDriver';
import { NormalizedTelemetry } from '../../types/telemetry';
import { CAN_IO_MAP, COMMON_IO_MAP, IoDefinition } from '../../decoders/teltonika/avl-io.mapper';

/**
 * Teltonika FMC650: todo lo del FMC150 más CAN Bus (FMS / J1939):
 * odómetro real, horas de motor, combustible, RPM, temperatura, PTO,
 * velocidad CAN y datos de camión/autobús.
 */
export class Fmc650Driver extends BaseTeltonikaDriver {
  readonly deviceType = 'FMC650';

  protected get ioMap(): Record<number, IoDefinition> {
    return { ...COMMON_IO_MAP, ...CAN_IO_MAP };
  }

  protected enrich(t: NormalizedTelemetry, named: Record<string, number | boolean>): void {
    if (typeof named.canRpm === 'number') t.engine.rpm = named.canRpm;
    if (typeof named.canEngineWorktime === 'number') t.engine.hours = named.canEngineWorktime / 60;
    if (typeof named.canEngineTemperature === 'number') t.engine.temperature = named.canEngineTemperature;

    // El odómetro CAN tiene prioridad sobre el GPS
    if (typeof named.canTotalMileage === 'number') {
      t.vehicle.odometer = named.canTotalMileage;
      t.vehicle.odometerSource = 'can';
    }
    if (typeof named.canFuelLevelPercent === 'number') t.vehicle.fuelLevel = named.canFuelLevelPercent;
    if (typeof named.canFuelConsumed === 'number') t.vehicle.fuelConsumed = named.canFuelConsumed;
    if (typeof named.canVehicleSpeed === 'number') t.vehicle.canSpeed = named.canVehicleSpeed;
    if (typeof named.canPtoState === 'boolean') t.vehicle.pto = named.canPtoState;
  }
}
