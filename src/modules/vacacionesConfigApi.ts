import { API_BASE, fetchWithTimeout, getAdminHeaders } from "./workshopApi";
import type { ConfigVacaciones, ModoVacaciones } from "./ausenciasTecnicos";

export type VacacionesConfigGuardada = ConfigVacaciones & {
  anio: number;
  workshopId: string;
};

/** Configuración de vacaciones de un año. Si falla, valores por defecto. */
export async function cargarConfigVacaciones(
  anio: number,
  workshopId: string
): Promise<VacacionesConfigGuardada> {
  const porDefecto: VacacionesConfigGuardada = {
    anio,
    workshopId,
    modo: "naturales",
    diasPorDefecto: 30,
    diasPorTecnico: {},
  };

  try {
    const response = await fetchWithTimeout(
      `${API_BASE}/api/vacaciones-config?anio=${anio}&workshopId=${encodeURIComponent(
        workshopId
      )}`
    );

    if (!response.ok) throw new Error(`Error ${response.status}`);

    const data = await response.json();

    return {
      anio,
      workshopId,
      modo: (data?.modo === "laborables" ? "laborables" : "naturales") as ModoVacaciones,
      diasPorDefecto: Number(data?.diasPorDefecto) || porDefecto.diasPorDefecto,
      diasPorTecnico:
        data?.diasPorTecnico && typeof data.diasPorTecnico === "object"
          ? (data.diasPorTecnico as Record<string, number>)
          : {},
    };
  } catch (error) {
    console.error("Error cargando la configuración de vacaciones:", error);
    return porDefecto;
  }
}

export async function guardarConfigVacaciones(config: VacacionesConfigGuardada) {
  const response = await fetchWithTimeout(`${API_BASE}/api/vacaciones-config`, {
    method: "PUT",
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(config),
  });

  if (!response.ok) {
    const texto = await response.text();
    throw new Error(texto || "No se pudo guardar la configuración de vacaciones");
  }

  return true;
}
