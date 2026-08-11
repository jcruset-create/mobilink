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

/**
 * Borra un recordatorio concreto.
 *
 * Antes el borrado se hacía enviando la lista entera con PUT, y el servidor
 * vaciaba la tabla para reinsertarla: dos pestañas abiertas se pisaban y se
 * perdían recordatorios ajenos.
 */
export async function deleteAgendaDateReminderFromBackend(id: number) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/agenda-date-reminders/${id}`,
    {
      method: "DELETE",
      headers: getAdminHeaders(),
    }
  );

  if (!response.ok) {
    throw new Error(`Error eliminando el recordatorio: ${response.status}`);
  }

  return response.json().catch(() => null);
}
