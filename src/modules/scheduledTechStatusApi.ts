import type { ScheduledTechStatus } from "./techStatusScheduleHelpers";
import { API_BASE, fetchWithTimeout, getAdminHeaders } from "./workshopApi";

export async function loadScheduledTechStatusesFromBackend(): Promise<
  ScheduledTechStatus[]
> {
  try {
    const response = await fetchWithTimeout(
      `${API_BASE}/api/scheduled-tech-statuses`
    );

    if (!response.ok) {
      throw new Error(`Error cargando estados técnicos: ${response.status}`);
    }

    const data = await response.json();

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("Error cargando estados técnicos programados:", error);
    return [];
  }
}

export async function saveScheduledTechStatusesToBackend(
  items: ScheduledTechStatus[]
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/scheduled-tech-statuses`,
    {
      method: "PUT",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(items),
    }
  );

  if (!response.ok) {
    throw new Error(`Error guardando estados técnicos: ${response.status}`);
  }

  return response.json().catch(() => null);
}