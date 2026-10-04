/**
 * Empresa activa del superadministrador en Self Storage.
 *
 * Un empleado trabaja SIEMPRE en la empresa de su ficha (`app_usuarios`): para
 * él no cambia nada y la cabecera se ignora. El superadministrador de Mobilink
 * no pertenece a la empresa cliente, así que puede elegir con cuál trabajar
 * mandando `X-SS-Empresa: <uuid>`:
 *
 *   · sólo cuenta si `esSuperadmin` (lo decide la sesión, no la cabecera);
 *   · sólo empresas activas con la licencia de Self Storage vigente;
 *   · una empresa que no cumple → 404 (como todo lo ajeno), nunca se cae en
 *     silencio a la suya: así no se escribe en la empresa equivocada.
 *
 * Se sustituye `req.authCtx` por una COPIA (el contexto original está en una
 * caché compartida entre peticiones). La identidad sigue siendo la suya, así
 * que la auditoría dice quién fue y en qué empresa.
 */

import type { RequestHandler } from "express";
import { esUuid } from "../http.ts";
import { MODULO } from "./permissions.ts";

export const CABECERA_EMPRESA = "x-ss-empresa";

type Db = { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Activa o en prueba (una suspendida no). Por JSON: tolera instalaciones sin la columna. */
const ESTADO_OK = `coalesce(to_jsonb(e)->>'estado', 'activa') IN ('activa','prueba')`;

export type EmpresaSelfStorage = { id: string; nombre: string };

/** Empresas en las que el superadmin puede trabajar: activas y con licencia vigente. */
export async function empresasConSelfStorage(db: Db): Promise<EmpresaSelfStorage[]> {
  const { rows } = await sinCatalogo(db.query(
    `SELECT e.id, e.nombre FROM app_empresas e
      WHERE ${ESTADO_OK} AND app_licencia_activa(e.id, $1)
      ORDER BY e.nombre`,
    [MODULO]
  ));
  return rows.map((r) => ({ id: String(r.id), nombre: String(r.nombre) }));
}

/** Nombre de la empresa (o null si la instalación no tiene el catálogo de empresas). */
export async function nombreEmpresa(db: Db, empresaId: string): Promise<string | null> {
  const { rows } = await sinCatalogo(db.query(`SELECT nombre FROM app_empresas WHERE id = $1`, [empresaId]));
  return rows[0] ? String(rows[0].nombre) : null;
}

/**
 * Sin la tabla de empresas o la función de licencias (bases de prueba que no
 * montan la plataforma entera) no hay entre qué elegir: lista vacía.
 */
async function sinCatalogo(p: Promise<{ rows: Record<string, unknown>[] }>): Promise<{ rows: Record<string, unknown>[] }> {
  try {
    return await p;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42P01" || code === "42883") return { rows: [] };
    throw e;
  }
}

export function empresaActiva(db: Db): RequestHandler {
  return async (req, res, next) => {
    try {
      const ctx = req.authCtx;
      const pedida = req.get(CABECERA_EMPRESA);
      if (!ctx || !ctx.esSuperadmin || !pedida || pedida === ctx.empresaId) return next();
      if (!esUuid(pedida)) return res.status(404).json({ error: "La empresa no existe.", code: "NO_EXISTE" });
      const { rows } = await sinCatalogo(
        db.query(`SELECT 1 FROM app_empresas e WHERE e.id = $1 AND ${ESTADO_OK} AND app_licencia_activa(e.id, $2)`, [pedida, MODULO])
      );
      if (!rows.length) return res.status(404).json({ error: "La empresa no existe o no tiene Self Storage.", code: "NO_EXISTE" });
      req.authCtx = { ...ctx, empresaId: pedida };
      next();
    } catch (e) {
      console.error("[Self Storage] empresa activa:", e);
      res.status(500).json({ error: "Error interno del módulo Self Storage" });
    }
  };
}
