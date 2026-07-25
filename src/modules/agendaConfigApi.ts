import { API_BASE, fetchWithTimeout, getAdminHeaders } from "./workshopApi";
import {
  DEFAULT_AGENDA_CONFIG,
  normalizeAgendaConfig,
  type AgendaConfig,
} from "./agendaConfig";

export async function loadAgendaConfig(): Promise<AgendaConfig> {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/agenda-config`);
    if (!response.ok) throw new Error(`Error ${response.status}`);

    const data = await response.json();
    return data ? normalizeAgendaConfig(data) : DEFAULT_AGENDA_CONFIG;
  } catch (error) {
    console.error("Error cargando la configuración de agenda:", error);
    return DEFAULT_AGENDA_CONFIG;
  }
}

export async function saveAgendaConfig(config: AgendaConfig): Promise<AgendaConfig> {
  const response = await fetchWithTimeout(`${API_BASE}/api/agenda-config`, {
    method: "PUT",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(config),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || `Error guardando la configuración (${response.status})`);
  }

  return normalizeAgendaConfig(data);
}
