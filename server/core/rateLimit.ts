/**
 * Freno de intentos de autenticación.
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * No había ningún límite en los ocho endpoints de login del servidor. Con PINs
 * de cuatro dígitos y listas de nombres de empleado públicas, el espacio a
 * recorrer era de diez mil combinaciones por persona: cuestión de minutos. Y
 * como las cabeceras de operario se verifican en CADA petición, cualquier GET
 * autenticado servía también de oráculo.
 *
 * ── Dos claves por intento, y por qué ───────────────────────────────────────
 *
 * Se cuenta a la vez por **origen** (IP) y por **identidad** (el usuario que se
 * intenta). Con una sola no basta:
 *
 *   · solo por IP → quien tiene muchas IPs prueba tranquilo;
 *   · solo por identidad → quien recorre la lista de empleados probando `0000`
 *     en cada uno nunca gasta el cupo de ninguno.
 *
 * El límite por identidad es más estrecho que el de origen, porque un polígono
 * entero puede salir por una sola IP —ese razonamiento ya está escrito en
 * `server/satisfaction/rateLimit.ts`— y no se quiere echar a gente legítima.
 *
 * ── Memoria y, si se puede, base de datos ───────────────────────────────────
 *
 * El contador vive en memoria del proceso. Eso solo tiene un agujero real:
 * **un reinicio pone los contadores a cero**, y este servicio está en un plan
 * que reinicia. Así que los BLOQUEOS (no cada intento fallido) se persisten,
 * cuando hay dónde.
 *
 * Y «cuando hay dónde» es literal: la tabla `app_auth_intentos` llega en una
 * migración que todavía no está aplicada. El módulo tiene que funcionar sin
 * ella, o el despliegue de este arreglo dependería de aplicar una migración a
 * producción el mismo día. Por eso la persistencia es un gancho que se conecta
 * desde fuera (`configurarPersistencia`) y que se desactiva solo si falla: sin
 * tabla, el freno sigue funcionando en memoria, que es lo que hay hoy y ya es
 * infinitamente mejor que nada.
 */

export type Politica = {
  /** Fallos tolerados dentro de la ventana antes de empezar a bloquear. */
  maxFallos: number;
  ventanaMs: number;
  /** Primer bloqueo. Se duplica con cada tanda de fallos, hasta el tope. */
  bloqueoBaseMs: number;
  bloqueoMaxMs: number;
};

/**
 * Login con contraseña o PIN. Diez fallos por identidad es más de lo que se
 * equivoca cualquiera y muy poco para recorrer diez mil PINs.
 */
export const POLITICA_LOGIN_IDENTIDAD: Politica = {
  maxFallos: 10,
  ventanaMs: 15 * 60_000,
  bloqueoBaseMs: 60_000,
  bloqueoMaxMs: 30 * 60_000,
};

/** Por IP: holgado, porque detrás puede haber un taller entero. */
export const POLITICA_LOGIN_ORIGEN: Politica = {
  maxFallos: 60,
  ventanaMs: 15 * 60_000,
  bloqueoBaseMs: 60_000,
  bloqueoMaxMs: 15 * 60_000,
};

/** Segundo factor y códigos de recuperación: aquí no hay excusa para fallar. */
export const POLITICA_SEGUNDO_FACTOR: Politica = {
  maxFallos: 6,
  ventanaMs: 15 * 60_000,
  bloqueoBaseMs: 5 * 60_000,
  bloqueoMaxMs: 60 * 60_000,
};

/** Envío de correos de recuperación: evita usarlo como cañón de spam. */
export const POLITICA_RECUPERACION: Politica = {
  maxFallos: 5,
  ventanaMs: 60 * 60_000,
  bloqueoBaseMs: 10 * 60_000,
  bloqueoMaxMs: 60 * 60_000,
};

type Entrada = {
  fallos: number;
  ventanaExpiraMs: number;
  bloqueadoHastaMs: number;
  /** Cuántas veces se ha bloqueado ya esta clave: el bloqueo va creciendo. */
  bloqueos: number;
};

const entradas = new Map<string, Entrada>();
const MAX_ENTRADAS = 50_000;

/*
 * Una sola forma, no una unión discriminada: el typecheck del servidor va con
 * `strict: false`, y ahí TypeScript no estrecha una unión por un booleano, así
 * que `if (!v.permitido) v.reintentarEnS` no compilaría.
 */
export type Veredicto = { permitido: boolean; reintentarEnS: number; clave: string | null };

type Persistencia = {
  cargar(clave: string): Promise<{ bloqueadoHastaMs: number; bloqueos: number } | null>;
  guardar(clave: string, estado: { bloqueadoHastaMs: number; bloqueos: number }): Promise<void>;
};

let persistencia: Persistencia | null = null;

/**
 * Conecta un almacén para que los bloqueos sobrevivan a un reinicio.
 *
 * Se llama desde `server/index.ts` cuando la tabla existe. Si cualquier
 * operación falla, se desconecta y se sigue en memoria: un fallo de
 * persistencia no puede dejar sin freno al login.
 */
export function configurarPersistencia(p: Persistencia | null): void {
  persistencia = p;
}

function desconectarPorFallo(e: unknown): void {
  console.warn("rateLimit: persistencia desactivada,", e);
  persistencia = null;
}

function barrer(ahoraMs: number): void {
  for (const [clave, e] of entradas) {
    if (e.ventanaExpiraMs <= ahoraMs && e.bloqueadoHastaMs <= ahoraMs) entradas.delete(clave);
  }
}

