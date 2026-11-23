/** Km de revisiones y montajes desde la ficha del neumático (servidor: kilometrajeRevisiones/aDemanda.ts). */
import { authHeaders } from "./data";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";
const BASE = `${API}/api/tyrecontrol/km-ficha`;

async function post<T>(ruta: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${ruta}`, {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data as T;
}

export type PropuestaKm =
  | { estado: "ok"; km: number; corroboracion: "dos_ventanas" | "una_ventana"; capturadoAt: string }
  | { estado: "no"; motivo: string };
type Vecina = { km: number; fecha: string } | null;

export const proponerKmRevision = (id: string) =>
  post<{ propuesta: PropuestaKm; neumaticos: number; anterior: Vecina; siguiente: Vecina }>(`/revision/${id}/proponer`);
export const guardarKmRevision = (id: string, origen: "telematica" | "manual", km?: string) =>
  post<{ km: number; origen: string; neumaticos: number }>(`/revision/${id}/guardar`, { origen, km });
export const pedirKmTodasRevisiones = (vehiculoId: string) =>
  post<{ revisiones: Array<{ fecha: string; km?: number; motivo?: string }> }>(`/vehiculo/${vehiculoId}/todas`);
export const proponerKmMontaje = (neumaticoId: string) =>
  post<{ propuesta: PropuestaKm; fecha: string; anterior: Vecina; siguiente: Vecina }>(`/montaje/${neumaticoId}/proponer`);
export const guardarKmMontaje = (neumaticoId: string, origen: "telematica" | "manual", km?: string) =>
  post<{ km: number; origen: string }>(`/montaje/${neumaticoId}/guardar`, { origen, km });
