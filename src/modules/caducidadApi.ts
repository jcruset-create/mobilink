import { API_BASE, fetchWithTimeout, getAdminHeaders } from "./workshopApi";
import type { CaducidadReminder } from "./caducidadHelpers";

export type CaducidadDraft = {
  workshopId?: string | null;
  cliente_nombre: string;
  vehiculo: string;
  matricula: string;
  unidad: string;
  telefono: string;
  tipo_caducidad: string;
  fecha_caducidad: string;
  dias_antelacion: number;
  dias_antelacion2: number;
  enviar_whatsapp: boolean;
  enviar_sms: boolean;
  observaciones: string;
};

async function parseOrThrow(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `Error del servidor (${response.status})`);
  }
  return data;
}

export async function loadCaducidadReminders(): Promise<CaducidadReminder[]> {
  const response = await fetchWithTimeout(`${API_BASE}/api/recordatorios-caducidad`);
  const data = await parseOrThrow(response);
  return Array.isArray(data) ? data : [];
}

export async function createCaducidadReminder(
  draft: CaducidadDraft
): Promise<CaducidadReminder> {
  const response = await fetchWithTimeout(`${API_BASE}/api/recordatorios-caducidad`, {
    method: "POST",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(draft),
  });
  return parseOrThrow(response);
}

export async function updateCaducidadReminder(
  id: number,
  draft: Partial<CaducidadDraft>
): Promise<CaducidadReminder> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/recordatorios-caducidad/${id}`,
    {
      method: "PUT",
      headers: getAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(draft),
    }
  );
  return parseOrThrow(response);
}

export async function cancelCaducidadReminder(id: number): Promise<CaducidadReminder> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/recordatorios-caducidad/${id}/cancelar`,
    { method: "POST", headers: getAdminHeaders({ "Content-Type": "application/json" }) }
  );
  return parseOrThrow(response);
}

export async function sendCaducidadReminder(
  id: number,
  canal?: "whatsapp" | "sms"
): Promise<{ success: boolean; errores: string[]; recordatorio: CaducidadReminder }> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/recordatorios-caducidad/${id}/enviar`,
    {
      method: "POST",
      headers: getAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ canal: canal ?? "" }),
    }
  );
  return parseOrThrow(response);
}

export async function convertCaducidadReminder(
  id: number,
  citaId: number
): Promise<CaducidadReminder> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/recordatorios-caducidad/${id}/convertir-cita`,
    {
      method: "POST",
      headers: getAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ citaId }),
    }
  );
  return parseOrThrow(response);
}
