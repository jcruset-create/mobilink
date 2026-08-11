/**
 * Mobilink Assist Lite — límites de uso de la API de la APK.
 *
 * Hasta ahora lo único limitado era el login por intentos fallidos. El resto
 * de la API quedaba abierta a cualquier dispositivo con sesión válida, y ahí
 * están precisamente las operaciones caras: subida de fotografías (cada una
 * pasa por `sharp` y por Supabase) y envío de posiciones (una fila por punto).
 * Una APK con un bucle mal cerrado o una cola offline reenviándose sin freno
 * bastaba para saturar el servidor sin que nadie se enterase.
 *
 * El contador vive en memoria del proceso, igual que el de los logins. Con
 * varias instancias cada una lleva el suyo, así que el límite efectivo es el
 * configurado por instancia: sirve para frenar un dispositivo desbocado, que es
 * el caso real, no para repartir cuota con precisión.
 *
 * Las funciones son puras sobre un `Map` que se pasa por parámetro y reciben el
 * instante como argumento: así se pueden probar sin esperar a que pase el
 * tiempo de verdad.
 */

export interface LimitPolicy {
  /** Operaciones permitidas dentro de la ventana. */
  limit: number;
  windowMs: number;
}

/**
 * Los números salen del uso real de un servicio, con holgura suficiente para
 * que un operario normal no los roce nunca:
 *
 * - posiciones: el intervalo más agresivo es de 5 s (≈12/min) y se permiten 120
 *   por minuto, diez veces más, para absorber la descarga de una cola offline.
 * - fotos: un servicio bien documentado lleva del orden de 10; se permiten 60
 *   cada 5 minutos.
 * - sincronización: la APK sincroniza al recuperar cobertura, no en bucle.
 */
export const LITE_LIMITS = {
  location: { limit: 120, windowMs: 60_000 },
  locationsBatch: { limit: 20, windowMs: 60_000 },
  status: { limit: 60, windowMs: 60_000 },
  files: { limit: 60, windowMs: 300_000 },
  signature: { limit: 20, windowMs: 300_000 },
  messages: { limit: 60, windowMs: 60_000 },
  sync: { limit: 30, windowMs: 60_000 },
  /** Red de seguridad por dispositivo, por encima de los límites por familia. */
  device: { limit: 900, windowMs: 60_000 },
  /** El login se cuenta por IP, haya acierto o no: frena el sondeo de usuarios. */
  login: { limit: 40, windowMs: 300_000 },
} as const satisfies Record<string, LimitPolicy>;

export type LimitName = keyof typeof LITE_LIMITS;

export interface LimitVerdict {
  allowed: boolean;
  /** Operaciones que aún caben en la ventana actual. */
  remaining: number;
  /** Segundos hasta que vuelva a haber hueco (0 si lo hay ahora). */
  retryAfterSec: number;
}

/** Marcas de tiempo de las últimas operaciones, por clave. */
export type LimitStore = Map<string, number[]>;

export function newLimitStore(): LimitStore {
  return new Map();
}

export function limitKey(name: LimitName, subject: string | number): string {
  return `${name}|${subject}`;
}

/**
 * Anota una operación y dice si se admite. Ventana deslizante: se descartan
 * las marcas que ya han salido de la ventana antes de contar.
 *
 * Cuando se rechaza NO se anota la marca; si no, un cliente insistiendo
 * mantendría la ventana llena para siempre y no saldría nunca del bloqueo.
 */
export function hitLimit(
  store: LimitStore,
  key: string,
  policy: LimitPolicy,
  now: number,
): LimitVerdict {
  const desde = now - policy.windowMs;
  const previas = (store.get(key) ?? []).filter((t) => t > desde);

  if (previas.length >= policy.limit) {
    store.set(key, previas);
    const masAntigua = previas[0];
    const esperaMs = Math.max(0, masAntigua + policy.windowMs - now);
    return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(esperaMs / 1000)) };
  }

  previas.push(now);
  store.set(key, previas);
  return { allowed: true, remaining: policy.limit - previas.length, retryAfterSec: 0 };
}

/**
 * Tira las claves sin actividad reciente. Sin esto el `Map` crece con cada
 * dispositivo que ha pasado por aquí y no se vacía nunca.
 */
export function pruneLimitStore(store: LimitStore, now: number, maxAgeMs = 600_000): number {
  let borradas = 0;
  for (const [key, marcas] of store) {
    const vivas = marcas.filter((t) => t > now - maxAgeMs);
    if (vivas.length === 0) {
      store.delete(key);
      borradas++;
    } else if (vivas.length !== marcas.length) {
      store.set(key, vivas);
    }
  }
  return borradas;
}
