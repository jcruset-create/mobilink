/**
 * Vocabulario del histórico de eventos de una asistencia.
 *
 * ── Por qué son DOS vocabularios y no uno ───────────────────────────────────
 *
 * Ya existía uno: los 13 eventos estándar de `dispatch/estados.ts`, que son los
 * que viajan por el cable entre sistemas. Éste es más largo (21) y NO lo
 * sustituye, porque no sirven para lo mismo:
 *
 *   · El del cable es un contrato con otra empresa. Cada evento que se añade
 *     hay que acordarlo, documentarlo y mantenerlo durante años.
 *   · Éste es el diario interno de la asistencia. Aquí caben cosas que al otro
 *     lado no le importan —que se subió una foto, que se validó un coste— y se
 *     pueden añadir sin pedirle permiso a nadie.
 *
 * Mezclarlos habría significado o bien exportar el diario entero (contando al
 * destino cosas que no son suyas), o bien no poder anotar nada que no estuviera
 * en el contrato. `DESDE_EVENTO_CABLE` traduce de uno a otro al recibir.
 *
 * Los nombres siguen la convención de la casa: en pasado, porque son hechos
 * consumados, igual que los del outbox de caja.
 */

/** El diario de una asistencia. Un evento describe QUÉ pasó, no en qué bandeja está. */
export const TIPOS_EVENTO = [
  // Ciclo de vida
  "ASSISTANCE_CREATED",
  // Subcontratación a otra plataforma
  "EXTERNAL_DISPATCH_CREATED",
  "EXTERNAL_DISPATCH_SENT",
  "EXTERNAL_ASSISTANCE_RECEIVED",
  "ASSISTANCE_ACCEPTED",
  "ASSISTANCE_REJECTED",
  "INFORMATION_REQUESTED",
  // Operativa
  "PROVIDER_ASSIGNED",
  "EN_ROUTE",
  "ON_SITE",
  "SERVICE_STARTED",
  "SERVICE_COMPLETED",
  "SERVICE_CANCELLED",
  // Documentación
  "DOCUMENT_UPLOADED",
  "DELIVERY_NOTE_RECEIVED",
  "SUPPLIER_INVOICE_RECEIVED",
  // Económico
  "COST_CONFIRMED",
  "READY_TO_BILL",
  "CUSTOMER_INVOICED",
  // Salud de la integración
  "SYNC_FAILED",
  "SYNC_RECOVERED",
] as const;

export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export function esTipoEvento(v: unknown): v is TipoEvento {
  return typeof v === "string" && (TIPOS_EVENTO as readonly string[]).includes(v);
}

/** Quién provoca el evento. */
export const ACTORES = ["user", "system", "api", "partner", "provider"] as const;
export type Actor = (typeof ACTORES)[number];

export function esActor(v: unknown): v is Actor {
  return typeof v === "string" && (ACTORES as readonly string[]).includes(v);
}

/**
 * Traducción del vocabulario del cable al del diario.
 *
 * `REQUESTED` no está: en el diario ese hecho ya lo cuenta
 * `EXTERNAL_DISPATCH_CREATED`, que además dice a quién. Anotar los dos dejaría
 * dos líneas para un solo hecho, que es justo lo que una timeline construida
 * desde eventos viene a evitar.
 */
const DESDE_EVENTO_CABLE: Record<string, TipoEvento> = {
  RECEIVED: "EXTERNAL_ASSISTANCE_RECEIVED",
  ACCEPTED: "ASSISTANCE_ACCEPTED",
  REJECTED: "ASSISTANCE_REJECTED",
  INFO_REQUESTED: "INFORMATION_REQUESTED",
  ASSIGNED: "PROVIDER_ASSIGNED",
  EN_ROUTE: "EN_ROUTE",
  ON_SITE: "ON_SITE",
  IN_PROGRESS: "SERVICE_STARTED",
  COMPLETED: "SERVICE_COMPLETED",
  CANCELLED: "SERVICE_CANCELLED",
  DOCUMENTED: "DOCUMENT_UPLOADED",
  BILLABLE: "READY_TO_BILL",
};

export function tipoDesdeEventoCable(evento: unknown): TipoEvento | null {
  return DESDE_EVENTO_CABLE[String(evento ?? "")] ?? null;
}

/**
 * Traducción de los estados internos de Central.
 *
 * Se separa de la anterior a propósito: un cambio de estado de Central y un
 * aviso recibido por el cable son cosas distintas aunque coincidan en el
 * nombre, y el día que Central añada un estado propio solo hay que tocar esta.
 */
