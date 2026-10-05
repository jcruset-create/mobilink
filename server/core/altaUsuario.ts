/**
 * Qué hacer cuando Auth dice «ese usuario ya existe».
 *
 * ── Por qué pasa con un nombre que no sale en la lista ──────────────────────
 *
 * El login se convierte en un email sintético (`albert@usuarios.sea`) y ése
 * vive en Supabase Auth, que es GLOBAL: una sola tabla para todas las
 * empresas. La lista de usuarios que ve un administrador es la de SU empresa.
 * Así que «ya existe» y «no lo veo» son compatibles de tres maneras:
 *
 *  · huérfana: el alta se hizo en dos pasos (cuenta Auth, luego ficha) y el
 *    segundo falló; o se borró la ficha y la limpieza de Auth, que es
 *    best-effort, no llegó. La cuenta no da acceso a nada, pero bloquea el
 *    nombre para siempre. Se reutiliza: se le pone la contraseña nueva y el
 *    alta sigue como si acabara de crearse.
 *  · ocupada en esta empresa: está en la lista, quizá desactivado o con otro
 *    nombre completo. Se dice dónde mirar.
 *  · ocupada fuera (otra empresa, o un operario de TyreControl que solo vive
 *    en `tc_usuarios`): no se toca y no se dice de quién es. Otro nombre.
 */

export type DuenoDeCuenta =
  | { tipo: "ninguno" }
  | { tipo: "ficha"; empresaId: string | null }
  | { tipo: "tyrecontrol" };

export type DecisionAlta =
  | { accion: "reutilizar" }
  | { accion: "rechazar"; mensaje: string };

export function decidirConCuentaExistente(
  dueno: DuenoDeCuenta,
  admin: { empresaId: string | null; esSuperadmin: boolean },
  username: string
): DecisionAlta {
  if (dueno.tipo === "ninguno") return { accion: "reutilizar" };

  if (dueno.tipo === "ficha") {
    const mismaEmpresa =
      dueno.empresaId != null && dueno.empresaId === admin.empresaId;
    if (mismaEmpresa || admin.esSuperadmin) {
      return {
        accion: "rechazar",
        mensaje:
          `Ya existe el usuario «${username}»${mismaEmpresa ? " en tu empresa" : " en otra empresa"}. ` +
          (mismaEmpresa
            ? "Búscalo en la lista (puede estar desactivado) o elige otro nombre de usuario."
            : "Elige otro nombre de usuario."),
      };
    }
  }

  return {
    accion: "rechazar",
    mensaje:
      `El nombre de usuario «${username}» ya está en uso. ` +
      `Elige otro, por ejemplo «${username.toLowerCase()}2».`,
  };
}
