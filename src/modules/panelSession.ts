import { isValidUserRole, type UserRole } from "./permissions";

/**
 * Qué hacer con la sesión del panel al arrancar, según lo que conteste
 * `GET /api/panel/session`.
 *
 * Vive aquí y no dentro del componente porque es una decisión de seguridad y
 * conviene poder probarla: el panel restauraba la sesión de `localStorage` y no
 * la comprobaba con nadie, así que una sesión revocada seguía valiendo.
 *
 * La distinción que importa: **credencial rechazada** cierra la sesión, pero un
 * **fallo pasajero** (sin red, servidor caído, 500) NO. En el taller se trabaja
 * con la conexión que hay, y echar a la gente por un corte de treinta segundos
 * sería peor que el problema que se arregla.
 */
export type DecisionSesion =
  | { accion: "cerrar"; motivo: string }
  | { accion: "mantener" }
  | {
      accion: "refrescar";
      rol: UserRole | null;
      nombre: string | null;
      vistas: string[] | null;
    };

export const MOTIVO_SESION_CADUCADA = "Tu sesión ha caducado. Vuelve a iniciar sesión.";

/** `status` de la respuesta y su cuerpo ya deserializado (null si no hubo). */
export function decidirSesionPanel(status: number, cuerpo: unknown): DecisionSesion {
  if (status === 401 || status === 403) {
    return { accion: "cerrar", motivo: MOTIVO_SESION_CADUCADA };
  }

  // Cualquier otro fallo se considera transitorio: no se toca la sesión.
  if (status < 200 || status >= 300) {
    return { accion: "mantener" };
  }

  const d = (cuerpo ?? {}) as { role?: unknown; name?: unknown; allowedViews?: unknown };

  const rolTexto = typeof d.role === "string" ? d.role : null;
  const rol = isValidUserRole(rolTexto) ? rolTexto : null;

  const nombre =
    typeof d.name === "string" && d.name.trim() ? d.name.trim() : null;

  const vistas =
    Array.isArray(d.allowedViews) && d.allowedViews.length > 0
      ? d.allowedViews.map(String)
      : null;

  return { accion: "refrescar", rol, nombre, vistas };
}
