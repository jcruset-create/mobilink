import type {
  RoadsideAssistance,
  RoadsideAssistanceStatus,
} from "./roadsideAssistanceTypes";
import {
  ROADSIDE_ASSISTANCE_STATUS_FLOW,
  ROADSIDE_ASSISTANCE_STATUS_LABELS,
} from "./roadsideAssistanceTypes";
import { horaDelPaso, type EventoSeguimiento } from "./seguimientoPasos";

/**
 * El seguimiento de una asistencia, resumido para una tarjeta.
 *
 * Es lo que ve el cliente en su página de seguimiento, pero solo lo que cabe
 * en la tarjeta de «Trabajos asignados» de Pantalla técnicos: el aviso con la
 * ETA, el mapa y la tira de pasos. Ni fotos ni ficha. Las reglas son las
 * mismas que en la página del cliente (RoadsideTrackingPage): un aviso que
 * dijera otra cosa que la página confundiría al taller y al cliente a la vez.
 */

export type Aviso = {
  titulo: string;
  detalle: string;
  /** Hora de la última ETA, si la hay. */
  actualizadoMs: number | null;
  tono: "azul" | "teal";
};

/** El aviso azul. Solo en camino, ida o vuelta: en el punto no hay nada que estimar. */
export function avisoDeSeguimiento(a: {
  status: RoadsideAssistanceStatus | string;
  etaMinutos?: number | null;
  etaKm?: string | null;
  etaActualizadoAt?: number | null;
}): Aviso | null {
  if (a.status !== "en_camino" && a.status !== "en_camino_base") return null;
  const vuelta = a.status === "en_camino_base";
  const conEta = a.etaMinutos != null && a.etaKm != null;
  return {
    titulo: vuelta ? "El técnico vuelve al taller" : "El técnico está en camino",
    detalle: conEta
      ? `Tiempo estimado de llegada: ${a.etaMinutos} min · ${a.etaKm} km`
      : vuelta
        ? "De vuelta al taller"
        : "En camino hacia el punto",
    actualizadoMs: a.etaActualizadoAt ?? null,
    tono: vuelta ? "teal" : "azul",
  };
}

export type Paso = {
  status: RoadsideAssistanceStatus;
  etiqueta: string;
  estado: "hecho" | "actual" | "pendiente";
  /** Hora del paso en ms, o null si todavía no ha pasado. */
  horaMs: number | null;
};

/** Los pasos del seguimiento, en el orden del flujo, con el actual marcado. */
export function pasosDeSeguimiento(
  assistance: RoadsideAssistance,
  events: EventoSeguimiento[] = []
): Paso[] {
  const i = ROADSIDE_ASSISTANCE_STATUS_FLOW.indexOf(assistance.status);
  const actual = i === -1 ? 0 : i;
  return ROADSIDE_ASSISTANCE_STATUS_FLOW.map((status, idx) => ({
    status,
    etiqueta: ROADSIDE_ASSISTANCE_STATUS_LABELS[status],
    estado: idx < actual ? "hecho" : idx === actual ? "actual" : "pendiente",
    horaMs: horaDelPaso(status, assistance, events),
  }));
}

/** ¿Tiene sentido pintar seguimiento en la tarjeta? Sin token o en manos de otro taller, no. */
export function tieneSeguimiento(a: {
  trackingToken?: string | null;
  sinSeguimiento?: boolean | null;
}): boolean {
  return Boolean(a.trackingToken) && !a.sinSeguimiento;
}

export function horaCorta(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export function horaConSegundos(ms?: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
