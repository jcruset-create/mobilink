/**
 * Mapa de AVL IO IDs de Teltonika a nombres semánticos.
 * IDs según documentación oficial de Teltonika (FMB/FMC series).
 */

export interface IoDefinition {
  name: string;
  /** Factor multiplicador para convertir el valor crudo a la unidad final. */
  scale?: number;
  unit?: string;
}

/** IOs comunes a toda la familia FMB/FMC (GNSS, energía, digitales). */
export const COMMON_IO_MAP: Record<number, IoDefinition> = {
  1: { name: 'din1' },
  2: { name: 'din2' },
  3: { name: 'din3' },
  16: { name: 'totalOdometerGps', unit: 'm' },
  17: { name: 'axisX', unit: 'mG' },
  18: { name: 'axisY', unit: 'mG' },
  19: { name: 'axisZ', unit: 'mG' },
  21: { name: 'gsmSignal' },
  24: { name: 'gpsSpeed', unit: 'km/h' },
  66: { name: 'externalVoltage', scale: 0.001, unit: 'V' },
  67: { name: 'batteryVoltage', scale: 0.001, unit: 'V' },
  68: { name: 'batteryCurrent', scale: 0.001, unit: 'A' },
  69: { name: 'gnssStatus' },
  80: { name: 'dataMode' },
  113: { name: 'batteryLevel', unit: '%' },
  179: { name: 'dout1' },
  180: { name: 'dout2' },
  181: { name: 'gnssPdop', scale: 0.1 },
  182: { name: 'gnssHdop', scale: 0.1 },
  199: { name: 'tripOdometer', unit: 'm' },
  200: { name: 'sleepMode' },
  205: { name: 'gsmCellId' },
  206: { name: 'gsmAreaCode' },
  239: { name: 'ignition' },
  240: { name: 'movement' },
  241: { name: 'activeGsmOperator' },
};

/** IOs CAN (FMS / J1939) presentes en FMC650 y equipos con lectura CAN. */
export const CAN_IO_MAP: Record<number, IoDefinition> = {
  81: { name: 'canVehicleSpeed', unit: 'km/h' },
  82: { name: 'canAcceleratorPedal', unit: '%' },
  83: { name: 'canFuelConsumed', scale: 0.1, unit: 'l' },
  84: { name: 'canFuelLevelLiters', scale: 0.1, unit: 'l' },
  85: { name: 'canRpm', unit: 'rpm' },
  87: { name: 'canTotalMileage', unit: 'm' },
  89: { name: 'canFuelLevelPercent', unit: '%' },
  90: { name: 'canDoorStatus' },
  100: { name: 'canProgramNumber' },
  102: { name: 'canEngineWorktime', unit: 'min' },
  103: { name: 'canEngineWorktimeCounted', unit: 'min' },
  105: { name: 'canTotalMileageCounted', unit: 'm' },
  107: { name: 'canFuelConsumedCounted', scale: 0.1, unit: 'l' },
  110: { name: 'canFuelRate', scale: 0.1, unit: 'l/h' },
  111: { name: 'canAdBlueLevelPercent', unit: '%' },
  115: { name: 'canEngineTemperature', scale: 0.1, unit: 'C' },
  123: { name: 'canControlStateFlags' },
  127: { name: 'canPtoState' },
  517: { name: 'canSecurityStateFlags' },
};

export function mapIoElements(
  elements: Map<number, number | bigint>,
  ioMap: Record<number, IoDefinition>,
): { named: Record<string, number | boolean>; raw: Record<string, number | string> } {
  const named: Record<string, number | boolean> = {};
  const raw: Record<string, number | string> = {};

  for (const [id, value] of elements) {
    const numeric = typeof value === 'bigint' ? Number(value) : value;
    raw[`io${id}`] = Number.isSafeInteger(numeric) ? numeric : value.toString();
    const def = ioMap[id];
    if (!def) continue;
    let v: number | boolean = numeric;
    if (def.scale !== undefined) v = numeric * def.scale;
    // IOs booleanos conocidos
    if (['ignition', 'movement', 'din1', 'din2', 'din3', 'dout1', 'dout2', 'canPtoState'].includes(def.name)) {
      v = numeric === 1;
    }
    named[def.name] = v;
  }

  return { named, raw };
}
