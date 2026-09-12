/**
 * De dónde salen las credenciales de Webfleet de un cliente.
 *
 * Estaba dentro de `server/index.ts`, entre otras 19.000 líneas y sin una sola
 * prueba. Sale aquí porque es el punto por el que pasa TODO acceso a Webfleet
 * —los tres endpoints llaman a `resolveWebfleetCreds()`— y porque es la pieza
 * que hay que cambiar para que las credenciales dejen de vivir en la base de
 * datos. Cambiarla por dentro arregla los tres sitios a la vez.
 *
 * ── El orden, y por qué ─────────────────────────────────────────────────────
 *
 *   1. Gestor de secretos, para ESTA empresa
 *   2. Tabla tc_webfleet_config de esa empresa
 *   3. Variables de entorno globales
 *
 * El gestor va primero porque es el destino: las credenciales no deberían
 * estar en la base, donde una política RLS mal puesta las expone y el panel
 * puede leerlas desde el navegador. La tabla se queda como escalón intermedio
 * para no obligar a migrar todos los clientes de golpe: se carga un cliente en
 * el gestor, se comprueba, y ese cliente ya va por el camino nuevo. Si algo
 * falla, se borra la variable y vuelve al de antes. Reversible cliente a
 * cliente, sin ventana de corte.
 *
 * Las globales siguen al final porque son las que hacen funcionar hoy el
 * módulo de asistencia, cuya cuenta Webfleet es una sola para todos.
 *
 * ── Nombres de las variables ────────────────────────────────────────────────
 *
 * Las resuelve el `SecretsProvider` del Integration Hub, que ya existe y ya es
 * por tenant. El convenio es suyo, no se inventa aquí:
 *
 *   IH_SECRET__<EMPRESA>__WEBFLEET__PASSWORD    (para esa empresa)
 *   IH_SECRET__WEBFLEET__PASSWORD               (para todas, si no hay la suya)
 *
 * donde <EMPRESA> es el uuid de tc_empresas con los guiones convertidos en
 * guiones bajos y en mayúsculas, que es lo que hace su `norm()`.
 *
 * Nótese que `account` y `base_url` NO son secretos —son el nombre de la
 * cuenta y una URL pública— pero se resuelven por la misma vía para que la
 * configuración de un cliente esté en un solo sitio y no repartida entre dos.
 */

import { getSecretsProvider } from "../integration-hub/infrastructure/secrets.ts";
import { supabase } from "../supabase.ts";

export type WebfleetCreds = {
  account?: string | null;
  username?: string | null;
  password?: string | null;
  apikey?: string | null;
  baseUrl?: string | null;
};

/** Clave del conector en el gestor de secretos. */
const CONECTOR = "webfleet";

/**
 * ¿Sirven estas credenciales para llamar a Webfleet?
 *
 * Hacen falta las tres que van en cada petición: cuenta, usuario y contraseña.
 * `apikey` y `baseUrl` son opcionales —hay cuentas sin apikey y la URL tiene
 * valor por defecto—, así que su ausencia no descarta el juego.
 *
 * Se exige que las tres estén para no dejar a medias: un juego incompleto
 * fallaría en la llamada con un error de Webfleet difícil de leer, en vez de
 * caer limpiamente al escalón siguiente, que es lo que se quiere.
 */
export function credencialesCompletas(c: WebfleetCreds | null | undefined): c is WebfleetCreds {
  return !!(c && c.account && c.username && c.password);
}

/**
 * Credenciales de una empresa en el gestor de secretos. null si no están.
 *
 * Con `cuenta` se busca primero el secreto de esa cuenta concreta y, si no lo
 * hay, el del cliente. Un cliente con dos cuentas de Webfleet —cada una con su
 * usuario— necesita ese primer escalón; uno con una sola no tiene que tocar
 * nada, porque el segundo es el de siempre.
 */
export async function credencialesDeSecretos(
  empresaId: string,
  cuenta?: string,
): Promise<WebfleetCreds | null> {
  if (!empresaId) return null;
  const secretos = getSecretsProvider();
  const leer = (nombre: string) => secretos.get(empresaId, CONECTOR, nombre, cuenta);

  const [account, username, password, apikey, baseUrl] = await Promise.all([
    leer("ACCOUNT"),
    leer("USERNAME"),
    leer("PASSWORD"),
    leer("APIKEY"),
    leer("BASE_URL"),
  ]);

  const creds: WebfleetCreds = { account, username, password, apikey, baseUrl };
  return credencialesCompletas(creds) ? creds : null;
}

/**
 * Credenciales de una empresa en tc_webfleet_config.
 *
 * Escalón de transición. La tabla puede no existir siquiera —la migración que
 * la crea se pasa a mano y hay proyectos donde no se pasó—, y entonces la
 * consulta devuelve error: se trata como «no hay credenciales aquí», que es
 * exactamente lo que significa.
 */
