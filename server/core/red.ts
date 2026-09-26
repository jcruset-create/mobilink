/**
 * Peticiones salientes seguras (anti-SSRF).
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 *
 * Había varios sitios que hacían `fetch()` con una URL que venía del exterior:
 * el `MediaUrl0` del webhook de WhatsApp (que además se descargaba **con las
 * credenciales de Twilio en la cabecera**), el enlace de mapa del cuerpo de un
 * mensaje, la URL de `files-from-url`, el `baseUrl` de un conector. Con eso,
 * quien podía decidir la URL podía:
 *
 *   · recibir la cabecera `Authorization` que el servidor añadía —o sea,
 *     quedarse con la credencial—;
 *   · hacer que el servidor leyera servicios internos (`localhost:PORT`, y en
 *     este despliegue hay rutas internas sin autenticación) o los metadatos del
 *     proveedor de cloud (`169.254.169.254`);
 *   · usar los códigos de respuesta y los tiempos como oráculo de qué hay
 *     escuchando en la red privada.
 *
 * La regla que impone este módulo: **una petición saliente con datos de fuera
 * declara a qué hosts puede ir.** No hay modo «a cualquier sitio».
 *
 * ── Dos controles, en este orden ─────────────────────────────────────────────
 *
 * 1. **Lista blanca de hosts.** Es el control principal. Si la URL no apunta a
 *    un host declarado, no se hace la petición. Se comprueba en cada salto de
 *    redirección, no solo en el primero.
 * 2. **Bloqueo de direcciones internas.** Se resuelve el nombre y se rechaza si
 *    alguna dirección cae en un rango privado, de bucle local, de enlace local
 *    (donde viven los metadatos del cloud), CGNAT, multicast o reservado.
 *
 * El segundo control es defensa en profundidad: con la lista blanca puesta,
 * para explotar una reasignación de DNS haría falta controlar el DNS de un host
 * que nosotros hemos declarado. Se deja igualmente porque las listas cambian de
 * mano y un día alguien añadirá un host configurable por el usuario.
 *
 * **Limitación conocida y aceptada:** entre que se valida la dirección y que
 * `fetch` abre la conexión vuelve a resolverse el nombre, así que existe una
 * ventana teórica de reasignación de DNS. Cerrarla exige un `lookup` propio en
 * el agente HTTP, que esta versión de Node no expone sin traer `undici` como
 * dependencia. Con la lista blanca delante, la ventana no es explotable por
 * quien solo controla el cuerpo de la petición.
 */

import dns from "node:dns/promises";
import net from "node:net";

export type OpcionesFetchSeguro = {
  /**
   * Hosts permitidos. Obligatorio y no vacío: es el punto del módulo.
   *
   * Cada entrada se compara con el host de la URL de forma exacta o como
   * sufijo de dominio (`twilio.com` acepta `api.twilio.com`, y NO acepta
   * `twilio.com.atacante.tld`, que es justo el fallo que tenía el filtro de
   * enlaces de mapas).
   */
  hostsPermitidos: readonly string[];
  metodo?: string;
  cabeceras?: Record<string, string>;
  cuerpo?: string | Buffer;
  /** Tope de bytes que se leen del cuerpo de la respuesta. */
  maxBytes?: number;
  timeoutMs?: number;
  /**
   * Redirecciones a seguir, revalidando host y direcciones en cada salto.
   * Por defecto NINGUNA: seguir una redirección es aceptar una segunda URL
   * que ya no eligió quien escribió el código.
   */
  maxRedirecciones?: number;
  /** Solo para hosts internos de confianza en pruebas. Nunca en producción. */
  permitirHttp?: boolean;
};

export type RespuestaSegura = {
  ok: boolean;
  status: number;
  contentType: string;
  cuerpo: Buffer;
  urlFinal: string;
};

export class ErrorRedSegura extends Error {
  readonly motivo: string;
  constructor(motivo: string, detalle: string) {
    super(detalle);
    this.name = "ErrorRedSegura";
    this.motivo = motivo;
  }
}

const MAX_BYTES_POR_DEFECTO = 15 * 1024 * 1024;
const TIMEOUT_POR_DEFECTO_MS = 15_000;

/** Normaliza un host para comparar: minúsculas y sin el punto final del FQDN. */
function normalizarHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}

