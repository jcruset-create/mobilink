/**
 * Límite de peticiones para las rutas públicas de Satisfaction.
 *
 * ── Por qué en memoria, y qué significa eso ─────────────────────────────────
 *
 * El proyecto no tiene Redis ni ningún limitador, y traer una dependencia de
 * infraestructura entera para dos rutas sería desproporcionado. Esto guarda las
 * marcas en un `Map` del proceso.
 *
 * La consecuencia hay que decirla: **si Render escala a más de una instancia,
 * el límite es por instancia**. Con dos, el techo efectivo es el doble. Sirve
 * para lo que tiene que servir —que nadie recorra el espacio de tokens a base
 * de fuerza bruta, ni reviente la base con un bucle— y no sirve como control
 * de abuso distribuido. Cuando haga falta eso, se cambia el almacén sin tocar
 * las rutas.
 *
 * ── Y por qué los límites son generosos ─────────────────────────────────────
 *
 * Quien contesta está en el móvil, muchas veces en una red compartida: un
 * polígono, un hotel, la wifi de una empresa donde veinte conductores salen
 * por la misma IP. Un límite estrecho por IP no pararía a un atacante —que
 * cambia de IP— y sí dejaría fuera a gente legítima. Así que se ponen holgados
 * y se añade un segundo límite por encuesta, que es el que de verdad acota lo
 * que se puede hacer contra un token concreto.
 */

export type Limite = { peticiones: number; ventanaMs: number };

/** GET: abrir el enlace, recargar, volver atrás. Se recarga mucho. */
export const LIMITE_LECTURA: Limite = { peticiones: 60, ventanaMs: 10 * 60_000 };
/** POST: enviar la valoración. Con reintentos, veinte sobran. */
export const LIMITE_ENVIO: Limite = { peticiones: 20, ventanaMs: 10 * 60_000 };
/** Por encuesta, sea cual sea la IP: nadie contesta la misma treinta veces. */
export const LIMITE_POR_ENCUESTA: Limite = { peticiones: 30, ventanaMs: 10 * 60_000 };

type Marca = { cuenta: number; expiraEnMs: number };

const marcas = new Map<string, Marca>();

/** Cuántas entradas se toleran antes de barrer. Con esto no crece sin fin. */
const MAX_ENTRADAS = 50_000;

function barrer(ahoraMs: number): void {
  for (const [clave, m] of marcas) {
    if (m.expiraEnMs <= ahoraMs) marcas.delete(clave);
  }
}

export type Veredicto = { permitido: boolean; reintentarEnS: number };

/**
 * Consume una unidad del cubo y dice si se permite.
 *
 * Ventana fija, no deslizante: es más tosca —permite una ráfaga a caballo de
 * dos ventanas— y a cambio ocupa un número por clave en vez de una lista de
 * marcas de tiempo. Para lo que hace falta aquí, sobra.
 */
export function consumir(clave: string, limite: Limite, ahoraMs = Date.now()): Veredicto {
  if (marcas.size > MAX_ENTRADAS) barrer(ahoraMs);

  const actual = marcas.get(clave);
  if (!actual || actual.expiraEnMs <= ahoraMs) {
    marcas.set(clave, { cuenta: 1, expiraEnMs: ahoraMs + limite.ventanaMs });
    return { permitido: true, reintentarEnS: 0 };
  }
  actual.cuenta += 1;
  if (actual.cuenta > limite.peticiones) {
    return {
      permitido: false,
      reintentarEnS: Math.max(1, Math.ceil((actual.expiraEnMs - ahoraMs) / 1000)),
    };
  }
  return { permitido: true, reintentarEnS: 0 };
}

/** Solo para las pruebas: deja el contador a cero. */
export function reiniciarLimites(): void {
  marcas.clear();
}
