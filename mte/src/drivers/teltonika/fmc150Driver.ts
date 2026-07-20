import { BaseTeltonikaDriver } from './baseDriver';

/**
 * Teltonika FMC150: GNSS, ignición, movimiento, voltaje, odómetro GPS,
 * IO digitales y Bluetooth. Sin CAN Bus.
 */
export class Fmc150Driver extends BaseTeltonikaDriver {
  readonly deviceType = 'FMC150';
}
