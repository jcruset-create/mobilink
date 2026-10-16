import { API_BASE, getAdminHeaders } from "./workshopApi";
import type { EmpleadoCore } from "./personasDeAusencias";

/**
 * Empleados activos de Core. Si no se pueden cargar, lista vacía: Ausencias y
 * Planning siguen enseñando los técnicos como siempre.
 */
export async function cargarEmpleadosCore(): Promise<EmpleadoCore[]> {
  try {
    const res = await fetch(`${API_BASE}/api/empleados-core`, { headers: getAdminHeaders() });
    if (!res.ok) return [];
    const body = await res.json().catch(() => []);
    return Array.isArray(body) ? (body as EmpleadoCore[]) : [];
  } catch {
    return [];
  }
}
