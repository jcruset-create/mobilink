/**
 * Lo que quedó de la última conciliación, guardado.
 *
 * Hace falta por dos motivos que no se resuelven con el endpoint que ya hay:
 *
 * 1. El contador del menú. Conciliar de verdad significa pedirle al proveedor
 *    la flota entera —751 vehículos en el caso de Movertis— cada vez que
 *    alguien abre el panel. Un distintivo en el menú no puede costar eso, así
 *    que enseña el recuento de la última pasada, con su fecha al lado para que
 *    se vea de cuándo es.
 *
 * 2. Las altas y las bajas. Saber que hay 615 vehículos sin enlazar no dice si
 *    alguno es NUEVO. Para eso hay que comparar con la pasada anterior, y para
 *    comparar hay que haberla guardado.
 *
 * Se reutiliza `integration_sync_state`, que es exactamente la tabla de marcas
 * de agua del Hub, en vez de crear una tabla nueva: la clave es
 * (tenant_id, entity) y aquí `entity` es 'vehicle_reconciliation'.
 */

import { getSyncState, upsertSyncState } from "../../integration-hub/infrastructure/repositories.ts";

export const ENTIDAD_CONCILIACION = "vehicle_reconciliation";

/**
 * Tope de identificadores externos que se guardan.
 *
 * No es por espacio —la columna es TEXT— sino para que una flota absurdamente
 * grande no convierta cada lectura del contador en descargar un megabyte. Al
 * pasarse, se deja de guardar la lista y se dice que no está completa, que es
 * distinto de guardar media lista y creerse las bajas que salgan de ella.
 */
export const MAX_EXTERNOS_GUARDADOS = 5000;

export interface CuentaGuardada {
  connectorKey: string;
  accountKey: string;
  ok: boolean;
  error?: string;
}

export interface EstadoConciliacion {
  version: 1;
  ejecutadoMs: number;
  /** El del resumen: 'complete' | 'incomplete' | 'error'. */
  status: string;
  /** Enlazados automáticamente por coincidencia exacta en esa pasada. */
  enlazadosAuto: number;
  pendientes: {
    soloProveedor: number;
    soloTyreControl: number;
    discrepancias: number;
  };
  cuentas: CuentaGuardada[];
  /**
   * Todo lo que devolvió el proveedor, enlazado o no.
   *
   * Es la base de la comparación: un alta es un externo que no estaba la vez
   * anterior, y una baja uno que estaba y ya no. Se guarda la lista entera, no
   * solo la de los no enlazados, porque un vehículo nuevo que el propio
   * proceso acaba de enlazar sigue siendo un alta digna de contar.
   */
  externosVistos: string[];
  /** Falso si la lista se dejó de guardar por tamaño o la pasada no fue completa. */
  externosCompletos: boolean;
}

export interface Cambios {
  /** Externos que aparecen ahora y no estaban. */
  altas: string[];
  /** Externos que estaban y ya no aparecen. */
  bajas: string[];
  /**
   * Si la comparación significa algo.
   *
   * Falso cuando no hay pasada anterior, cuando alguna de las dos no fue
   * completa o cuando la lista estaba recortada. En esos casos las diferencias
   * que salgan no son altas ni bajas: son huecos.
   */
  comparable: boolean;
}

/** El estado guardado de una empresa, o null si nunca se ha conciliado. */
export async function leerEstado(empresaId: string): Promise<EstadoConciliacion | null> {
  const fila = await getSyncState(empresaId, ENTIDAD_CONCILIACION);
  if (!fila?.detail) return null;
  try {
    const dato = JSON.parse(String(fila.detail));
    if (!dato || typeof dato !== "object" || dato.version !== 1) return null;
    return {
      version: 1,
      ejecutadoMs: Number(dato.ejecutadoMs) || Number(fila.last_sync_ms) || 0,
      status: String(dato.status ?? "error"),
      enlazadosAuto: Number(dato.enlazadosAuto) || 0,
      pendientes: {
        soloProveedor: Number(dato.pendientes?.soloProveedor) || 0,
        soloTyreControl: Number(dato.pendientes?.soloTyreControl) || 0,
        discrepancias: Number(dato.pendientes?.discrepancias) || 0,
      },
      cuentas: Array.isArray(dato.cuentas) ? dato.cuentas : [],
      externosVistos: Array.isArray(dato.externosVistos) ? dato.externosVistos.map(String) : [],
      externosCompletos: dato.externosCompletos === true,
    };
  } catch {
    // Un JSON corrupto no debe tumbar el panel ni el proceso quincenal: se
    // trata como «no hay pasada anterior» y la siguiente lo sobrescribe.
    return null;
  }
}

export async function guardarEstado(empresaId: string, estado: EstadoConciliacion): Promise<void> {
  const recortar = estado.externosVistos.length > MAX_EXTERNOS_GUARDADOS;
  const aGuardar: EstadoConciliacion = recortar
    ? { ...estado, externosVistos: [], externosCompletos: false }
    : estado;

  await upsertSyncState({
    tenantId: empresaId,
    entity: ENTIDAD_CONCILIACION,
    lastSyncMs: estado.ejecutadoMs,
    status: estado.status,
    detail: JSON.stringify(aGuardar),
  });
}

/** Qué ha cambiado en el proveedor de una pasada a la siguiente. */
export function calcularCambios(
  previo: EstadoConciliacion | null,
  actual: EstadoConciliacion,
): Cambios {
  const comparable =
    previo != null &&
    previo.externosCompletos &&
    actual.externosCompletos &&
    previo.status === "complete" &&
    actual.status === "complete";

  if (!comparable || !previo) return { altas: [], bajas: [], comparable: false };

  const antes = new Set(previo.externosVistos);
  const ahora = new Set(actual.externosVistos);
  return {
    altas: actual.externosVistos.filter((e) => !antes.has(e)),
    bajas: previo.externosVistos.filter((e) => !ahora.has(e)),
    comparable: true,
  };
}
