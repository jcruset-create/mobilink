/**
 * Estado de configuración de un destino externo.
 *
 * El problema que resuelve, y que se vio en cuanto se desplegó lo anterior: la
 * pantalla decía «no hay plataformas configuradas» tanto cuando no había
 * ninguna como cuando había una a la que le faltaba la credencial. Son cosas
 * distintas y llevan a acciones distintas: en un caso hay que dar de alta un
 * destino, en el otro hay que poner una variable de entorno. Confundirlas hace
 * perder media hora buscando en el sitio equivocado.
 *
 * Y hay una tercera que tampoco es lo mismo: que no haya destinos NO es un
 * error. Es el estado normal de una instalación que todavía no subcontrata a
 * nadie, y pintarlo en rojo enseña a la gente a ignorar los rojos.
 *
 * ── Sobre los secretos ──────────────────────────────────────────────────────
 *
 * Aquí se comprueba si la credencial EXISTE y si tiene contenido. En ningún
 * caso se devuelve, ni se registra, ni se compara con nada que pueda acabar en
 * un mensaje. `resolverSecreto` es la única función que ve el valor, y lo que
 * sale de este módulo es un booleano.
 */

/** Estados de configuración, del más grave al bueno. */
export const ESTADOS_DESTINO = [
  "NO_DESTINATIONS",  // no hay ninguno dado de alta (no es un error)
  "DISABLED",         // existe pero está desactivado a propósito
  "MISCONFIGURED",    // le falta algo para poder usarse
  "AUTH_ERROR",       // el destino rechaza las credenciales
  "UNREACHABLE",      // no se consigue contactar
  "AVAILABLE",        // configurado y utilizable
] as const;

export type EstadoDestino = (typeof ESTADOS_DESTINO)[number];

/** Lo que hace falta saber de un destino para juzgar su configuración. */
export type DestinoConfigurable = {
  active?: boolean | null;
  baseUrl?: string | null;
  secretName?: string | null;
  healthStatus?: string | null;
};

export type MotivoMalaConfiguracion =
  | "sin_endpoint"
  | "sin_nombre_de_secreto"
  | "variable_de_entorno_ausente"
  | "variable_de_entorno_vacia";

export const EXPLICACION_MOTIVO: Record<MotivoMalaConfiguracion, string> = {
  sin_endpoint: "Falta la URL del destino",
  sin_nombre_de_secreto: "Falta el nombre de la variable de entorno con la credencial",
  variable_de_entorno_ausente:
    "La variable de entorno indicada no existe en el servidor",
  variable_de_entorno_vacia: "La variable de entorno indicada está vacía",
};

/**
 * Qué le falta a un destino para poder usarse. Lista vacía = no le falta nada.
 *
 * `hayVariable` llega como función y no como el valor: así este módulo se
 * puede probar sin tocar `process.env`, y sobre todo nunca recibe el secreto.
 */
export function motivosMalaConfiguracion(
  d: DestinoConfigurable,
  hayVariable: (nombre: string) => "ausente" | "vacia" | "ok",
): MotivoMalaConfiguracion[] {
  const motivos: MotivoMalaConfiguracion[] = [];
  if (!String(d.baseUrl ?? "").trim()) motivos.push("sin_endpoint");
  const secreto = String(d.secretName ?? "").trim();
  if (!secreto) {
    motivos.push("sin_nombre_de_secreto");
  } else {
    const r = hayVariable(secreto);
    if (r === "ausente") motivos.push("variable_de_entorno_ausente");
    else if (r === "vacia") motivos.push("variable_de_entorno_vacia");
  }
  return motivos;
}

/**
 * El estado de un destino concreto.
 *
 * El orden de las comprobaciones importa: desactivado gana sobre mal
 * configurado, porque a un destino apagado a propósito no hay que ir a
 * arreglarle la credencial. Y la configuración gana sobre la salud, porque un
 * `AUTH_ERROR` guardado de la última prueba no dice nada si desde entonces le
 * han quitado la variable de entorno.
 */
export function estadoDestino(
  d: DestinoConfigurable,
  hayVariable: (nombre: string) => "ausente" | "vacia" | "ok",
): EstadoDestino {
  if (d.active === false) return "DISABLED";
  if (motivosMalaConfiguracion(d, hayVariable).length > 0) return "MISCONFIGURED";
  if (d.healthStatus === "AUTH_ERROR") return "AUTH_ERROR";
  if (d.healthStatus === "UNREACHABLE") return "UNREACHABLE";
  return "AVAILABLE";
}

/** Solo se puede enviar a un destino disponible. Todo lo demás se rechaza. */
export function sePuedeEnviar(estado: EstadoDestino): boolean {
  return estado === "AVAILABLE";
}

/**
 * El estado del conjunto, que es lo que decide qué mensaje ve el operario.
 *
 * Sin destinos NO es un error: es una instalación que todavía no subcontrata.
 */
