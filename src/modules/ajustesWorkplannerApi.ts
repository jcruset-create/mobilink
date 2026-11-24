import { useEffect, useState } from "react";
import { API_BASE } from "./workshopApi";
import { getAdminHeaders } from "./adminHeaders";
import { AJUSTES_POR_DEFECTO, normalizarAjustes, type AjustesWorkplanner } from "./ajustesWorkplanner";

/**
 * Los últimos ajustes cargados, para quien los necesita sin esperar (un
 * formulario que se abre después, un botón del operativo). Hasta la primera
 * carga, los de siempre.
 */
let vigentes: AjustesWorkplanner = AJUSTES_POR_DEFECTO;
const oyentes = new Set<(a: AjustesWorkplanner) => void>();

export function ajustesVigentes(): AjustesWorkplanner {
  return vigentes;
}

function publicar(a: AjustesWorkplanner) {
  vigentes = a;
  for (const f of oyentes) f(a);
}

/** Nunca lanza: sin respuesta, los valores de siempre. */
export async function cargarAjustesWorkplanner(): Promise<AjustesWorkplanner> {
  try {
    const res = await fetch(`${API_BASE}/api/ajustes-workplanner`, { headers: getAdminHeaders() });
    if (!res.ok) return vigentes;
    const a = normalizarAjustes(await res.json().catch(() => null));
    publicar(a);
    return a;
  } catch {
    return vigentes;
  }
}

/** Los ajustes en un componente: carga una vez y se entera de los cambios guardados. */
export function useAjustesWorkplanner(): AjustesWorkplanner {
  const [a, setA] = useState<AjustesWorkplanner>(vigentes);
  useEffect(() => {
    oyentes.add(setA);
    void cargarAjustesWorkplanner();
    return () => {
      oyentes.delete(setA);
    };
  }, []);
  return a;
}

export async function guardarAjustesWorkplanner(ajustes: AjustesWorkplanner): Promise<AjustesWorkplanner> {
  const res = await fetch(`${API_BASE}/api/ajustes-workplanner`, {
    method: "PUT",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(ajustes),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || "No se pudieron guardar los ajustes.");
  const a = normalizarAjustes(body);
  publicar(a);
  return a;
}
