import { API_BASE, fetchWithTimeout, getAdminHeaders } from "./workshopApi";

export type AgendaDateReminderPayload = {
  id: number;
  workshopId?: string | null;
  kind?: "normal" | "tech_status";
  title: string;
  startDate: string;
  endDate: string;
  color: "red" | "orange" | "blue" | "green" | "slate";
  notes?: string;
  techStatusId?: string;
  techName?: string;
  techStatus?: string;
};

export async function loadAgendaDateRemindersFromBackend(): Promise<
  AgendaDateReminderPayload[]
> {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE}/api/agenda-date-reminders`
    );

    if (!response.ok) {
      throw new Error(`Error cargando recordatorios: ${response.status}`);
    }

    const data = await response.json();

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error cargando recordatorios de agenda:", error);
    return [];
  }
}

export async function saveAgendaDateRemindersToBackend(
  items: AgendaDateReminderPayload[]
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/agenda-date-reminders`,
    {
      method: "PUT",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(items),
    }
  );

  if (!response.ok) {
    throw new Error(`Error guardando recordatorios: ${response.status}`);
  }

  return response.json().catch(() => null);
}