export function estadoGlobal(estados: EstadoDestino[]): EstadoDestino {
  if (estados.length === 0) return "NO_DESTINATIONS";
  if (estados.some((e) => e === "AVAILABLE")) return "AVAILABLE";
  // Si ninguno sirve, manda el problema más accionable de los que haya.
  for (const candidato of ["MISCONFIGURED", "AUTH_ERROR", "UNREACHABLE", "DISABLED"] as const) {
    if (estados.includes(candidato)) return candidato;
  }
  return "NO_DESTINATIONS";
}

/** Texto para la pantalla. Ni uno solo menciona un secreto. */
export const MENSAJE_ESTADO: Record<EstadoDestino, string> = {
  NO_DESTINATIONS: "No hay plataformas configuradas.",
  DISABLED: "Plataforma desactivada.",
  MISCONFIGURED: "Plataforma no disponible por configuración.",
  AUTH_ERROR: "La plataforma rechaza las credenciales.",
  UNREACHABLE: "No se puede contactar con la plataforma.",
  AVAILABLE: "Plataforma disponible.",
};

/**
 * Limpia un mensaje de error antes de guardarlo o enseñarlo.
 *
 * Un error de red o de la biblioteca HTTP puede traer dentro la URL completa
 * con credenciales en la query, o el eco de una cabecera `Authorization`. Eso
 * acaba en la base de datos, en el panel y en los logs, que es exactamente
 * donde no puede estar. Se recorta a lo que sirve para arreglarlo.
 */
export function sanearError(mensaje: unknown, secretos: string[] = []): string {
  let texto = String(
    (mensaje as any)?.message ?? mensaje ?? "Error desconocido",
  );

  // Primero los valores concretos que sabemos que son secretos.
  for (const s of secretos) {
    if (s && s.length >= 6) texto = texto.split(s).join("«oculto»");
  }

  return texto
    // Bearer / Basic seguidos de lo que sea
    .replace(/\b(bearer|basic)\s+[\w.\-=+/]+/gi, "$1 «oculto»")
    // Claves con el prefijo de la casa, aparezcan donde aparezcan
    .replace(/\bmkc_(live|test)_[a-f0-9]+/gi, "mkc_«oculto»")
    // Credenciales dentro de una URL
    .replace(/(https?:\/\/)[^/\s@]+@/gi, "$1«oculto»@")
    // Parámetros de query con pinta de secreto
    .replace(/([?&](?:api[-_]?key|token|secret|password|key)=)[^&\s]+/gi, "$1«oculto»")
    // Cabeceras eco
    .replace(/(authorization["\s:=]+)[^\s",}]+/gi, "$1«oculto»")
    .slice(0, 500);
}

/**
 * La forma en la que un destino sale por la API.
 *
 * Es la función que garantiza que ninguna credencial cruza al frontend: se
 * construye por lista blanca, campo a campo. `secretName` SÍ sale —es el
 * nombre de la variable, no su valor, y hace falta para poder decir cuál hay
 * que crear— pero el valor no aparece por ningún sitio.
 */
export function destinoParaApi(
  d: Record<string, any>,
  estado: EstadoDestino,
  motivos: MotivoMalaConfiguracion[] = [],
) {
  return {
    id: Number(d.id),
    uuid: d.uuid,
    name: d.name,
    kind: d.kind,
    system: d.system ?? d.kind ?? null,
    baseUrl: d.baseUrl,
    // El NOMBRE de la variable, nunca su contenido.
    apiKeyEnvName: d.secretName ?? null,
    apiVersion: d.apiVersion ?? null,
    capabilities: parseJson(d.capabilities, []),
    remoteTenant: d.destinationTenantLabel ?? null,
    partnerRef: d.partnerRef ?? null,
    timeoutMs: d.timeoutMs != null ? Number(d.timeoutMs) : null,
    maxRetries: d.maxRetries != null ? Number(d.maxRetries) : null,
    metadata: parseJson(d.metadata, {}),
    active: d.active !== false,
    estado,
    mensaje: MENSAJE_ESTADO[estado],
    motivos: motivos.map((m) => EXPLICACION_MOTIVO[m]),
    lastOkAtMs: d.lastOkAtMs != null ? Number(d.lastOkAtMs) : null,
    lastAttemptAtMs: d.lastAttemptAtMs != null ? Number(d.lastAttemptAtMs) : null,
    // Ya viene saneado de cuando se guardó; se sanea otra vez por si la fila
    // es antigua. Dos veces no hace daño; una vez de menos, sí.
    lastError: d.lastError ? sanearError(d.lastError) : null,
    notes: d.notes ?? null,
  };
}

function parseJson(v: unknown, porDefecto: unknown) {
  if (v == null) return porDefecto;
  try {
    return typeof v === "string" ? JSON.parse(v) : v;
  } catch {
    return porDefecto;
  }
}

/**
 * Claves que NUNCA pueden aparecer en la respuesta de un destino.
 *
 * Existe para poder comprobarlo en una prueba: es fácil añadir un `SELECT *`
 * y devolver la fila entera sin darse cuenta.
 */
export const CLAVES_PROHIBIDAS_EN_API = [
  "apiKey", "api_key", "secret", "token", "password", "keyHash", "credential",
] as const;
