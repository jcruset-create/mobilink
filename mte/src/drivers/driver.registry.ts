import { BaseTeltonikaDriver } from './teltonika/baseDriver';
import { Fmc150Driver } from './teltonika/fmc150Driver';
import { Fmc650Driver } from './teltonika/fmc650Driver';

/**
 * Registro de drivers por tipo de dispositivo.
 * Para añadir un fabricante/modelo nuevo: implementar un driver y registrarlo aquí.
 */
const drivers = new Map<string, BaseTeltonikaDriver>();

const fmc150 = new Fmc150Driver();
const fmc650 = new Fmc650Driver();

drivers.set('FMC150', fmc150);
drivers.set('FMC650', fmc650);

/** Driver por defecto para dispositivos Teltonika de modelo desconocido. */
const defaultDriver = fmc150;

export function getDriver(deviceType: string | null | undefined): BaseTeltonikaDriver {
  if (!deviceType) return defaultDriver;
  return drivers.get(deviceType.toUpperCase()) ?? defaultDriver;
}

export function registerDriver(deviceType: string, driver: BaseTeltonikaDriver): void {
  drivers.set(deviceType.toUpperCase(), driver);
}
