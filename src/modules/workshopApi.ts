import type { Job, Tech } from "./workshopTypes";

import { API_BASE } from "./workshopConstants";
import { applyJobV2PayloadFields } from "./jobV2PayloadHelpers";
import {
  isHardBlockedTechStatus,
  isUnavailableTechStatus,
  normalizeTechStatus,
} from "./techStatus";

import { nowMs } from "./time";
export async function fetchWithTimeout(
  url: string,
  options?: RequestInit,
  timeoutMs = 8000
) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    return response;
  } finally {
    window.clearTimeout(timer);
  }
}

export function getAdminHeaders(extra?: HeadersInit): HeadersInit {
  const token = localStorage.getItem("sea-admin-token") ?? "";

  return {
    ...(extra ?? {}),
    "x-admin-token": token,
  };
}

export { API_BASE };

async function readApiError(response: Response) {
  return response.json().catch(() => null);
}

function isMaintenanceBlockError(
  response: Response,
  errorData: any
): errorData is { error?: string; blockedTechNames: string[] } {
  return (
    response.status === 409 &&
    errorData &&
    Array.isArray(errorData.blockedTechNames) &&
    errorData.blockedTechNames.length > 0
  );
}

function showMaintenanceBlockAlert(blockedTechNames: string[]) {
  window.alert(
    `No se puede guardar el trabajo.\n\nTécnico fuera de taller por mantenimiento: ${blockedTechNames.join(
      ", "
    )}`
  );
}
export async function saveJobToBackend(job: Job) {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/jobs`, {
      method: "POST",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(applyJobV2PayloadFields(job, job)),
    });

    if (!response.ok) {
      const errorData = await readApiError(response);

      if (isMaintenanceBlockError(response, errorData)) {
        showMaintenanceBlockAlert(errorData.blockedTechNames);

        throw new Error(
          `Trabajo bloqueado por mantenimiento fuera de taller: ${errorData.blockedTechNames.join(
            ", "
          )}`
        );
      }

      console.error("Error guardando trabajo:", {
        status: response.status,
        errorData,
        job,
      });

      throw new Error(
        errorData?.error ||
          `No se pudo guardar el trabajo ${job.plate}. Código ${response.status}.`
      );
    }

    return response.json().catch(() => null);
  } catch (error) {
    console.error("Error guardando trabajo:", error);
    throw error;
  }
}

export async function saveTechToBackend(tech: Tech) {
  try {
    const normalizedStatus = normalizeTechStatus(tech.status);

    const response = await fetchWithTimeout(
      `${API_BASE}/api/techs/${encodeURIComponent(tech.name)}`,
      {
        method: "PUT",
        headers: getAdminHeaders({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          status: normalizedStatus,
          blocked:
            isHardBlockedTechStatus(normalizedStatus) ||
            isUnavailableTechStatus(normalizedStatus) ||
            Boolean(tech.blocked),
          currentJobId:
            isHardBlockedTechStatus(normalizedStatus) ||
            isUnavailableTechStatus(normalizedStatus)
              ? null
              : tech.currentJobId ?? null,
          competencies: tech.competencies,
          priorities: tech.priorities,
          avatar: tech.avatar ?? null,
          statusChangedAtMs: tech.statusChangedAtMs ?? nowMs(),
          statusTotals: tech.statusTotals ?? {},
          roadsideCapable: Boolean(tech.roadsideCapable),
        }),
      }
    );

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Error guardando técnico:", {
        status: response.status,
        responseText,
        tech,
      });

      throw new Error(
        responseText ||
          `No se pudo guardar el técnico ${tech.name}. Código ${response.status}.`
      );
    }

    return responseText ? JSON.parse(responseText) : null;
  } catch (error) {
    console.error("Error guardando técnico:", error);
    throw error;
  }
}

export async function deleteScheduledJobFromBackend(id: number) {
  const response = await fetchWithTimeout(`${API_BASE}/api/scheduled-jobs/${id}`, {
    method: "DELETE",
    headers: getAdminHeaders({
      "Content-Type": "application/json",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "No se pudo eliminar la cita programada");
  }
}
export async function loadJobsFromBackend() {
  const response = await fetchWithTimeout(`${API_BASE}/api/jobs`);

  if (!response.ok) {
    throw new Error(`Error cargando trabajos. Código ${response.status}.`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Trabajos recibidos no válidos.");
  }

  return data;
}

export async function loadLogsFromBackend() {
  const response = await fetchWithTimeout(`${API_BASE}/api/logs`);

  if (!response.ok) {
    throw new Error(`Error cargando logs. Código ${response.status}.`);
  }

  const data = await response.json();

  return Array.isArray(data) ? data : [];
}

export async function loadQuickTemplatesFromBackend() {
  const response = await fetchWithTimeout(`${API_BASE}/api/quick-templates`);

  if (!response.ok) {
    throw new Error(
      `Error cargando entradas rápidas. Código ${response.status}.`
    );
  }

  const data = await response.json();

  return data;
}

export async function loadScheduledJobsFromBackend() {
  const response = await fetchWithTimeout(`${API_BASE}/api/scheduled-jobs`);

  if (!response.ok) {
    throw new Error(`Error cargando agenda. Código ${response.status}.`);
  }

  const data = await response.json();

  if (!Array.isArray(data)) {
    throw new Error("Agenda recibida no válida.");
  }

  return data;
}

export async function loadTechsFromBackend() {
  const response = await fetchWithTimeout(`${API_BASE}/api/techs`);

  if (!response.ok) {
    throw new Error(`Error cargando técnicos. Código ${response.status}.`);
  }

  const data = await response.json();

  return Array.isArray(data) ? data : [];
}