/** `tipo:ámbito:valor`, en minúsculas. El valor nunca es la contraseña. */
export function clave(tipo: string, ambito: "id" | "ip", valor: string): string {
  return `${tipo}:${ambito}:${String(valor || "?").trim().toLowerCase()}`;
}

/** Si la clave está bloqueada ahora mismo. No cuenta como intento. */
export function comprobar(clave: string, ahoraMs = Date.now()): Veredicto {
  const e = entradas.get(clave);
  if (!e || e.bloqueadoHastaMs <= ahoraMs) {
    return { permitido: true, reintentarEnS: 0, clave: null };
  }
  return {
    permitido: false,
    reintentarEnS: Math.max(1, Math.ceil((e.bloqueadoHastaMs - ahoraMs) / 1000)),
    clave,
  };
}

/**
 * Apunta un fallo y devuelve el veredicto para el intento SIGUIENTE.
 *
 * El bloqueo crece: 1 min, 2, 4… hasta el tope de la política. Quien se
 * equivoca dos veces no lo nota; quien está probando en serie se queda fuera
 * enseguida y cada vez más tiempo.
 */
export function registrarFallo(clave: string, politica: Politica, ahoraMs = Date.now()): Veredicto {
  if (entradas.size > MAX_ENTRADAS) barrer(ahoraMs);

  let e = entradas.get(clave);
  if (!e || e.ventanaExpiraMs <= ahoraMs) {
    e = {
      fallos: 0,
      ventanaExpiraMs: ahoraMs + politica.ventanaMs,
      bloqueadoHastaMs: e?.bloqueadoHastaMs ?? 0,
      bloqueos: e?.bloqueos ?? 0,
    };
    entradas.set(clave, e);
  }

  e.fallos += 1;
  if (e.fallos >= politica.maxFallos) {
    const factor = 2 ** Math.min(e.bloqueos, 10);
    const duracion = Math.min(politica.bloqueoBaseMs * factor, politica.bloqueoMaxMs);
    e.bloqueadoHastaMs = ahoraMs + duracion;
    e.bloqueos += 1;
    e.fallos = 0;
    e.ventanaExpiraMs = ahoraMs + politica.ventanaMs;

    if (persistencia) {
      void persistencia
        .guardar(clave, { bloqueadoHastaMs: e.bloqueadoHastaMs, bloqueos: e.bloqueos })
        .catch(desconectarPorFallo);
    }
  }
  return comprobar(clave, ahoraMs);
}

/**
 * Login correcto: se olvidan los fallos.
 *
 * El contador de bloqueos NO se olvida dentro de la ventana, para que no se
 * pueda usar un acceso legítimo propio para reiniciar el castigo de una IP que
 * está probando contra otras cuentas.
 */
export function registrarExito(clave: string, ahoraMs = Date.now()): void {
  const e = entradas.get(clave);
  if (!e) return;
  e.fallos = 0;
  if (e.bloqueadoHastaMs <= ahoraMs && e.ventanaExpiraMs <= ahoraMs) entradas.delete(clave);
}

/**
 * Trae de la base el bloqueo de una clave si el proceso acaba de arrancar.
 *
 * Solo hace falta la primera vez que se ve la clave: a partir de ahí la copia
 * en memoria manda.
 */
export async function precargar(clave: string, ahoraMs = Date.now()): Promise<void> {
  if (!persistencia || entradas.has(clave)) return;
  try {
    const guardado = await persistencia.cargar(clave);
    if (guardado && guardado.bloqueadoHastaMs > ahoraMs) {
      entradas.set(clave, {
        fallos: 0,
        ventanaExpiraMs: 0,
        bloqueadoHastaMs: guardado.bloqueadoHastaMs,
        bloqueos: guardado.bloqueos,
      });
    }
  } catch (e) {
    desconectarPorFallo(e);
  }
}

export type Ambitos = { tipo: string; identidad?: string | null; ip?: string | null };

/**
 * Comprueba los dos ámbitos de un intento. Devuelve el primero bloqueado.
 *
 * El orden importa poco para la seguridad y mucho para el mensaje: se mira
 * primero la identidad, que es el bloqueo que le interesa entender a quien
 * está intentando entrar en su propia cuenta.
 */
export async function comprobarIntento(a: Ambitos, ahoraMs = Date.now()): Promise<Veredicto> {
  const claves: string[] = [];
  if (a.identidad) claves.push(clave(a.tipo, "id", a.identidad));
  if (a.ip) claves.push(clave(a.tipo, "ip", a.ip));

  for (const c of claves) {
    await precargar(c, ahoraMs);
    const v = comprobar(c, ahoraMs);
    if (!v.permitido) return v;
  }
  return { permitido: true, reintentarEnS: 0, clave: null };
}

/** Apunta el fallo en los dos ámbitos, cada uno con su política. */
export function registrarFalloIntento(a: Ambitos, ahoraMs = Date.now()): void {
  if (a.identidad) {
    registrarFallo(clave(a.tipo, "id", a.identidad), POLITICA_LOGIN_IDENTIDAD, ahoraMs);
  }
  if (a.ip) registrarFallo(clave(a.tipo, "ip", a.ip), POLITICA_LOGIN_ORIGEN, ahoraMs);
}

/** Limpia los fallos de los dos ámbitos tras un acceso correcto. */
export function registrarExitoIntento(a: Ambitos, ahoraMs = Date.now()): void {
  if (a.identidad) registrarExito(clave(a.tipo, "id", a.identidad), ahoraMs);
  if (a.ip) registrarExito(clave(a.tipo, "ip", a.ip), ahoraMs);
}

/** Solo para las pruebas. */
export function reiniciar(): void {
  entradas.clear();
  persistencia = null;
}
