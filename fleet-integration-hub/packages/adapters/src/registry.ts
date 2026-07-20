import { FleetProviderAdapter, ProviderKey } from '@fih/domain';
import { MovertisAdapter } from './movertis/movertis.adapter';
import { MteAdapter } from './mte/mte.adapter';

/**
 * Registro de adaptadores disponibles.
 * Para incorporar un proveedor nuevo (Webfleet, Geotab, Samsara, ...):
 *   1. Crear carpeta src/<proveedor>/ con client + mapper + adapter
 *   2. Registrarlo aquí
 * El resto del hub no cambia.
 */
const adapters = new Map<ProviderKey, FleetProviderAdapter>();

export function registerAdapter(adapter: FleetProviderAdapter): void {
  adapters.set(adapter.key, adapter);
}

registerAdapter(new MovertisAdapter());
registerAdapter(new MteAdapter());

export function getAdapter(key: ProviderKey): FleetProviderAdapter {
  const adapter = adapters.get(key);
  if (!adapter) throw new Error(`Proveedor no soportado: ${key}`);
  return adapter;
}

export function listAdapters(): FleetProviderAdapter[] {
  return [...adapters.values()];
}
