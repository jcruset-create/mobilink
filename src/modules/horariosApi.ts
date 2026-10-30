import { apiFetch } from "./apiFetch";
import { API_BASE } from "./workshopApi";
import type { AsignacionHorario, Turno } from "./horariosTurnos";

/** Llamadas de Horarios y turnos. Todas van con la sesión unificada (Bearer). */

export type EmpleadoSemana = { id: string; nombre: string; centro: string | null; techName: string | null };
export type AusenciaSemana = { nombre: string; estado: string; desde: string; hasta: string };

export type DatosSemana = {
  lunes: string;
  domingo: string;
  empleados: EmpleadoSemana[];
  turnos: Turno[];
  asignaciones: AsignacionHorario[];
  ausencias: AusenciaSemana[];
};

async function leer<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as any)?.error || `Error ${res.status}`);
  return body as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export async function cargarTurnos(): Promise<Turno[]> {
  return leer<Turno[]>(await apiFetch(`${API_BASE}/api/horarios/turnos`));
}

export async function guardarTurno(turno: Partial<Turno>): Promise<Turno> {
  return leer<Turno>(
    await apiFetch(`${API_BASE}/api/horarios/turnos`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(turno),
    })
  );
}

export async function cargarAsignaciones(employeeId?: string): Promise<AsignacionHorario[]> {
  const q = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
  return leer<AsignacionHorario[]>(await apiFetch(`${API_BASE}/api/horarios/asignaciones${q}`));
}

export async function guardarAsignacion(a: AsignacionHorario): Promise<AsignacionHorario> {
  return leer<AsignacionHorario>(
    await apiFetch(`${API_BASE}/api/horarios/asignaciones`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(a),
    })
  );
}

export async function borrarAsignacion(id: string): Promise<void> {
  await leer(await apiFetch(`${API_BASE}/api/horarios/asignaciones/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

export async function cargarSemana(fecha: string): Promise<DatosSemana> {
  return leer<DatosSemana>(await apiFetch(`${API_BASE}/api/horarios/semana?fecha=${encodeURIComponent(fecha)}`));
}

/** Colores fijos por turno, por orden de aparición; «taller» siempre azul. */
const PALETA = [
  "text-yellow-300 border-yellow-400/40 bg-yellow-400/10",
  "text-violet-300 border-violet-400/40 bg-violet-400/10",
  "text-emerald-300 border-emerald-400/40 bg-emerald-400/10",
  "text-pink-300 border-pink-400/40 bg-pink-400/10",
  "text-orange-300 border-orange-400/40 bg-orange-400/10",
  "text-cyan-300 border-cyan-400/40 bg-cyan-400/10",
];
const TALLER = "text-sky-300 border-sky-400/40 bg-sky-400/10";

export function claseDeTurno(turnoId: string, turnos: Turno[]): string {
  if (turnoId === "taller") return TALLER;
  const i = turnos.findIndex((t) => t.id === turnoId);
  return PALETA[(i < 0 ? 0 : i) % PALETA.length];
}
