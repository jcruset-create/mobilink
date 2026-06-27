import { API_BASE, fetchWithTimeout, getAdminHeaders } from "./workshopApi";
import type {
  RoadsideAssistance,
  RoadsideAssistanceDraft,
  RoadsideAssistanceEditDraft,
  RoadsideAssistanceStatus,
  RoadsideOperatorCode,
  RoadsideTrackingResponse,
  RoadsideVehicle,
  RoadsideVehicleDraft,
  KnownPlace,
} from "./roadsideAssistanceTypes";

export async function fetchKnownPlaces(clientId?: number | null): Promise<KnownPlace[]> {
  const url = new URL(`${API_BASE}/api/roadside-known-places`, window.location.origin);
  if (clientId) url.searchParams.set("clientId", String(clientId));
  const res = await fetchWithTimeout(url.pathname + url.search, { headers: getAdminHeaders() });
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

export async function createKnownPlace(body: Partial<KnownPlace>) {
  const res = await fetchWithTimeout(`${API_BASE}/api/roadside-known-places`, {
    method: "POST",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("No se pudo crear el lugar");
  return res.json();
}

export async function updateKnownPlace(id: number, body: Partial<KnownPlace>) {
  const res = await fetchWithTimeout(`${API_BASE}/api/roadside-known-places/${id}`, {
    method: "PUT",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("No se pudo actualizar el lugar");
  return res.json();
}

export async function deleteKnownPlace(id: number) {
  const res = await fetchWithTimeout(`${API_BASE}/api/roadside-known-places/${id}`, {
    method: "DELETE",
    headers: getAdminHeaders(),
  });
  if (!res.ok) throw new Error("No se pudo eliminar el lugar");
  return res.json();
}

export async function geocodeAddress(address: string) {
  const response = await fetchWithTimeout(`${API_BASE}/api/geocode`, {
    method: "POST",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ address }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || "No se pudo geocodificar la dirección.");
  }

  return data as { lat: number; lng: number; formattedAddress: string };
}

export async function loadRoadsideAssistancesFromBackend(
  includeClosed = true
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-assistances?includeClosed=${includeClosed}`
  );

  if (!response.ok) {
    throw new Error(`Error cargando asistencias. Codigo ${response.status}.`);
  }

  const data = await response.json();
  return Array.isArray(data) ? (data as RoadsideAssistance[]) : [];
}

export async function loadRoadsideVehiclesFromBackend(includeInactive = true) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-vehicles?includeInactive=${includeInactive}`
  );

  if (!response.ok) {
    throw new Error(`Error cargando furgonetas. Codigo ${response.status}.`);
  }

  const data = await response.json();
  return Array.isArray(data) ? (data as RoadsideVehicle[]) : [];
}

export async function createRoadsideVehicleInBackend(
  draft: RoadsideVehicleDraft & { workshopId?: string | null }
) {
  const response = await fetchWithTimeout(`${API_BASE}/api/roadside-vehicles`, {
    method: "POST",
    headers: getAdminHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(draft),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo crear la furgoneta.");
  }

  return (await response.json()) as RoadsideVehicle;
}

export async function updateRoadsideVehicleInBackend(
  id: number,
  draft: RoadsideVehicleDraft & { workshopId?: string | null }
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-vehicles/${id}`,
    {
      method: "PUT",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify(draft),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo actualizar la furgoneta.");
  }

  return (await response.json()) as RoadsideVehicle;
}

export async function deactivateRoadsideVehicleInBackend(id: number) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-vehicles/${id}`,
    {
      method: "DELETE",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo desactivar la furgoneta.");
  }

  return (await response.json()) as RoadsideVehicle;
}

export async function loadRoadsideOperatorCodesFromBackend() {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-operator-codes`,
    {
      headers: getAdminHeaders(),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Error cargando codigos de operario. Codigo ${response.status}.`
    );
  }

  const data = await response.json();
  return Array.isArray(data) ? (data as RoadsideOperatorCode[]) : [];
}

export async function updateRoadsideOperatorCodeInBackend(
  techName: string,
  code: string
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-operator-codes/${encodeURIComponent(techName)}`,
    {
      method: "PUT",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ code }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo guardar el codigo.");
  }

  return (await response.json()) as RoadsideOperatorCode;
}

export async function deleteRoadsideOperatorCodeInBackend(techName: string) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-operator-codes/${encodeURIComponent(techName)}`,
    {
      method: "DELETE",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo dar de baja el operario.");
  }

  return (await response.json()) as RoadsideOperatorCode;
}

export async function createRoadsideAssistanceInBackend(
  draft: RoadsideAssistanceDraft & { workshopId?: string | null }
) {
  const response = await fetchWithTimeout(`${API_BASE}/api/roadside-assistances`, {
    method: "POST",
    headers: getAdminHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      ...draft,
      latitude: draft.latitude.trim() ? Number(draft.latitude) : null,
      longitude: draft.longitude.trim() ? Number(draft.longitude) : null,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo crear la asistencia.");
  }

  return (await response.json()) as RoadsideAssistance;
}

export async function updateRoadsideAssistanceInBackend(
  id: number,
  draft: RoadsideAssistanceEditDraft & { workshopId?: string | null }
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-assistances/${id}`,
    {
      method: "PUT",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        ...draft,
        latitude: draft.latitude.trim() ? Number(draft.latitude) : null,
        longitude: draft.longitude.trim() ? Number(draft.longitude) : null,
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo actualizar la asistencia.");
  }

  return (await response.json()) as RoadsideAssistance;
}

export async function updateRoadsideAssistanceStatusInBackend(
  id: number,
  status: RoadsideAssistanceStatus
) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-assistances/${id}/status`,
    {
      method: "POST",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ status }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo cambiar el estado.");
  }

  return (await response.json()) as RoadsideAssistance;
}

export async function sendRoadsideTrackingWhatsappInBackend(id: number) {
  const trackingBaseUrl =
    typeof window === "undefined" ? undefined : window.location.origin;

  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-assistances/${id}/send-tracking-whatsapp`,
    {
      method: "POST",
      headers: getAdminHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        trackingBaseUrl,
      }),
    },
    15000
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      error?.message || error?.error || "No se pudo enviar el WhatsApp."
    );
  }

  const data = await response.json();

  return {
    ...data,
    assistance: data.assistance as RoadsideAssistance,
  } as {
    success: boolean;
    sid: string;
    trackingUrl: string;
    assistance: RoadsideAssistance;
  };
}

export async function loadWebfleetVehiclesFromBackend(): Promise<
  { id: string; name: string }[]
> {
  const response = await fetchWithTimeout(`${API_BASE}/api/webfleet/vehicles`);
  if (!response.ok) return [];
  const data = await response.json();
  if (!Array.isArray(data)) return [];
  return data.map((v: any) => ({
    id: String(v.objectno ?? ""),
    name: [v.objectno, v.objectname].filter(Boolean).join(" — "),
  }));
}

export async function enCaminoRoadsideAssistanceInBackend(
  id: number
): Promise<RoadsideAssistance> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/asistencias/${id}/en-camino`,
    {
      method: "POST",
      headers: getAdminHeaders({ "Content-Type": "application/json" }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo calcular ETA.");
  }

  return (await response.json()) as RoadsideAssistance;
}

export type WorkshopConfig = {
  taller_lat: string;
  taller_lng: string;
  taller_direccion: string;
  taller_radio_m: string;
};

export async function loadWorkshopConfigFromBackend(): Promise<WorkshopConfig> {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/workshop-config`,
    { headers: getAdminHeaders({}) }
  );
  if (!response.ok) throw new Error("No se pudo cargar la configuración del taller.");
  return (await response.json()) as WorkshopConfig;
}

export async function saveWorkshopConfigToBackend(config: WorkshopConfig): Promise<void> {
  const response = await fetchWithTimeout(`${API_BASE}/api/workshop-config`, {
    method: "POST",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(config),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo guardar la configuración.");
  }
}

export async function loadRoadsideTrackingFromBackend(token: string) {
  const response = await fetchWithTimeout(
    `${API_BASE}/api/roadside-tracking/${encodeURIComponent(token)}`,
    undefined,
    10000
  );

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error || "No se pudo cargar el seguimiento.");
  }

  return (await response.json()) as RoadsideTrackingResponse;
}
