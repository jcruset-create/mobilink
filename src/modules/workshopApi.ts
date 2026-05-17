import type { Job, Tech } from "./workshopTypes";

import { API_BASE } from "./workshopConstants";

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
export async function saveJobToBackend(job: Job) {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/api/jobs`, {
      method: "POST",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(job),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Error guardando trabajo:", {
        status: response.status,
        responseText,
        job,
      });

      throw new Error(
        responseText ||
          `No se pudo guardar el trabajo ${job.plate}. Código ${response.status}.`
      );
    }

    if (!responseText) {
      return null;
    }

    try {
      return JSON.parse(responseText);
    } catch {
      return null;
    }
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