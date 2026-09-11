/**
 * De dónde sale el rol de un usuario en Almacén.
 *
 * Paso 1 de la unificación de usuarios (ver `docs/FASE1_OPERARIOS_CORE_ESTUDIO.md`,
 * apartado 0): la fuente de verdad pasa a ser `app_usuario_modulos`, el mismo sitio
 * que gestiona Administración → Usuarios. `perfiles_usuario` deja de ser un almacén
 * de identidad y se queda como satélite del módulo (ubicación, código de operario,
 * clientes asignados).
 *
 * Se conserva la vuelta atrás a `perfiles_usuario.rol` mientras queden usuarios sin
 * migrar: si se quitara de golpe, cualquiera que aún no tenga fila en
 * `app_usuario_modulos` se quedaría sin acceso al almacén de un día para otro.
 *
 * Los tres roles coinciden uno a uno entre ambas tablas, así que no hay traducción.
 */

export type RolAlmacen = "admin" | "responsable" | "operario";

const ROLES: RolAlmacen[] = ["admin", "responsable", "operario"];

export type OrigenRol = "superadmin" | "core" | "legacy" | "ninguno";

export type RolResuelto = {
  rol: RolAlmacen | null;
  origen: OrigenRol;
};

function normalizar(valor: unknown): RolAlmacen | null {
  const texto = String(valor ?? "").trim().toLowerCase();
  return (ROLES as string[]).includes(texto) ? (texto as RolAlmacen) : null;
}

/**
 * @param rolCore   `app_usuario_modulos.rol` para `modulo = 'almacen'` (fuente de verdad)
 * @param rolLegacy `perfiles_usuario.rol` (heredado, mientras dure la migración)
 * @param superadmin superadmin de plataforma
 */
export function resolverRolAlmacen(
  rolCore: unknown,
  rolLegacy: unknown,
  superadmin: boolean
): RolResuelto {
  // El superadmin manda sobre todo: entra aunque no tenga ficha en ningún sitio.
  if (superadmin) return { rol: "admin", origen: "superadmin" };

  const core = normalizar(rolCore);
  if (core) return { rol: core, origen: "core" };

  const legacy = normalizar(rolLegacy);
  if (legacy) return { rol: legacy, origen: "legacy" };

  return { rol: null, origen: "ninguno" };
}
