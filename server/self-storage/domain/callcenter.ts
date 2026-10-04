/**
 * Call Center · reglas puras (sin base de datos ni HTTP).
 *
 * El Call Center gestiona la LLAMADA. Le da igual quién la atienda (persona,
 * IA o las dos) y por dónde llegue (telefonía): esas piezas se enchufan
 * alrededor y aquí no aparecen.
 *
 * Lo que vive aquí:
 *   · el catálogo de partida (motivos y resultados) con su comportamiento;
 *   · qué estado queda tras registrar un resultado;
 *   · la prioridad de una incidencia (las de acceso y seguridad, urgentes);
 *   · si el Call Center está activo: interruptor global (entorno) Y empresa.
 */

import { URGENT_INCIDENT_TYPES, type CallStatus, type IncidentType, type Priority } from "../../../src/modules/self-storage/types/enums.ts";

export type EntradaCatalogo = { code: string; label: string; defaultPriority?: Priority };

/** Motivos de partida. Se pueden renombrar, ordenar y desactivar; y añadir otros. */
export const MOTIVOS_INICIALES: readonly EntradaCatalogo[] = [
  { code: "precio_disponibilidad", label: "Precio y disponibilidad" },
  { code: "tamano_trastero", label: "Tamaño del trastero" },
  { code: "calculadora_espacio", label: "Calculadora de espacio" },
  { code: "contratacion_online", label: "Contratación online" },
  { code: "visita_virtual", label: "Visita virtual" },
  { code: "visita_guiada", label: "Visita guiada" },
  { code: "ubicacion", label: "Ubicación" },
  { code: "acceso", label: "Acceso", defaultPriority: "high" },
  { code: "seguridad", label: "Seguridad", defaultPriority: "urgent" },
  { code: "cliente_existente", label: "Cliente existente" },
  { code: "facturacion", label: "Facturación" },
  { code: "baja_cancelacion", label: "Baja o cancelación" },
  { code: "incidencia", label: "Incidencia", defaultPriority: "high" },
  { code: "reclamacion", label: "Reclamación", defaultPriority: "high" },
  { code: "otro", label: "Otro" },
];

/**
 * Qué hace un resultado con la llamada:
 *   · close     — queda cerrada (resuelta o derivada a la web).
 *   · follow_up — queda pendiente de seguimiento (visita, llamar luego…).
 *   · escalate  — queda escalada a la empresa, pide un humano.
 *   · finish    — termina sin cerrarse (no resuelta: se revisa).
 */
export type EfectoResultado = "close" | "follow_up" | "escalate" | "finish";

export const RESULTADOS_INICIALES: readonly (EntradaCatalogo & { efecto: EfectoResultado })[] = [
  { code: "resuelto", label: "Resuelto", efecto: "close" },
  { code: "enviado_web", label: "Enviado a la web", efecto: "close" },
  { code: "enviado_calculadora", label: "Enviado a la calculadora", efecto: "close" },
  { code: "enviado_contratacion", label: "Enviado a contratación online", efecto: "close" },
  { code: "visita_virtual_solicitada", label: "Visita virtual solicitada", efecto: "follow_up" },
  { code: "visita_guiada_solicitada", label: "Visita guiada solicitada", efecto: "follow_up" },
  { code: "incidencia_creada", label: "Incidencia creada", efecto: "close" },
  { code: "escalado_tlc", label: "Escalado a la empresa", efecto: "escalate" },
  { code: "requiere_seguimiento", label: "Requiere seguimiento", efecto: "follow_up" },
  { code: "no_resuelto", label: "No resuelto", efecto: "finish" },
];

/** Un resultado añadido por la empresa no cierra nada por su cuenta: termina la llamada. */
export function efectoDeResultado(code: string): EfectoResultado {
  return RESULTADOS_INICIALES.find((r) => r.code === code)?.efecto ?? "finish";
}

/** Resultados que cuentan como «resuelta» en los indicadores. */
export const RESULTADOS_RESUELTOS = RESULTADOS_INICIALES.filter((r) => r.efecto === "close").map((r) => r.code);

/** Estado de la llamada tras registrar su resultado. */
export function estadoTrasResultado(code: string): CallStatus {
  switch (efectoDeResultado(code)) {
    case "close":
      return "closed";
    case "follow_up":
      return "follow_up";
    case "escalate":
      return "escalated";
    default:
      return "finished";
  }
}

const TRANSICIONES: Record<CallStatus, readonly CallStatus[]> = {
  started: ["in_progress", "finished", "escalated", "follow_up", "closed"],
  in_progress: ["finished", "escalated", "follow_up", "closed"],
  finished: ["escalated", "follow_up", "closed"],
  escalated: ["in_progress", "follow_up", "closed", "finished"],
  follow_up: ["closed", "escalated", "in_progress"],
  closed: [],
};

/** Una llamada cerrada no se reabre: si vuelve a llamar, es otra llamada. */
export function puedePasar(de: CallStatus, a: CallStatus): boolean {
  return de === a || TRANSICIONES[de].includes(a);
}

/** Segundos de conversación; si no se contestó, desde que empezó. */
export function duracionSegundos(inicio: Date, contestada: Date | null, fin: Date): number {
  return Math.max(0, Math.round((fin.getTime() - (contestada ?? inicio).getTime()) / 1000));
}

/** Prioridad de una incidencia: las de acceso, seguridad y emergencia son SIEMPRE urgentes. */
export function prioridadIncidencia(tipo: IncidentType, pedida?: Priority | null): Priority {
  if (URGENT_INCIDENT_TYPES.includes(tipo)) return "urgent";
  return pedida ?? "normal";
}

/** Prioridad mínima de la llamada según el motivo (nunca baja la que ya tenga). */
export function prioridadMaxima(a: Priority, b: Priority | null | undefined): Priority {
  const orden: Priority[] = ["normal", "high", "urgent"];
  return orden[Math.max(orden.indexOf(a), b ? orden.indexOf(b) : 0)];
}

/**
 * Interruptor global de infraestructura (variable de entorno). Por defecto
 * encendido: es un «kill switch», sólo `0`/`false`/`off` lo apaga. Lo que
 * decide si una empresa lo usa es su ajuste `call_center.enabled`.
 */
export function interruptorGlobal(valor: string | undefined): boolean {
  return !/^(0|false|off|no)$/i.test(String(valor ?? "").trim());
}

/** Teléfono enmascarado para logs y auditoría: +34 6•• ••• •22. */
export function enmascararTelefono(e164: string | null | undefined): string | null {
  if (!e164) return null;
  if (e164.length < 6) return "•••";
  return e164.slice(0, 4) + e164.slice(4, -2).replace(/\d/g, "•") + e164.slice(-2);
}
