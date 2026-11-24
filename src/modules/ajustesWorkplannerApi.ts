import { API_BASE } from "./workshopApi";
import { getAdminHeaders } from "./adminHeaders";
import { AJUSTES_POR_DEFECTO, normalizarAjustes, type AjustesWorkplanner } from "./ajustesWorkplanner";

/** Nunca lanza: sin respuesta, los valores de siempre. */
export async function cargarAjustesWorkplanner(): Promise<AjustesWorkplanner> {
  try {
    const res = await fetch(`${API_BASE}/api/ajustes-workplanner`, { headers: getAdminHeaders() });
    if (!res.ok) return AJUSTES_POR_DEFECTO;
    return normalizarAjustes(await res.json().catch(() => null));
  } catch {
    return AJUSTES_POR_DEFECTO;
  }
}

export async function guardarAjustesWorkplanner(ajustes: AjustesWorkplanner): Promise<AjustesWorkplanner> {
  const res = await fetch(`${API_BASE}/api/ajustes-workplanner`, {
    method: "PUT",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(ajustes),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || "No se pudieron guardar los ajustes.");
  return normalizarAjustes(body);
}
