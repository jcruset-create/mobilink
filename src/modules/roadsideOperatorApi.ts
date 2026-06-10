import { API_BASE, fetchWithTimeout } from "./workshopApi";
import type {
  RoadsideAssistance,
  RoadsideAssistanceFile,
  RoadsideAssistanceStatus,
} from "./roadsideAssistanceTypes";
import type { Tech } from "./workshopTypes";

export type RoadsideOperatorSession = {
  techName: string;
  code: string;
};

function getOperatorHeaders(session: RoadsideOperatorSession): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-roadside-operator-name": session.techName,
    "x-roadside-operator-code": session.code,
  };
}

async function readApiError(response: Response) {
  return response.json().catch(() => null);
}

export async function loadRoadsideOperatorTechs() {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-operator/techs`
  );

  if (!response.ok) {
    throw new Error(`Error cargando operarios. Codigo ${response.status}.`);
  }

  const data = await response.json();
  return Array.isArray(data) ? (data as Tech[]) : [];
}

export async function loginRoadsideOperator(
  techName: string,
  code: string
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-operator/login`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        techName,
        code,
      }),
    }
  );

  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error?.error || "No se pudo iniciar sesion.");
  }

  return (await response.json()) as { ok: true; techName: string };
}

export async function loadRoadsideOperatorAssistances(
  session: RoadsideOperatorSession,
  includeClosed = false
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-operator/assistances?includeClosed=${includeClosed}`,
    {
      headers: getOperatorHeaders(session),
    }
  );

  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error?.error || "No se pudieron cargar asistencias.");
  }

  const data = await response.json();
  return Array.isArray(data) ? (data as RoadsideAssistance[]) : [];
}

export async function updateRoadsideOperatorAssistanceStatus(
  session: RoadsideOperatorSession,
  id: number,
  status: RoadsideAssistanceStatus
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-operator/assistances/${id}/status`,
    {
      method: "POST",
      headers: getOperatorHeaders(session),
      body: JSON.stringify({
        status,
      }),
    }
  );

  if (!response.ok) {
    const error = await readApiError(response);
    throw new Error(error?.error || "No se pudo cambiar el estado.");
  }

  return (await response.json()) as RoadsideAssistance;
}

export async function uploadRoadsideFile(
  session: RoadsideOperatorSession,
  assistanceId: number,
  file: File,
  kind: "foto" | "firma"
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", kind);

  const response = await fetch(
    `${API_BASE}/api/roadside-assistances/${assistanceId}/files`,
    {
      method: "POST",
      headers: {
        "x-roadside-operator-name": session.techName,
        "x-roadside-operator-code": session.code,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo subir el archivo.");
  }

  return (await response.json()) as RoadsideAssistanceFile;
}
