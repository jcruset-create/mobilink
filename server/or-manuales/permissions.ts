/**
 * Permisos del módulo OR Manuales.
 *
 * No se estrena un sistema de usuarios: se apoya en `app_usuario_modulos`, que
 * guarda por usuario y módulo un `rol`, y aquí ese rol se traduce a permisos
 * finos. Misma forma que `server/recepciones/permissions.ts`.
 *
 * Sin caché, por el mismo motivo que en caja y en recepciones: quitarle a
 * alguien el permiso de cerrar blocs tiene que surtir efecto en la siguiente
 * petición, no cuando caduque un minuto.
 *
 * Los tres roles del encargo, con su nombre de aquí:
 *
 *   ADMINISTRADOR     → `admin`     control total, incluida la configuración.
 *   RESPONSABLE TALLER→ `gestor`    crear, entregar, devolver, procesar,
 *                                   revisar y cerrar.
 *   CONSULTA          → `consulta`  buscar, ver y abrir documentos.
 *
 * Y uno más que no pedía el encargo pero que el taller necesita: `operario`,
 * que escanea y revisa lo que escanea pero no crea blocs ni los cierra. Es
 * quien está delante del escáner, y darle «control total» para que pueda subir
 * un PDF sería pasarse.
 */

import type { RequestHandler } from "express";
import pool from "../db.ts";

export const PERMISOS = [
  /** Ver blocs, OR, documentos, avisos e histórico. */
  "or-manuales.view",
  /** Crear blocs (y con ellos sus 25 OR) y editar sus datos. */
  "or-manuales.bloc.create",
  /** Entregar un bloc y registrar su devolución. */
  "or-manuales.bloc.entregar",
  /** Cerrar un bloc completo. */
  "or-manuales.bloc.cerrar",
  /**
   * Borrar un bloc entero: el alta equivocada, el taco de prueba. Va aparte de
   * `bloc.create` porque es la única operación que quita papel del archivo.
   */
  "or-manuales.bloc.eliminar",
  /** Subir escaneos y lanzar el procesamiento. */
  "or-manuales.documento.subir",
  /** Asignar a mano una OR, confirmar una revisión, sustituir o eliminar. */
  "or-manuales.documento.gestionar",
  /** Crear y resolver avisos al responsable. */
  "or-manuales.aviso.gestionar",
  /** La zona de OCR, los umbrales de confianza y demás. */
  "or-manuales.config.manage",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export type RolOrManuales = "consulta" | "operario" | "gestor" | "admin";

const POR_ROL: Record<RolOrManuales, readonly Permiso[]> = {
  consulta: ["or-manuales.view"],
  operario: ["or-manuales.view", "or-manuales.documento.subir", "or-manuales.documento.gestionar"],
  gestor: [
    "or-manuales.view",
    "or-manuales.bloc.create",
    "or-manuales.bloc.entregar",
    "or-manuales.bloc.cerrar",
    "or-manuales.bloc.eliminar",
    "or-manuales.documento.subir",
    "or-manuales.documento.gestionar",
    "or-manuales.aviso.gestionar",
  ],
  admin: PERMISOS,
};

export function permisosDeRol(rol: string | null | undefined): readonly Permiso[] {
  if (!rol) return [];
  return POR_ROL[rol as RolOrManuales] ?? [];
}

export type AmbitoOrManuales = { rol: string | null };

/** Rol del usuario en el módulo. Un superadmin es admin sin fila. */
export async function rolDeOrManuales(userId: string, esSuperadmin: boolean): Promise<AmbitoOrManuales> {
  if (esSuperadmin) return { rol: "admin" };
  const { rows } = await pool.query<{ rol: string }>(
    `SELECT rol FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'or-manuales'`,
    [userId]
  );
  return { rol: rows[0]?.rol ?? null };
}

declare module "express-serve-static-core" {
  interface Request {
    orManualesRol?: string | null;
    orManualesPermisos?: readonly Permiso[];
  }
}

/** Carga rol y permisos en la petición. Va después de `authenticate`. */
export const cargarPermisos: RequestHandler = async (req, res, next) => {
  const ctx = req.authCtx;
  if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const ambito = await rolDeOrManuales(ctx.userId, ctx.esSuperadmin);
    req.orManualesRol = ambito.rol;
    req.orManualesPermisos = permisosDeRol(ambito.rol);
    next();
  } catch (e) {
    console.error("[OR Manuales] error cargando permisos:", e);
    res.status(500).json({ error: "Error comprobando permisos" });
  }
};

/** Exige un permiso concreto. */
export function exigirPermiso(permiso: Permiso): RequestHandler {
  return (req, res, next) => {
    if (!req.orManualesPermisos?.includes(permiso)) {
      return res.status(403).json({
        error: "No tienes permiso para hacer esto en OR Manuales.",
        code: "PERMISO_DENEGADO",
        permiso,
      });
    }
    next();
  };
}
