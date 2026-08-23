/**
 * Permisos del módulo Tacógrafos.
 *
 * No se inventa un sistema de usuarios nuevo: se apoya en `app_usuario_modulos`,
 * que guarda por usuario y módulo un `rol`. Aquí ese rol se traduce a permisos
 * finos, como en `server/cash/permissions.ts`. Una segunda tabla de permisos
 * sería un mecanismo paralelo que mantener.
 *
 * Sin caché, por el mismo motivo que en caja: retirarle a alguien el permiso de
 * emitir certificados debe surtir efecto en la siguiente petición, no en la de
 * dentro de un minuto. Cuesta una lectura por clave indexada.
 */

import type { RequestHandler } from "express";
import pool from "../db.ts";

export const PERMISOS = [
  "tacografos.view",
  "tacografos.expediente.create",
  "tacografos.expediente.edit",
  /**
   * Anular un expediente. Va aparte de editar: un expediente cuyo certificado
   * ya se entregó al cliente no se corrige, se anula y se emite otro. Es
   * documentación legal, no un borrador.
   */
  "tacografos.expediente.annul",
  /** Emitir un documento firmable a partir de un expediente completo. */
  "tacografos.documento.emit",
  /**
   * Anular un documento emitido. Va aparte de emitir: retirar el papel que ya
   * tiene el cliente es una decisión de responsable, no del día a día.
   */
  "tacografos.documento.annul",
  /** Recoger la firma de una persona en pantalla. */
  "tacografos.documento.sign",
  /** Dar por entregado el certificado al cliente. */
  "tacografos.entrega.register",
  /**
   * Anotar la destrucción de los archivos transferidos pasado el año.
   *
   * De responsable y no del día a día: la fecha que queda escrita es la prueba
   * de que se cumplió el plazo, y quien la firma es el responsable técnico.
   */
  "tacografos.custodia.destruir",
  /** Anotar la presentación del certificado ante la administración. */
  "tacografos.comunicacion.register",
  /** Datos del centro técnico: contraseña identificativa, dirección, enlaces. */
  "tacografos.config.edit",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export type RolTacografos = "admin" | "responsable" | "tecnico" | "consulta";

/**
 * Qué puede hacer cada rol.
 *
 * · consulta    — mirar expedientes.
 * · tecnico     — además crea y edita los suyos y emite los documentos: es
 *                 quien hace la intervención y quien se los da al cliente.
 * · responsable — además anula, que es la corrección de algo ya emitido.
 * · admin       — todo, incluida la configuración del centro.
 */
const POR_ROL: Record<RolTacografos, readonly Permiso[]> = {
  consulta: ["tacografos.view"],
  tecnico: [
    "tacografos.view",
    "tacografos.expediente.create",
    "tacografos.expediente.edit",
    "tacografos.documento.emit",
    "tacografos.documento.sign",
    "tacografos.entrega.register",
    "tacografos.comunicacion.register",
  ],
  responsable: [
    "tacografos.view",
    "tacografos.expediente.create",
    "tacografos.expediente.edit",
    "tacografos.expediente.annul",
    "tacografos.documento.emit",
    "tacografos.documento.sign",
    "tacografos.documento.annul",
    "tacografos.entrega.register",
    "tacografos.custodia.destruir",
    "tacografos.comunicacion.register",
  ],
  admin: PERMISOS,
};

export function permisosDeRol(rol: string | null | undefined): readonly Permiso[] {
  if (!rol) return [];
  return POR_ROL[rol as RolTacografos] ?? [];
}

/**
 * Rol del usuario en el módulo. Un superadmin es admin sin necesidad de fila,
 * el mismo criterio que aplica `requireModule` con las licencias.
 */
export async function rolDeTacografos(
  userId: string,
  esSuperadmin: boolean
): Promise<string | null> {
  if (esSuperadmin) return "admin";
  const { rows } = await pool.query<{ rol: string }>(
    `SELECT rol FROM app_usuario_modulos WHERE user_id = $1 AND modulo = 'tacografos'`,
    [userId]
  );
  return rows[0]?.rol ?? null;
}

declare module "express-serve-static-core" {
  interface Request {
    tacografosRol?: string | null;
    tacografosPermisos?: readonly Permiso[];
  }
}

/** Carga rol y permisos en la petición. Va después de `authenticate`. */
export const cargarPermisos: RequestHandler = async (req, res, next) => {
  const ctx = req.authCtx;
  if (!ctx) return res.status(401).json({ error: "Sesión requerida" });
  try {
    const rol = await rolDeTacografos(ctx.userId, ctx.esSuperadmin);
    req.tacografosRol = rol;
    req.tacografosPermisos = permisosDeRol(rol);
    next();
  } catch (e) {
    console.error("[Tacógrafos] error cargando permisos:", e);
    res.status(500).json({ error: "Error comprobando permisos" });
  }
};

/** Exige un permiso concreto. */
export function exigirPermiso(permiso: Permiso): RequestHandler {
  return (req, res, next) => {
    if (!req.tacografosPermisos?.includes(permiso)) {
      return res.status(403).json({
        error: "No tienes permiso para hacer esto en el módulo de Tacógrafos.",
        code: "PERMISO_DENEGADO",
        permiso,
      });
    }
    next();
  };
}
