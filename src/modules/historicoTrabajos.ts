import type { Job } from "./workshopTypes";

/**
 * El histórico de trabajos: filtrar lo cerrado y agruparlo por día.
 *
 * Puro y aparte de la pantalla porque es donde está lo que puede salir mal:
 * qué cuenta como «cerrado», qué fecha manda al agrupar y cuántos minutos se
 * apuntan. Un trabajo cancelado no tiene hora de cierre, y si se agrupara por
 * ella se iría al día equivocado o desaparecería.
 */

export type EstadoHistorico = "realizado" | "cancelado";

export type FiltroHistorico = {
  texto?: string;
  desdeMs?: number | null;
  hastaMs?: number | null;
  area?: string | null;
  estado?: EstadoHistorico | "todos";
};

/** Un trabajo cerrado se da por realizado; uno eliminado, por cancelado. */
export function estadoHistorico(job: Pick<Job, "status">): EstadoHistorico | null {
  const s = String(job.status ?? "").toLowerCase();
  if (s === "cerrado") return "realizado";
  if (s === "cancelado" || s === "eliminado") return "cancelado";
  return null;
}

/**
 * La fecha por la que se ordena y se agrupa.
 *
 * La de cierre si la hay; si no, la de creación. Un cancelado no la tiene, y
 * sin este respaldo se caería de la lista sin que nadie lo echara de menos.
 */
export function fechaDelHistorico(job: Pick<Job, "closedAtMs" | "createdAtMs">): number {
  const cierre = Number(job.closedAtMs);
  if (Number.isFinite(cierre) && cierre > 0) return cierre;
  const alta = Number(job.createdAtMs);
  return Number.isFinite(alta) ? alta : 0;
}

/** Los minutos que se apuntan a ese trabajo. */
export function minutosDelHistorico(job: Pick<Job, "workedAccumulatedMinutes">): number {
  const m = Number(job.workedAccumulatedMinutes);
  return Number.isFinite(m) && m > 0 ? Math.round(m) : 0;
}

function normaliza(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

/** Lo que se busca con el buscador: matrícula, cliente o número de parte. */
export function coincideTexto(job: Pick<Job, "plate" | "customerName" | "ptNumero">, texto: string): boolean {
  const q = normaliza(texto).replace(/\s+/g, " ");
  if (!q) return true;

  // La matrícula se teclea con y sin guiones, y en el papel va de las dos
  // formas: se compara también sin nada que no sea letra o número.
  const campos = [job.plate, job.customerName, job.ptNumero].map(normaliza);
  const matriculaPlana = normaliza(job.plate).replace(/[^A-Z0-9]/g, "");
  const qPlana = q.replace(/[^A-Z0-9]/g, "");

  return (
    campos.some((c) => c.includes(q)) ||
    (qPlana.length >= 3 && matriculaPlana.includes(qPlana))
  );
}

/** Los trabajos del histórico que pasan el filtro, del más reciente al más viejo. */
export function filtraHistorico(jobs: Job[], filtro: FiltroHistorico): Job[] {
  const estadoPedido = filtro.estado ?? "todos";

  return jobs
    .filter((j) => {
      const estado = estadoHistorico(j);
      if (!estado) return false;
      if (estadoPedido !== "todos" && estado !== estadoPedido) return false;

      const fecha = fechaDelHistorico(j);
      if (filtro.desdeMs != null && fecha < filtro.desdeMs) return false;
      if (filtro.hastaMs != null && fecha > filtro.hastaMs) return false;

      if (filtro.area && String(j.area ?? "") !== filtro.area) return false;

      return coincideTexto(j, filtro.texto ?? "");
    })
    .sort((a, b) => fechaDelHistorico(b) - fechaDelHistorico(a));
}

export type DiaDelHistorico = {
  /** 'YYYY-MM-DD' en la hora de quien mira, que es la que entiende. */
  dia: string;
  trabajos: Job[];
  minutos: number;
};

function claveDeDia(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Agrupa por día, en el mismo orden en que vienen (ya ordenados). */
export function agrupaPorDia(jobs: Job[]): DiaDelHistorico[] {
  const porDia = new Map<string, DiaDelHistorico>();

  for (const job of jobs) {
    const dia = claveDeDia(fechaDelHistorico(job));
    const grupo = porDia.get(dia) ?? { dia, trabajos: [], minutos: 0 };
    grupo.trabajos.push(job);
    grupo.minutos += minutosDelHistorico(job);
    porDia.set(dia, grupo);
  }

  return [...porDia.values()];
}

/** Los números de arriba. */
export function resumenHistorico(jobs: Job[]): {
  total: number;
  minutos: number;
  cancelados: number;
} {
  let minutos = 0;
  let cancelados = 0;

  for (const job of jobs) {
    minutos += minutosDelHistorico(job);
    if (estadoHistorico(job) === "cancelado") cancelados++;
  }

  return { total: jobs.length, minutos, cancelados };
}

/** El último mes, que es el rango con el que se abre la pantalla. */
export function rangoUltimoMes(ahoraMs: number): { desdeMs: number; hastaMs: number } {
  const hasta = new Date(ahoraMs);
  hasta.setHours(23, 59, 59, 999);

  const desde = new Date(ahoraMs);
  desde.setMonth(desde.getMonth() - 1);
  desde.setHours(0, 0, 0, 0);

  return { desdeMs: desde.getTime(), hastaMs: hasta.getTime() };
}
