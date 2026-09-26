/**
 * Qué ha dicho de verdad el servidor de correo cuando una pasada falla.
 *
 * ── El problema que esto resuelve ───────────────────────────────────────────
 *
 * ImapFlow lanza `new Error("Command failed")` para CUALQUIER respuesta NO o
 * BAD del servidor: una contraseña mal, una carpeta que no existe y una
 * búsqueda que el servidor no admite salen las tres con el mismo texto. Y eso
 * es lo que la pantalla ha estado enseñando pasada tras pasada: «Command
 * failed», once veces seguidas, sin una sola pista de qué mirar.
 *
 * Lo que sí trae el error —y el código tiraba— son tres cosas:
 *
 *   · `responseStatus`  NO o BAD.
 *   · `responseText`    el texto del servidor: «[AUTHENTICATIONFAILED]
 *                       Authentication failed», «Mailbox doesn't exist».
 *   · `serverResponseCode`  el código entre corchetes, ya extraído.
 *
 * Con eso y el PASO en el que se estaba —conectar, abrir la carpeta, buscar—
 * la pasada dice qué hay que arreglar en vez de que hay que investigar.
 *
 * ── Por qué es código puro ──────────────────────────────────────────────────
 *
 * Porque la forma de estos errores es lo único que hay que probar, y montar
 * un servidor IMAP que conteste NO para comprobar un mensaje sería probar
 * ImapFlow, no esto.
 */

/** Lo que ImapFlow cuelga de sus errores; todo opcional, que es como llega. */
type ErrorImap = {
  message?: string;
  responseStatus?: string;
  responseText?: string;
  serverResponseCode?: string;
  authenticationFailed?: boolean;
  /** En el fallo de LOGIN, ImapFlow lo sustituye por el texto del servidor. */
  response?: unknown;
  code?: string;
};

/** «Command failed» no dice nada: si hay algo mejor, se usa eso. */
const SIN_INFORMACION = new Set(["command failed", "", "error"]);

function texto(e: ErrorImap): string | null {
  const directo = (e.responseText ?? "").trim();
  if (directo) return directo;
  // En el fallo de autenticación el texto acaba en `response`, ya resuelto.
  if (typeof e.response === "string" && e.response.trim()) return e.response.trim();
  const msg = (e.message ?? "").trim();
  return SIN_INFORMACION.has(msg.toLowerCase()) ? null : msg || null;
}

/**
 * El motivo que se guarda en la pasada y sale en la pantalla.
 *
 * `paso` es lo que se estaba haciendo, en infinitivo y en castellano llano:
 * «conectar con el servidor», «abrir la carpeta INBOX», «buscar los correos
 * nuevos». Va delante porque es lo que sitúa el fallo.
 */
export function motivoDelFallo(error: unknown, paso: string): string {
  const e = (error ?? {}) as ErrorImap;
  const partes: string[] = [];

  /*
   * La autenticación se nombra aparte, y con la variable que hay que mirar.
   * Es el fallo más común cuando un buzón que llevaba meses yendo deja de ir
   * —la contraseña se cambia en el proveedor de correo, no aquí— y el que más
   * se tarda en encontrar si el mensaje no lo dice.
   */
  if (e.authenticationFailed || e.serverResponseCode === "AUTHENTICATIONFAILED") {
    partes.push("el servidor ha rechazado el usuario o la contraseña (THEREFORE_IMAP_USER / THEREFORE_IMAP_PASS)");
  }

  const t = texto(e);
  if (t) partes.push(t);
  if (e.responseStatus && !t?.includes(e.responseStatus)) partes.push(`respuesta ${e.responseStatus}`);
  // Un fallo de red no llega a ser respuesta del servidor: trae `code`.
  if (!t && e.code) partes.push(e.code);

  return partes.length > 0
    ? `No se ha podido ${paso}: ${partes.join(" · ")}.`
    : `No se ha podido ${paso}.`;
}
