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
 * Cada cuánto se repasa una empresa, y cada cuánto se mira el reloj.
 *
 * Viven aquí y no en `worker.ts` porque de ellas depende algo más que el
 * temporizador: cuánto tiempo sigue valiendo el estado guardado. La frescura de
 * esta foto y la cadencia del proceso que la renueva son el mismo hecho, y
 * tenerlas en dos sitios es la forma de que un día dejen de cuadrar.
 */
export const PERIODO_REPASO_MS = 14 * 24 * 60 * 60 * 1000;
export const LATIDO_REPASO_MS = 6 * 60 * 60 * 1000;

/**
 * Cuánto puede tener el estado guardado y seguir sirviendo para afirmar
 * ausencias.
 *
 * No es un número elegido a dedo: sale de los dos de arriba. El repaso toca
 * cada catorce días y el reloj se mira cada seis horas, así que un estado sano
 * tiene como mucho `periodo + latido`. Por encima de eso el repaso NO ha
 * corrido —servidor caído, proceso parado, empresa que dejó de tener
 * telemática—, y entonces la foto no está vieja por diseño sino porque algo no
 * funciona. Dar de baja un vehículo por «no aparece» apoyándose en una foto así
 * es afirmar una ausencia que nadie ha comprobado.
 *
 * En la práctica este tope casi nunca muerde: la pantalla concilia en vivo al
 * abrirse y guarda el estado, así que cuando alguien pulsa «dar de baja» la
 * foto es de hace segundos. Lo que corta son las fotos de meses atrás.
 */
export const VENTANA_FRESCURA_MS = PERIODO_REPASO_MS + LATIDO_REPASO_MS;

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


// ── ¿Se puede afirmar que un vehículo ya no está? ───────────────────────────
//
// La pantalla deshabilita el botón de baja cuando la conciliación no es
// completa, y eso no protege nada: un POST directo, una pestaña abierta desde
// antes de que el proveedor se cayera o un cliente modificado se lo saltan. La
// regla tiene que estar donde se escribe, y el servidor no puede fiarse de un
// booleano que venga del navegador.
//
// Lo que se comprueba no es «la conciliación fue bien» en general, sino algo
// más estrecho: que ESA cuenta contestó en la última pasada. Con dos cuentas,
// que la de autobuses conteste no dice nada de los vehículos de la auxiliar.

/** Por qué no se puede dar de baja. Los códigos viajan a la pantalla. */
export const MOTIVOS_BAJA_BLOQUEADA = {
  /** Nunca se ha conciliado esta empresa. */
  SIN_CONCILIACION: "RECONCILIATION_MISSING",
  /** Alguna cuenta falló: no se sabe qué vehículos han desaparecido. */
  INCOMPLETA: "RECONCILIATION_NOT_COMPLETE",
  /** No contestó ninguna cuenta. */
  CON_ERROR: "RECONCILIATION_ERROR",
  /** La cuenta desde la que se pide la baja no estaba en la última pasada. */
  CUENTA_NO_CONCILIADA: "RECONCILIATION_ACCOUNT_MISSING",
  /** La última pasada es tan antigua que el repaso no ha corrido. */
  CADUCADA: "RECONCILIATION_STALE",
} as const;

export type MotivoBajaBloqueada =
  (typeof MOTIVOS_BAJA_BLOQUEADA)[keyof typeof MOTIVOS_BAJA_BLOQUEADA];

/**
 * Discriminado por CADENA y no por un booleano `permitido`, como el resto de
 * los resultados del proyecto (`ResultadoKilometraje`, `ResultadoConciliacion`).
 * No es cosmético: `tsconfig.server.json` va con `strict: false`, y sin
 * `strictNullChecks` TypeScript no estrecha una unión por un discriminante
 * booleano, así que `if (!p.permitido)` dejaba `p.codigo` fuera del tipo.
 */
export type PermisoBaja =
  | { estado: "permitido"; ejecutadoMs: number }
  | { estado: "bloqueado"; codigo: MotivoBajaBloqueada; mensaje: string };

/**
 * ¿Permite el estado guardado dar de baja en esta cuenta? Función pura.
 *
 * Los mensajes se escriben para leerse en la pantalla y NO llevan datos de
 * nadie: ni matrículas, ni identificadores de vehículo, ni nada de otra
 * empresa. El nombre de la cuenta sí, porque es la del propio cliente y es lo
 * que dice qué hay que arreglar.
 */
export function permisoDeBaja(params: {
  estado: EstadoConciliacion | null;
  connectorKey: string;
  accountKey: string;
  ahoraMs: number;
  /** Para poder probar el tope sin tocar el reloj. */
  ventanaMs?: number;
}): PermisoBaja {
  const { estado, connectorKey, accountKey, ahoraMs } = params;
  const ventanaMs = params.ventanaMs ?? VENTANA_FRESCURA_MS;

  if (!estado) {
    return {
      estado: "bloqueado",
      codigo: MOTIVOS_BAJA_BLOQUEADA.SIN_CONCILIACION,
      mensaje:
        "No se puede dar de baja: esta empresa no se ha conciliado nunca, así que no " +
        "hay nada que demuestre que el vehículo ya no está en el proveedor. Concilia primero.",
    };
  }

  if (estado.status === "error") {
    return {
      estado: "bloqueado",
      codigo: MOTIVOS_BAJA_BLOQUEADA.CON_ERROR,
      mensaje:
        "No se puede dar de baja: en la última conciliación no contestó ninguna cuenta " +
        "del proveedor. Que no se pueda preguntar no significa que los vehículos hayan desaparecido.",
    };
  }
  if (estado.status !== "complete") {
    return {
      estado: "bloqueado",
      codigo: MOTIVOS_BAJA_BLOQUEADA.INCOMPLETA,
      mensaje:
        "No se puede dar de baja: la última conciliación fue incompleta, así que no se " +
        "puede determinar qué vehículos han desaparecido. Vuelve a conciliar cuando el proveedor responda.",
    };
  }

  // El estado es de toda la empresa; la baja se pide desde UNA cuenta. Que la
  // pasada fuera completa no sirve si esta cuenta no estaba en ella.
  const cuenta = estado.cuentas.find(
    (c) => c.connectorKey === connectorKey && c.accountKey === accountKey,
  );
  if (!cuenta || !cuenta.ok) {
    return {
      estado: "bloqueado",
      codigo: MOTIVOS_BAJA_BLOQUEADA.CUENTA_NO_CONCILIADA,
      mensaje:
        `No se puede dar de baja: la cuenta «${accountKey}» de ${connectorKey} no ` +
        "consta como conciliada correctamente en la última pasada.",
    };
  }

  const antiguedad = ahoraMs - estado.ejecutadoMs;
  if (!(estado.ejecutadoMs > 0) || antiguedad > ventanaMs) {
    const dias = Math.floor(antiguedad / (24 * 60 * 60 * 1000));
    return {
      estado: "bloqueado",
      codigo: MOTIVOS_BAJA_BLOQUEADA.CADUCADA,
      mensaje:
        `No se puede dar de baja: la última conciliación es de hace ${dias} días y el ` +
        "repaso debería haber pasado antes, así que esa foto ya no demuestra nada. Vuelve a conciliar.",
    };
  }

  return { estado: "permitido", ejecutadoMs: estado.ejecutadoMs };
}
