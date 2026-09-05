/**
 * Los textos y los mapeos de la parte interna de calidad.
 *
 * Aparte del componente para poder probarlos: el repositorio no tiene jsdom, y
 * lo que de verdad se puede equivocar aquí no es el JSX, es qué estado se
 * enseña y cómo se calcula una duración.
 */

/* ── Estados de la encuesta ──────────────────────────────────────────────── */

export type TonoEstado = "neutro" | "espera" | "bien" | "aviso" | "apagado";

/**
 * Cómo se llama cada estado de cara a la oficina.
 *
 * Las tres primeras dicen cosas distintas y no son intercambiables:
 *
 *  · `QUEUED`    — está lista y esperando turno. Nadie ha mandado nada.
 *  · `SENT`      — **el proveedor aceptó el envío**. No dice que llegara al
 *                  teléfono, y por eso no pone «Entregada».
 *  · `DELIVERED` — el proveedor confirma que llegó al teléfono.
 *
 * Llamar «Entregada» a un `SENT` es la confusión fácil, y la que haría que
 * alguien le dijera a un cliente que recibió un mensaje que quizá no recibió.
 */
export const ESTADO_ENCUESTA: Record<string, { texto: string; tono: TonoEstado }> = {
  CREATED:   { texto: "Preparada",        tono: "neutro" },
  QUEUED:    { texto: "En cola de envío", tono: "espera" },
  SENT:      { texto: "Enviada",          tono: "espera" },
  DELIVERED: { texto: "Entregada",        tono: "espera" },
  STARTED:   { texto: "Abierta",          tono: "espera" },
  COMPLETED: { texto: "Respondida",       tono: "bien" },
  EXPIRED:   { texto: "Caducada",         tono: "apagado" },
  FAILED:    { texto: "Error de envío",   tono: "aviso" },
  CANCELLED: { texto: "Cancelada",        tono: "apagado" },
};

export const SIN_ENCUESTA = { texto: "Sin encuesta", tono: "apagado" as TonoEstado };

export function estadoEncuesta(estado: string | null | undefined) {
  if (!estado) return SIN_ENCUESTA;
  return ESTADO_ENCUESTA[estado] ?? { texto: estado, tono: "neutro" as TonoEstado };
}

/* ── Expediente ──────────────────────────────────────────────────────────── */

export const ESTADO_CASO: Record<string, string> = {
  NEW: "Nuevo",
  IN_REVIEW: "En revisión",
  PENDING_PROVIDER: "Esperando al proveedor",
  PENDING_CUSTOMER: "Esperando al cliente",
  RESOLVED: "Resuelto",
  CLOSED: "Cerrado",
};

export const PRIORIDAD: Record<string, string> = {
  NORMAL: "Normal", HIGH: "Alta", CRITICAL: "Crítica",
};

/**
 * El motivo, redactado como lo que es: una **alegación**.
 *
 * «Daños en el vehículo» no es «daños confirmados». Lo que dice la encuesta es
 * lo que percibió quien la contestó; si hubo daños de verdad lo decide el
 * supervisor al cerrar, con `DAMAGE_CONFIRMED` o `DAMAGE_NOT_CONFIRMED`. Que
 * el texto de la bandeja diera por hecho el daño convertiría una queja en un
 * veredicto.
 */
export const MOTIVO_CASO: Record<string, string> = {
  VEHICLE_DAMAGE: "Daños alegados en el vehículo",
  NOT_RESOLVED: "No quedó resuelto",
  LOW_RATING: "Valoración baja",
};

export const RESOLUCION_CASO: Record<string, string> = {
  SERVICE_OK_PERCEPTION: "Servicio correcto · percepción del usuario",
  SLA_BREACH: "Incumplimiento de tiempo",
  PROVIDER_INCIDENT: "Incidencia del proveedor",
  COMMUNICATION_ISSUE: "Problema de comunicación",
  TECHNICAL_NOT_RESOLVED: "No resolución técnica",
  DAMAGE_CONFIRMED: "Daños confirmados",
  DAMAGE_NOT_CONFIRMED: "Daños no confirmados",
  INTERNAL_ERROR: "Error interno de Mobilink",
  OTHER: "Otro",
};

export const ACCION_CASO: Record<string, string> = {
  NONE: "Sin acción",
  PROVIDER_WARNING: "Advertencia al proveedor",
  PROVIDER_REVIEW: "Revisión con el proveedor",
  COMPENSATION: "Compensación",
  PROCESS_CHANGE: "Cambio de procedimiento",
  TRAINING: "Formación",
  ESCALATED_TO_CLAIM: "Escalado a reclamación",
  OTHER: "Otro",
};

export const EVENTO_CASO: Record<string, string> = {
  CREATED: "Caso abierto",
  ASSIGNED: "Responsable asignado",
  PRIORITY_CHANGED: "Prioridad cambiada",
  STATUS_CHANGED: "Estado cambiado",
  NOTE_ADDED: "Nota añadida",
  RESOLUTION_SET: "Conclusión registrada",
  RESOLVED: "Caso resuelto",
  CLOSED: "Caso cerrado",
  REOPENED: "Caso reabierto",
};

export const RESPUESTA: Record<string, string> = {
  YES: "Sí, completamente", PARTIAL: "Parcialmente", NO: "No",
};

export const MOTIVO_NEGATIVO: Record<string, string> = {
  LONG_WAIT: "Tiempo de espera",
  POOR_COMMUNICATION: "Comunicación",
  POOR_TREATMENT: "Trato recibido",
  NOT_RESOLVED: "No se solucionó",
  SERVICE_PROBLEM: "Problema durante el servicio",
  VEHICLE_DAMAGE: "Daños en el vehículo",
  OTHER: "Otro",
};

export const ROL: Record<string, string> = { DRIVER: "Conductor", CUSTOMER: "Cliente" };

/** Traduce con respaldo: si llega un código nuevo, se enseña tal cual. */
export function etiqueta(mapa: Record<string, string>, clave: string | null | undefined): string {
  if (!clave) return "—";
  return mapa[clave] ?? clave;
}

/* ── Tiempos ─────────────────────────────────────────────────────────────── */

/**
 * Los tramos del servicio que se pueden calcular.
 *
 * **Solo cuando existen los dos extremos.** Un «tiempo hasta la llegada» sin
 * hora de llegada no es cero ni desconocido: es un número inventado, y en una
 * pantalla donde alguien juzga si hubo demora, inventarlo es peor que no
 * darlo.
 */
export type Tramo = { etiqueta: string; ms: number };

const TRAMOS: [string, string, string][] = [
  ["solicitada", "asignada", "Hasta asignar"],
  ["asignada", "enCamino", "Hasta salir"],
  ["enCamino", "enPunto", "Desplazamiento"],
  ["enPunto", "finalizada", "En el punto"],
  ["solicitada", "finalizada", "Total"],
];

export function tramos(tiempos: Record<string, number | null | undefined>): Tramo[] {
  const salida: Tramo[] = [];
  for (const [desde, hasta, texto] of TRAMOS) {
    const a = tiempos[desde];
    const b = tiempos[hasta];
    if (a == null || b == null || b < a) continue;
    salida.push({ etiqueta: texto, ms: b - a });
  }
  return salida;
}

/** `1 h 25 min`, `18 min`. Sin segundos: aquí nadie mide en segundos. */
export function duracion(ms: number): string {
  const minutos = Math.round(ms / 60_000);
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
