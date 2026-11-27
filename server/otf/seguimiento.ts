/**
 * El seguimiento de una OTF de principio a fin: de la salida del taller a la
 * vuelta al taller. Solo cuentas, sin red ni base de datos:
 *
 *  · la ventana de tiempo de los movimientos de la furgoneta;
 *  · los hitos (salida, llegada a la base, cada trabajo, firma, vuelta,
 *    llegada al taller) para colocarlos en la línea de tiempo y en el PDF;
 *  · qué se le enseña al cliente con el enlace público, y hasta cuándo.
 *
 * Las fases en sí (en camino, en la base, trabajando…) están en
 * src/modules/seguimientoOtf.ts, compartidas con el panel.
 */

import type { Hito } from "../assist/movimientos.ts";

export type OtfParaSeguimiento = {
  id: number;
  status: string;
  createdAtMs?: number | null;
  fechaProgramadaMs?: number | null;
  departedAtMs?: number | null;
  arrivedAtBaseMs?: number | null;
  finishedAtMs?: number | null;
  enCaminoBaseAtMs?: number | null;
  arrivedAtWorkshopMs?: number | null;
  updatedAtMs?: number | null;
};

export type TrabajoParaSeguimiento = {
  plate: string | null;
  iniciadoAtMs: number | null;
  finalizadoAtMs: number | null;
  status: string;
};

const HORA = 3600_000;

/** «13:58» en hora de Madrid. */
export function horaMadrid(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
}

/**
 * Desde la salida del taller (o, si no se detectó, un rato antes de llegar a
 * la base) hasta la llegada al taller, o ahora si sigue fuera. Nunca más de un
 * día: una OTF olvidada abierta no puede pedir a Webfleet una semana entera.
 */
export function ventanaDeOtf(o: OtfParaSeguimiento, ahoraMs = Date.now()): { desdeMs: number; hastaMs: number } | null {
  const desde =
    o.departedAtMs ??
    (o.arrivedAtBaseMs != null ? o.arrivedAtBaseMs - 2 * HORA : null) ??
    null;
  if (desde == null) return null; // aún no ha salido: no hay movimientos que ver
  const fin =
    o.arrivedAtWorkshopMs ??
    (o.status === "cancelada" ? o.updatedAtMs ?? ahoraMs : ahoraMs);
  const hastaMs = Math.min(Math.max(fin, desde), desde + 24 * HORA);
  return { desdeMs: desde, hastaMs };
}

/** Los momentos de la OTF, en orden, para la línea de tiempo. */
export function hitosDeOtf(o: OtfParaSeguimiento, trabajos: TrabajoParaSeguimiento[] = []): Hito[] {
  const hitos: Hito[] = [];
  const poner = (etiqueta: string, ms: number | null | undefined) => {
    if (ms != null && Number.isFinite(ms) && ms > 0) hitos.push({ etiqueta, ms });
  };
  poner("Salida del taller", o.departedAtMs);
  poner("Llegada a la base", o.arrivedAtBaseMs);
  for (const t of trabajos) {
    if (t.iniciadoAtMs == null) continue;
    const quien = t.plate || "Trabajo";
    const fin = t.finalizadoAtMs != null ? `–${horaMadrid(t.finalizadoAtMs)}` : "";
    const nr = t.status === "no_realizado" ? " (no realizado)" : "";
    poner(`${quien} ${horaMadrid(t.iniciadoAtMs)}${fin}${nr}`, t.iniciadoAtMs);
  }
  poner("Firma", o.finishedAtMs);
  poner("Vuelta al taller", o.enCaminoBaseAtMs);
  poner("Llegada al taller", o.arrivedAtWorkshopMs);
  return hitos.sort((a, b) => a.ms - b.ms);
}

/** Las fases con hora, para la cabecera del PDF de seguimiento. */
export function fasesParaInforme(o: OtfParaSeguimiento, trabajos: TrabajoParaSeguimiento[] = []) {
  const inicios = trabajos.map((t) => t.iniciadoAtMs).filter((x): x is number => x != null);
  const fines = trabajos.map((t) => t.finalizadoAtMs).filter((x): x is number => x != null);
  return [
    { etiqueta: "Salida del taller", ms: o.departedAtMs ?? null },
    { etiqueta: "Llegada a la base", ms: o.arrivedAtBaseMs ?? null },
    { etiqueta: "Primer trabajo", ms: inicios.length ? Math.min(...inicios) : null },
    { etiqueta: "Último trabajo", ms: fines.length ? Math.max(...fines) : null },
    { etiqueta: "Salida de la base", ms: o.enCaminoBaseAtMs ?? null },
    { etiqueta: "Llegada al taller", ms: o.arrivedAtWorkshopMs ?? null },
  ];
}

/**
 * Hasta cuándo sirve el enlace del cliente: mientras la OTF está en marcha y
 * un día más después de volver al taller (o de cerrarse, si no se detectó la
 * vuelta), para que pueda mirar cómo fue. Anulada: ya no.
 */
export function enlaceCaducado(o: OtfParaSeguimiento, ahoraMs = Date.now()): boolean {
  if (o.status === "cancelada") return true;
  const fin = o.arrivedAtWorkshopMs ?? (o.status === "finalizada" ? o.finishedAtMs : null);
  // Finalizada sin vuelta detectada: se le da margen para que vuelva.
  const margen = o.arrivedAtWorkshopMs != null ? 24 * HORA : 36 * HORA;
  return fin != null && ahoraMs > fin + margen;
}

/** El texto del correo con el enlace, cuando la furgoneta sale del taller. */
export function textoCorreoSalida(p: { cliente: string | null; base: string | null; tecnico: string | null; enlace: string }): string {
  return [
    "Hola,",
    "",
    `${p.tecnico ? `${p.tecnico}, de Mobilink,` : "Nuestro técnico"} ha salido hacia ${p.base || "su base"}${p.cliente ? ` (${p.cliente})` : ""}.`,
    "",
    "Puede seguir la furgoneta en el mapa, con la hora prevista de llegada y el avance de los trabajos, en este enlace:",
    p.enlace,
    "",
    "Al terminar le enviaremos el informe de los trabajos y el del recorrido.",
  ].join("\n");
}
