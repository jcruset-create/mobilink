import { supabase } from "./supabase";
import { cargarPermisosUsuarioActual } from "./permisosAlmacen";

type RegistrarAuditoriaParams = {
  modulo: string;
  accion: string;
  tabla_afectada?: string | null;
  registro_id?: string | null;
  descripcion?: string | null;
  datos?: Record<string, unknown> | null;
};

export async function registrarAuditoria({
  modulo,
  accion,
  tabla_afectada = null,
  registro_id = null,
  descripcion = null,
  datos = null,
}: RegistrarAuditoriaParams) {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user || null;

    const permisos = await cargarPermisosUsuarioActual();
    const perfil = permisos.perfil;

    if (!user || !perfil) {
      return {
        ok: false,
        error: "Sin usuario o perfil activo para auditoría.",
      };
    }

    const { error } = await supabase.from("auditoria_acciones").insert({
      user_id: user.id,
      perfil_usuario_id: perfil.id,
      codigo_operario: perfil.codigo_operario,
      email: perfil.email || user.email || null,
      rol: perfil.rol,

      modulo,
      accion,

      tabla_afectada,
      registro_id,

      descripcion,
      datos,

      user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent : null,
    });

    if (error) {
      console.warn("Error registrando auditoría:", error.message);

      return {
        ok: false,
        error: error.message,
      };
    }

    return {
      ok: true,
      error: null,
    };
  } catch (error) {
    console.warn("Error inesperado registrando auditoría:", error);

    return {
      ok: false,
      error: "Error inesperado registrando auditoría.",
    };
  }
}