const DESDE_ESTADO_CENTRAL: Record<string, TipoEvento> = {
  assigned: "PROVIDER_ASSIGNED",
  technician_assigned: "PROVIDER_ASSIGNED",
  en_route: "EN_ROUTE",
  arrived: "ON_SITE",
  in_progress: "SERVICE_STARTED",
  finished: "SERVICE_COMPLETED",
  cancelled: "SERVICE_CANCELLED",
  no_coverage: "ASSISTANCE_REJECTED",
  assignment_failed: "ASSISTANCE_REJECTED",
};

export function tipoDesdeEstadoCentral(estado: unknown): TipoEvento | null {
  return DESDE_ESTADO_CENTRAL[String(estado ?? "")] ?? null;
}

/** Traducción de los estados internos de Assist. */
const DESDE_ESTADO_ASSIST: Record<string, TipoEvento> = {
  asignada: "PROVIDER_ASSIGNED",
  en_camino: "EN_ROUTE",
  en_curso: "SERVICE_STARTED",
  finalizada: "SERVICE_COMPLETED",
  cancelada: "SERVICE_CANCELLED",
};

export function tipoDesdeEstadoAssist(estado: unknown): TipoEvento | null {
  return DESDE_ESTADO_ASSIST[String(estado ?? "")] ?? null;
}

/* ── Presentación ────────────────────────────────────────────────────────── */

export const ETIQUETA: Record<TipoEvento, string> = {
  ASSISTANCE_CREATED: "Asistencia creada",
  EXTERNAL_DISPATCH_CREATED: "Subcontratada",
  EXTERNAL_DISPATCH_SENT: "Enviada a la plataforma",
  EXTERNAL_ASSISTANCE_RECEIVED: "Recibida por la plataforma",
  ASSISTANCE_ACCEPTED: "Aceptada",
  ASSISTANCE_REJECTED: "Rechazada",
  INFORMATION_REQUESTED: "Piden información",
  PROVIDER_ASSIGNED: "Proveedor asignado",
  EN_ROUTE: "En camino",
  ON_SITE: "En la ubicación",
  SERVICE_STARTED: "Servicio iniciado",
  SERVICE_COMPLETED: "Servicio finalizado",
  SERVICE_CANCELLED: "Servicio cancelado",
  DOCUMENT_UPLOADED: "Documento subido",
  DELIVERY_NOTE_RECEIVED: "Albarán recibido",
  SUPPLIER_INVOICE_RECEIVED: "Factura de proveedor recibida",
  COST_CONFIRMED: "Coste confirmado",
  READY_TO_BILL: "Lista para facturar",
  CUSTOMER_INVOICED: "Facturada al cliente",
  SYNC_FAILED: "Fallo de sincronización",
  SYNC_RECOVERED: "Sincronización recuperada",
};

/**
 * Eventos que NO se enseñan en la timeline del operario por defecto.
 *
 * Un `SYNC_FAILED` seguido de un `SYNC_RECOVERED` es ruido para quien solo
 * quiere saber por dónde va la grúa; sigue en el diario, y la bandeja de
 * excepciones y el técnico los ven pidiéndolos.
 */
export const TECNICOS: readonly TipoEvento[] = ["SYNC_FAILED", "SYNC_RECOVERED"];

export function esTecnico(tipo: unknown): boolean {
  return TECNICOS.includes(tipo as TipoEvento);
}

/**
 * Datos que NUNCA pueden entrar en el `payload` de un evento.
 *
 * El diario se enseña en pantalla y viaja en las respuestas de la API. Un
 * payload con una credencial o un importe interno dentro es una fuga con
 * fecha, así que la lista existe para poder comprobarla en una prueba.
 */
export const CLAVES_PROHIBIDAS_EN_PAYLOAD = [
  "apiKey", "api_key", "token", "secret", "password", "keyHash", "authorization",
] as const;

/**
 * Limpia el payload antes de guardarlo.
 *
 * Recorta también su tamaño: el diario se lee entero para pintar la timeline,
 * y un payload de medio mega por evento la vuelve inservible.
 */
export function limpiarPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const fuera: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    const bajo = k.toLowerCase();
    if (CLAVES_PROHIBIDAS_EN_PAYLOAD.some((p) => bajo.includes(p.toLowerCase()))) continue;
    if (v === undefined || v === null) continue;
    if (typeof v === "string") fuera[k] = v.slice(0, 500);
    else if (typeof v === "number" || typeof v === "boolean") fuera[k] = v;
    else {
      // Truncar un JSON por la mitad lo deja sin cerrar y `JSON.parse` revienta;
      // si no cabe entero, se guarda su descripción en texto y no se pierde la
      // línea entera del diario por un payload gordo.
      const texto = JSON.stringify(v);
      fuera[k] = texto.length <= 1000 ? v : `${texto.slice(0, 997)}…`;
    }
  }
  return fuera;
}
