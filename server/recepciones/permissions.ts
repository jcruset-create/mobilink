/**
 * Permisos del módulo Recepciones.
 *
 * No se estrena un sistema de usuarios: se apoya en `app_usuario_modulos`, que
 * guarda por usuario y módulo un `rol`, y aquí ese rol se traduce a permisos
 * finos. Misma forma que `server/therefore/permissions.ts` y
 * `server/cash/permissions.ts`.
 *
 * Sin caché, por el mismo motivo que en caja: quitarle a alguien el permiso de
 * recepcionar tiene que surtir efecto en la siguiente petición.
 *
 * El `centro_id` del acceso es el ÁMBITO del usuario: un operario del muelle
 * de Tarragona ve y cierra los albaranes de Tarragona. `null` = toda la
 * empresa, que es el valor por defecto de la columna y lo que hereda todo el
 * censo de usuarios (ver cash/permissions.ts para por qué ese defecto).
 */

import type { RequestHandler } from "express";
import pool from "../db.ts";

export const PERMISOS = [
  /** Ver la bandeja, los pedidos, las recepciones, las incidencias y los documentos. */
  "recepciones.view",
  /** Crear pedidos a mano (y cancelarlos). */
  "recepciones.pedido.create",
  /** Asociar albaranes a un pedido y subir su PDF original. */
  "recepciones.albaran.create",
  /** Cerrar una recepción física: OK o con incidencia. */
  "recepciones.recibir",
  /** Gestionar y resolver incidencias; cerrar un albarán con diferencia aceptada. */
  "recepciones.incidencia.manage",
  /** Rectificar una recepción cerrada y regenerar su documento. */
  "recepciones.rectificar",
  /** Proveedores y mapeo de artículos. */
  "recepciones.proveedores.manage",
  /**
   * El correo del proveedor: importar un .eml a mano, forzar una pasada del
   * buzón, reprocesar un correo que quedó en revisión.
   */
  "recepciones.correo.importar",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export type RolRecepciones = "consulta" | "operario" | "gestor" | "admin";

/**
 * · consulta — mirar.
 * · operario — el muelle: recepcionar. Puede confirmar un mapeo de artículo
 *              porque es quien tiene la mercancía delante.
 * · gestor   — además, pedidos, albaranes, incidencias y rectificaciones.
 * · admin    — todo.
 */
const POR_ROL: Record<RolRecepciones, readonly Permiso[]> = {
  consulta: ["recepciones.view"],
  operario: ["recepciones.view", "recepciones.recibir"],
  gestor: [
    "recepciones.view",
    "recepciones.pedido.create",
    "recepciones.albaran.create",
    "recepciones.recibir",
    "recepciones.incidencia.manage",
    "recepciones.rectificar",
    "recepciones.proveedores.manage",
    "recepciones.correo.importar",
  ],
  admin: PERMISOS,
};

export function permisosDeRol(rol: string | null | undefined): readonly Permiso[] {
  if (!rol) return [];
  return POR_ROL[rol as RolRecepciones] ?? [];
}

export type AmbitoRecepciones = { rol: string | null; centroId: string | null };

/** Rol y centro del usuario en el módulo. Un superadmin es admin sin fila. */
export async function rolDeRecepciones(userId: string, esSuperadmin: boolean): Promise<AmbitoRecepciones> {
  if (esSuperadmin) return { rol: "admin", centroId: null };
  const { rows } = await pool.query<{ rol: string; centro_id: string | null }>(
    `SELECT rol, centro_id FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'recepciones'`,
    [userId]
  );
  return { rol: rows[0]?.rol ?? null, centroId: rows[0]?.centro_id ?? null };
}

declare module "express-serve-static-core" {
  interface Request {
    recepcionesRol?: string | null;
    recepcionesPermisos?: readonly Permiso[];
    recepcionesCentroId?: string | null;
  }
}

/** Carga rol, permisos y ámbito en la petición. Va después de `authenticate`. */
export const cargarPermisos: RequestHandler = async (req, res, next) => {
  const ctx = req.authCtx;
  if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const ambito = await rolDeRecepciones(ctx.userId, ctx.esSuperadmin);
    req.recepcionesRol = ambito.rol;
    req.recepcionesPermisos = permisosDeRol(ambito.rol);
    req.recepcionesCentroId = ambito.centroId;
    next();
  } catch (e) {
    console.error("[Recepciones] error cargando permisos:", e);
    res.status(500).json({ error: "Error comprobando permisos" });
  }
};

/** Exige un permiso concreto. */
export function exigirPermiso(permiso: Permiso): RequestHandler {
  return (req, res, next) => {
    if (!req.recepcionesPermisos?.includes(permiso)) {
      return res.status(403).json({
        error: "No tienes permiso para hacer esto en Recepciones.",
        code: "PERMISO_DENEGADO",
        permiso,
      });
    }
    next();
  };
}
