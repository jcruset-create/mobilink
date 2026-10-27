import { getTechStatusLabel } from "./techStatus";
import type { ScheduledTechStatus } from "./techStatusScheduleHelpers";
import type { TechStatus } from "./workshopTypes";

/**
 * Las barras de «Todo el día» de la agenda y los estados programados son dos
 * tablas distintas, y se desencajan.
 *
 * ── El fallo que arregla ────────────────────────────────────────────────────
 *
 * Al programar unas vacaciones desde la agenda se guardan dos cosas: el
 * ESTADO (scheduled_tech_statuses), que es lo que leen Planning, Ausencias y
 * el color del técnico, y una BARRA (agenda_date_reminders), que es lo que
 * pinta la franja «Todo el día». Si la barra no llegó a guardarse —un corte,
 * una pestaña con datos viejos— o se guardó con otro taller, el Planning
 * enseña las vacaciones de Alejandro y la agenda no. Parecía que faltaban.
 *
 * ── La regla ────────────────────────────────────────────────────────────────
 *
 * Manda el estado. Cada estado programado sin barra se reconstruye como barra
 * al cargar la agenda, con el mismo texto y color que si se hubiera creado
 * desde ella. Así editar y borrar siguen funcionando igual: la barra existe.
 */

export type BarraEstado = {
  id: number;
  workshopId?: string | null;
  kind?: "normal" | "tech_status";
  title: string;
  startDate: string;
  endDate: string;
  color: "red" | "orange" | "blue" | "green" | "slate" | "sky";
  notes?: string;
  techStatusId?: string;
  techName?: string;
  techStatus?: TechStatus;
};

/** La barra cubre ese estado: por id o, en las antiguas sin id, por sus datos. */
export function barraCubreEstado(barra: BarraEstado, estado: ScheduledTechStatus): boolean {
  if (barra.kind !== "tech_status") return false;
  if (barra.techStatusId && barra.techStatusId === estado.id) return true;
  return (
    barra.techName === estado.techName &&
    barra.techStatus === estado.status &&
    barra.startDate === estado.startDate &&
    barra.endDate === estado.endDate
  );
}

/** Estados programados que no tienen barra en la agenda. */
export function estadosSinBarra(
  barras: BarraEstado[],
  estados: ScheduledTechStatus[]
): ScheduledTechStatus[] {
  return estados.filter(
    (e) => e.techName && e.startDate && e.endDate && !barras.some((b) => barraCubreEstado(b, e))
  );
}

export function colorDeEstado(status: TechStatus): BarraEstado["color"] {
  switch (status) {
    case "baja":
      return "red";
    case "otro_taller":
      return "blue";
    case "nodisponible":
      return "slate";
    case "disponible":
      return "green";
    case "formacion":
      return "sky";
    default:
      return "orange";
  }
}

/** La barra que la agenda habría creado para ese estado. */
export function barraDeEstado(estado: ScheduledTechStatus, id: number): BarraEstado {
  return {
    id,
    workshopId: estado.workshopId ?? null,
    kind: "tech_status",
    title: `${estado.techName} · ${getTechStatusLabel(estado.status)}`.toUpperCase(),
    startDate: estado.startDate,
    endDate: estado.endDate,
    color: colorDeEstado(estado.status),
    notes: estado.notes ?? "",
    techStatusId: estado.id,
    techName: estado.techName,
    techStatus: estado.status,
  };
}

/**
 * Barras que sí existen pero están en otro taller que su estado: en la agenda
 * de Tarragona no se ven porque la barra dice Reus. Se devuelven ya corregidas
 * (mismo id, el taller del estado) para guardarlas tal cual.
 */
export function barrasARecolocar(
  barras: BarraEstado[],
  estados: ScheduledTechStatus[],
  normalizar: (taller: unknown) => string
): BarraEstado[] {
  const salida: BarraEstado[] = [];
  for (const e of estados) {
    const b = barras.find((x) => x.kind === "tech_status" && x.techStatusId && x.techStatusId === e.id);
    if (!b) continue;
    if (normalizar(b.workshopId) !== normalizar(e.workshopId)) {
      salida.push({ ...b, workshopId: e.workshopId ?? null });
    }
  }
  return salida;
}