export async function credencialesDeTabla(empresaId: string): Promise<WebfleetCreds | null> {
  if (!empresaId) return null;
  const { data, error } = await supabase
    .from("tc_webfleet_config").select("*").eq("empresa_id", empresaId).maybeSingle();
  if (error || !data) return null;

  const d = data as Record<string, unknown>;
  if (!d.activo) return null;

  const creds: WebfleetCreds = {
    account: d.account as string | null,
    username: d.username as string | null,
    password: d.password as string | null,
    apikey: d.apikey as string | null,
    baseUrl: d.base_url as string | null,
  };
  return credencialesCompletas(creds) ? creds : null;
}

/** Credenciales globales de entorno, las de siempre. null si no están puestas. */
export function credencialesGlobales(): WebfleetCreds | null {
  const creds: WebfleetCreds = {
    account: process.env.WEBFLEET_ACCOUNT,
    username: process.env.WEBFLEET_USERNAME,
    password: process.env.WEBFLEET_PASSWORD,
    apikey: process.env.WEBFLEET_API_KEY,
    baseUrl: process.env.WEBFLEET_BASE_URL,
  };
  return credencialesCompletas(creds) ? creds : null;
}

/** De dónde salieron unas credenciales. Para poder registrarlo sin exponerlas. */
export type OrigenCredenciales = "secretos" | "tabla" | "globales" | "ninguno";

export type ResolucionCredenciales = {
  creds: WebfleetCreds | null;
  origen: OrigenCredenciales;
};

/**
 * Resuelve las credenciales y dice de dónde salieron.
 *
 * El origen sirve para poder registrar en el log por qué camino fue —que es lo
 * único que se puede registrar de esto— y para que el panel pueda enseñar si un
 * cliente ya está migrado al gestor sin tener que mirar ningún valor.
 */
export async function resolverCredencialesWebfleet(
  empresaId: string,
  cuenta?: string,
): Promise<ResolucionCredenciales> {
  const deSecretos = await credencialesDeSecretos(empresaId, cuenta);
  if (deSecretos) return { creds: deSecretos, origen: "secretos" };

  // Los dos escalones de abajo NO distinguen cuenta y no pueden: `tc_webfleet_config`
  // tiene una fila por empresa y las variables globales son una sola. Es la vía
  // de transición, y para un cliente con dos cuentas la respuesta correcta es
  // ponerle su secreto por cuenta, no repartir el de la tabla entre las dos.

  const deTabla = await credencialesDeTabla(empresaId);
  if (deTabla) return { creds: deTabla, origen: "tabla" };

  const globales = credencialesGlobales();
  if (globales) return { creds: globales, origen: "globales" };

  return { creds: null, origen: "ninguno" };
}

/**
 * La forma corta, que es la que usan los endpoints: las credenciales o null.
 *
 * Mantiene la firma que tenía en `index.ts` para que los tres sitios que la
 * llaman no se enteren del cambio.
 */
export async function resolveWebfleetCreds(
  empresaId: string,
  cuenta?: string,
): Promise<WebfleetCreds | null> {
  return (await resolverCredencialesWebfleet(empresaId, cuenta)).creds;
}

export function buildWebfleetRequest(action: string, extra: Record<string, string> = {}, creds?: WebfleetCreds): { url: string; headers: Record<string, string> } {
  // Cuando vienen credenciales de un cliente se usan ENTERAS, sin mezclarlas
  // con las globales. Antes cada campo caía por su cuenta a su variable de
  // entorno, así que un cliente con cuenta propia pero sin apikey propia
  // acababa mandando la apikey de la casa junto a su cuenta y su usuario. Un
  // juego mezclado falla de formas que no se parecen a su causa, y además haría
  // mentir al estado que enseña el panel: diría «credenciales del cliente»
  // cuando media petición va con las de la casa.
  //
  // Sin credenciales —el módulo de asistencia, que tiene una sola cuenta para
  // todo— se sigue leyendo el entorno igual que siempre.
  const fuente: WebfleetCreds = creds ?? {
    account: process.env.WEBFLEET_ACCOUNT,
    username: process.env.WEBFLEET_USERNAME,
    password: process.env.WEBFLEET_PASSWORD,
    apikey: process.env.WEBFLEET_API_KEY,
    baseUrl: process.env.WEBFLEET_BASE_URL,
  };
  const account = fuente.account;
  const username = fuente.username;
  const password = fuente.password;
  const apiKey = fuente.apikey;
  const baseUrl = fuente.baseUrl || "https://csv.webfleet.com/extern";

  if (!account || !username || !password) {
    throw new Error("Credenciales Webfleet no configuradas (cuenta, usuario y contraseña)");
  }

  const params = new URLSearchParams({ account, action, lang: "en", outputformat: "json", useISO8601: "true", ...extra });
  if (apiKey) params.set("apikey", apiKey);

  const credentials = Buffer.from(`${username}:${password}`).toString("base64");

  return {
    url: `${baseUrl}?${params.toString()}`,
    headers: { Authorization: `Basic ${credentials}` },
  };
}
