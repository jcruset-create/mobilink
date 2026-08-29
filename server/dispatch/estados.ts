/**
 * Capa de traducción de estados entre sistemas.
 *
 * Assist y Central NO comparten estados, y forzarlos a compartirlos sería el
 * primer paso para no poder cambiar ninguno de los dos: en cuanto Central
 * añadiera un estado propio, Assist tendría que desplegar a la vez.
 *
 * En medio hay un vocabulario de EVENTOS estándar. Cada sistema traduce a lo
 * suyo al entrar y al salir, y ese vocabulario es lo único que viaja por la
 * red. Sirve igual para Assist → Central A, Central A → Central B o Central →
 * una plataforma externa, que es de lo que se trata.
 *
 * Regla de oro al ampliarlo: un evento describe QUÉ HA PASADO, no en qué
 * pantalla está nadie. «ACCEPTED» es un hecho; «pendiente de revisar» es una
 * bandeja, y las bandejas no se exportan.
 */

/** Vocabulario común. Es la única lista que conocen los dos lados. */
export const EVENTOS = [
  "REQUESTED",       // el origen la ha enviado
  "RECEIVED",        // el destino la ha recibido y guardado
  "ACCEPTED",        // el destino se hace cargo
  "REJECTED",        // el destino no se hace cargo
  "INFO_REQUESTED",  // el destino pide datos antes de decidir
  "ASSIGNED",        // hay proveedor/taller asignado
  "EN_ROUTE",        // va de camino
  "ON_SITE",         // ha llegado al punto
  "IN_PROGRESS",     // trabajando
  "COMPLETED",       // servicio terminado
  "CANCELLED",       // anulada
  "DOCUMENTED",      // informe y fotos cerrados
  "BILLABLE",        // lista para facturar
] as const;

export type Evento = (typeof EVENTOS)[number];

export function esEvento(v: unknown): v is Evento {
  return typeof v === "string" && (EVENTOS as readonly string[]).includes(v);
}

/* ── Estados técnicos del envío ──────────────────────────────────────────── */

/**
 * El estado del ENVÍO, que no es el estado de la asistencia.
 *
 * Se separan a propósito: «la asistencia va de camino» y «no consigo hablar
 * con Central» son dos cosas distintas y hay que poder verlas a la vez. Sin
 * esta separación, un fallo de red se disfrazaría de asistencia parada.
 */
export const ESTADOS_ENVIO = [
  "PENDING",   // creada, aún no enviada
  "SENDING",   // intento en curso
  "SENT",      // el destino contestó 2xx
  "RECEIVED",  // el destino confirmó que la tiene
  "ACCEPTED",
  "REJECTED",
  "COMPLETED",
  "CANCELLED",
  "ERROR",     // el último intento falló; se puede reintentar
] as const;

export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];

/**
 * Un envío en ERROR se reintenta; uno ya aceptado o rechazado, no.
 *
 * Reintentar algo que el destino YA aceptó crearía un segundo expediente allí
 * si la idempotencia fallara, así que la puerta se cierra aquí y no solo en el
 * destino: dos cerrojos para el mismo error.
 */
export function sePuedeReintentar(estado: unknown): boolean {
  return estado === "PENDING" || estado === "ERROR" || estado === "SENDING";
}

/** Estados en los que el envío ya no espera nada más. */
export function esFinal(estado: unknown): boolean {
  return estado === "REJECTED" || estado === "COMPLETED" || estado === "CANCELLED";
}

/* ── Central → evento estándar ───────────────────────────────────────────── */

/**
 * Traduce el estado interno de una asistencia de Central al evento común.
 *
 * `null` significa «este estado no le importa al otro lado»: no todo cambio
 * interno es noticia, y mandar ruido obliga al origen a filtrarlo.
 */
const DE_CENTRAL: Record<string, Evento> = {
  draft: "REQUESTED",
  pending: "RECEIVED",
  searching: "RECEIVED",
  assigned: "ASSIGNED",
  technician_assigned: "ASSIGNED",
  en_route: "EN_ROUTE",
  arrived: "ON_SITE",
  in_progress: "IN_PROGRESS",
  finished: "COMPLETED",
  cancelled: "CANCELLED",
  // Sin cobertura y fallo de asignación son un rechazo para quien está
  // esperando fuera: da igual el motivo interno, nadie va a ir.
  no_coverage: "REJECTED",
  assignment_failed: "REJECTED",
};

export function eventoDesdeCentral(status: unknown): Evento | null {
  return DE_CENTRAL[String(status ?? "")] ?? null;
}

/* ── Evento estándar → Assist ────────────────────────────────────────────── */

/**
 * Qué estado toma en Assist la asistencia subcontratada según lo que cuenta
 * el destino.
 *
 * Ojo con lo que NO está aquí: ACCEPTED no mueve el estado de Assist. Que
 * Central se haga cargo no significa que haya nadie conduciendo todavía, y
 * pintar «asignada» en ese momento haría creer al cliente que el servicio ha
 * arrancado. El hecho se guarda en el envío; el estado espera a ASSIGNED.
 */
const A_ASSIST: Partial<Record<Evento, string>> = {
  ASSIGNED: "asignada",
  EN_ROUTE: "en_camino",
  ON_SITE: "en_curso",
  IN_PROGRESS: "en_curso",
  COMPLETED: "finalizada",
  CANCELLED: "cancelada",
};

export function estadoAssistDesdeEvento(evento: unknown): string | null {
  return esEvento(evento) ? (A_ASSIST[evento] ?? null) : null;
}

/**
 * Cómo queda el ENVÍO al recibir un evento del destino.
 *
 * Solo avanza: si llega un ASSIGNED con retraso después de un COMPLETED —los
 * webhooks se entregan al menos una vez y pueden desordenarse—, el envío no
 * retrocede a un estado ya superado.
 */
const ORDEN: EstadoEnvio[] = [
  "PENDING", "SENDING", "SENT", "RECEIVED", "ACCEPTED", "COMPLETED",
];

const A_ENVIO: Partial<Record<Evento, EstadoEnvio>> = {
  RECEIVED: "RECEIVED",
  ACCEPTED: "ACCEPTED",
  ASSIGNED: "ACCEPTED",
  EN_ROUTE: "ACCEPTED",
  ON_SITE: "ACCEPTED",
  IN_PROGRESS: "ACCEPTED",
  DOCUMENTED: "ACCEPTED",
  BILLABLE: "ACCEPTED",
  COMPLETED: "COMPLETED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
};

export function estadoEnvioTrasEvento(actual: unknown, evento: unknown): EstadoEnvio | null {
  if (!esEvento(evento)) return null;
  const propuesto = A_ENVIO[evento];
  if (!propuesto) return null;                       // INFO_REQUESTED no mueve el envío

  // Un rechazo o una cancelación mandan siempre: son decisiones, no progreso.
  if (propuesto === "REJECTED" || propuesto === "CANCELLED") return propuesto;

  const iActual = ORDEN.indexOf(actual as EstadoEnvio);
  const iNuevo = ORDEN.indexOf(propuesto);
  if (iActual >= 0 && iNuevo >= 0 && iNuevo <= iActual) return null;  // llegó tarde
  return propuesto;
}

/** El sello temporal que corresponde a cada evento, si lleva alguno. */
export function marcaTemporalDe(evento: Evento): string | null {
  switch (evento) {
    case "RECEIVED": return "receivedAtMs";
    case "ACCEPTED": return "acceptedAtMs";
    case "REJECTED": return "rejectedAtMs";
    case "COMPLETED": return "completedAtMs";
    default: return null;
  }
}