/**
 * Si el host está permitido: igual que la entrada, o subdominio suyo.
 *
 * El `endsWith("." + permitido)` es lo que impide `twilio.com.atacante.tld`:
 * sin el punto, cualquier dominio que ACABE en la cadena colaría.
 */
export function hostPermitido(host: string, permitidos: readonly string[]): boolean {
  const h = normalizarHost(host);
  if (!h) return false;
  return permitidos.some((p) => {
    const q = normalizarHost(p);
    return q.length > 0 && (h === q || h.endsWith(`.${q}`));
  });
}

/**
 * Si una dirección IP es interna y por tanto inalcanzable desde fuera.
 *
 * Se incluye 169.254.0.0/16 (y fd00::/8, fe80::/10) porque ahí viven los
 * metadatos de los proveedores de cloud, que es el destino clásico de un SSRF.
 */
export function esDireccionInterna(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 0) return true; // lo que no se sabe qué es, no se visita

  if (version === 4) {
    const o = ip.split(".").map((n) => Number(n));
    if (o.length !== 4 || o.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = o;
    if (a === 0) return true;                              // 0.0.0.0/8
    if (a === 10) return true;                             // privada
    if (a === 127) return true;                            // bucle local
    if (a === 169 && b === 254) return true;               // enlace local / metadatos
    if (a === 172 && b >= 16 && b <= 31) return true;      // privada
    if (a === 192 && b === 168) return true;               // privada
    if (a === 192 && b === 0) return true;                  // 192.0.0.0/24 y 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return true;   // pruebas de rendimiento
    if (a === 198 && b === 51) return true;                 // documentación
    if (a === 203 && b === 0) return true;                  // documentación
    if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT
    if (a >= 224) return true;                             // multicast y reservado
    return false;
  }

  const ipv6 = normalizarHost(ip);
  if (ipv6 === "::" || ipv6 === "::1") return true;
  // IPv4 empotrada: ::ffff:10.0.0.1 — se juzga por la parte IPv4.
  const empotrada = ipv6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (empotrada) return esDireccionInterna(empotrada[1]);
  if (/^f[cd]/.test(ipv6)) return true;                    // fc00::/7 únicas locales
  if (/^fe[89ab]/.test(ipv6)) return true;                 // fe80::/10 enlace local
  if (/^ff/.test(ipv6)) return true;                       // multicast
  if (ipv6.startsWith("2001:db8")) return true;            // documentación
  if (ipv6.startsWith("64:ff9b:")) return true;            // NAT64
  return false;
}

/**
 * Comprueba una URL: esquema, host declarado y direcciones no internas.
 *
 * Se exporta porque hay sitios que necesitan validar una URL **antes** de
 * guardarla (el `baseUrl` de un conector, el destino de un webhook) y no en el
 * momento de usarla: rechazar al guardar da un error que el usuario entiende,
 * en vez de un fallo silencioso tres días después.
 */
export async function validarUrlSegura(
  url: string,
  opciones: Pick<OpcionesFetchSeguro, "hostsPermitidos" | "permitirHttp">
): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ErrorRedSegura("url_invalida", "La URL no es válida");
  }

  const esquemasOk = opciones.permitirHttp ? ["https:", "http:"] : ["https:"];
  if (!esquemasOk.includes(u.protocol)) {
    throw new ErrorRedSegura("esquema_no_permitido", `Esquema no permitido: ${u.protocol}`);
  }
  if (u.username || u.password) {
    // `https://api.twilio.com@atacante.tld/` apunta a atacante.tld, no a Twilio.
    throw new ErrorRedSegura("credenciales_en_url", "La URL no puede llevar credenciales");
  }
  if (!opciones.hostsPermitidos || opciones.hostsPermitidos.length === 0) {
    throw new ErrorRedSegura("sin_lista_blanca", "No se ha declarado ningún host permitido");
  }
  if (!hostPermitido(u.hostname, opciones.hostsPermitidos)) {
    throw new ErrorRedSegura("host_no_permitido", `Host no permitido: ${u.hostname}`);
  }

  const direcciones = await resolver(u.hostname);
  const internas = direcciones.filter((ip) => esDireccionInterna(ip));
  if (internas.length > 0 || direcciones.length === 0) {
    throw new ErrorRedSegura(
      "direccion_interna",
      `El host ${u.hostname} resuelve a una dirección no pública`
    );
  }
  return u;
}

