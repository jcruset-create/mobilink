import { AvlRecord } from '../types/avl';
import { NormalizedTelemetry } from '../types/telemetry';
import { getDriver } from '../drivers/driver.registry';
import { normalizePosition } from './position.normalizer';

/**
 * Punto único de normalización: registro AVL crudo -> modelo unificado Mobilink.
 * Selecciona el driver por tipo de dispositivo y sanea la posición resultante.
 */
export function normalizeTelemetry(
  imei: string,
  deviceType: string | null,
  vehicleId: string | null,
  record: AvlRecord,
): NormalizedTelemetry {
  const driver = getDriver(deviceType);
  const telemetry = driver.normalize(imei, record, vehicleId);
  normalizePosition(telemetry);
  return telemetry;
}
