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

export type FestivoSugerido = {
  date: string;
  label: string;
  scope: string;
  yearly: boolean;
  /** Seguridad de la IA sobre ese festivo; los locales suelen ser los más dudosos. */
  confidence: "alta" | "media" | "baja";
};

/** Pide a la IA el calendario de festivos de una ciudad y un año. */
export async function suggestHolidaysWithAI(
  year: number,
  city: string
): Promise<FestivoSugerido[]> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/agenda-config/festivos-ia`,
    {
      method: "POST",
      headers: getAdminHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ year, city }),
    },
    60000
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || `Error consultando los festivos (${response.status})`);
  }

  return Array.isArray(data?.festivos) ? data.festivos : [];
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