async function resolver(hostname: string): Promise<string[]> {
  if (net.isIP(hostname) !== 0) return [hostname];
  try {
    const registros = await dns.lookup(hostname, { all: true, verbatim: true });
    return registros.map((r) => r.address);
  } catch {
    throw new ErrorRedSegura("dns", `No se ha podido resolver ${hostname}`);
  }
}

/**
 * `fetch` con lista blanca de hosts, sin redirecciones por defecto y con tope
 * de tamaño. Lanza `ErrorRedSegura` si la URL no pasa los controles.
 */
export async function fetchSeguro(
  url: string,
  opciones: OpcionesFetchSeguro
): Promise<RespuestaSegura> {
  const maxBytes = opciones.maxBytes ?? MAX_BYTES_POR_DEFECTO;
  const maxRedirecciones = opciones.maxRedirecciones ?? 0;

  let urlActual = url;
  for (let salto = 0; salto <= maxRedirecciones; salto++) {
    const u = await validarUrlSegura(urlActual, opciones);

    const respuesta = await fetch(u.toString(), {
      method: opciones.metodo ?? "GET",
      headers: opciones.cabeceras,
      body: opciones.cuerpo as BodyInit | undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS),
    });

    const esRedireccion = respuesta.status >= 300 && respuesta.status < 400;
    if (esRedireccion) {
      const destino = respuesta.headers.get("location");
      if (!destino) {
        throw new ErrorRedSegura("redireccion_sin_destino", "Redirección sin cabecera Location");
      }
      if (salto >= maxRedirecciones) {
        throw new ErrorRedSegura(
          "demasiadas_redirecciones",
          `Se ha alcanzado el límite de redirecciones (${maxRedirecciones})`
        );
      }
      // Resuelta contra la actual: una Location relativa es legítima, y así
      // vuelve a pasar por `validarUrlSegura` con el host ya absoluto.
      urlActual = new URL(destino, u).toString();
      continue;
    }

    const declarado = Number(respuesta.headers.get("content-length") ?? "0");
    if (declarado > maxBytes) {
      throw new ErrorRedSegura("demasiado_grande", `La respuesta declara ${declarado} bytes`);
    }

    const cuerpo = await leerConTope(respuesta, maxBytes);
    return {
      ok: respuesta.ok,
      status: respuesta.status,
      contentType: respuesta.headers.get("content-type") ?? "application/octet-stream",
      cuerpo,
      urlFinal: u.toString(),
    };
  }

  throw new ErrorRedSegura("demasiadas_redirecciones", "Se ha alcanzado el límite de redirecciones");
}

/**
 * Lee el cuerpo abortando al pasar del tope.
 *
 * No basta con mirar `content-length`: se puede omitir o mentir. Con troceado
 * se corta de verdad, y así una respuesta infinita no agota la memoria.
 */
async function leerConTope(respuesta: Response, maxBytes: number): Promise<Buffer> {
  if (!respuesta.body) return Buffer.alloc(0);
  const trozos: Buffer[] = [];
  let total = 0;
  const lector = respuesta.body.getReader();
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ErrorRedSegura("demasiado_grande", `La respuesta pasa de ${maxBytes} bytes`);
      }
      trozos.push(Buffer.from(value));
    }
  } finally {
    void lector.cancel().catch(() => {});
  }
  return Buffer.concat(trozos);
}

// ── Listas de hosts de la casa ──────────────────────────────────────────────
//
// Van aquí y no repartidas por el código para que se vea de un vistazo a qué
// sitios sale este servidor con datos que vienen de fuera.

/** Medios de WhatsApp. Es donde Twilio sirve lo que manda un cliente. */
export const HOSTS_TWILIO = ["api.twilio.com", "media.twiliocdn.com"] as const;

/** Enlaces de mapa que un cliente manda por WhatsApp para decir dónde está. */
export const HOSTS_MAPAS = [
  "maps.app.goo.gl",
  "goo.gl",
  "maps.google.com",
  "www.google.com",
  "google.com",
  "share.google",
] as const;

/** Almacenamiento propio: lo que ya está en nuestro bucket. */
export function hostsSupabase(): string[] {
  const url = String(process.env.SUPABASE_URL || "").trim();
  if (!url) return [];
  try {
    return [new URL(url).hostname];
  } catch {
    return [];
  }
}
