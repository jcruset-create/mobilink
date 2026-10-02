/**
 * Plano del centro: subir una versión nueva y leer el vigente con el estado
 * REAL de cada trastero (el color sale de `self_storage_units.status`, no de
 * lo que el SVG traiga pintado).
 */

import { createHash } from "node:crypto";
import { auditar, type Actor } from "../../shared/audit.ts";
import { enTx, pool } from "../../shared/db.ts";
import { noExiste } from "../../errors.ts";
import { sanearSvg } from "../../domain/floorPlan.ts";
import { vistaTrasteroPanel } from "../../domain/vistas.ts";
import * as repoCentros from "../centros/repository.ts";
import * as repoTrasteros from "../trasteros/repository.ts";

export async function obtenerPlano(actor: Actor, centerId: string, verClientes: boolean) {
  const centro = await repoCentros.obtenerCentro(pool, actor.empresaId, centerId);
  if (!centro) throw noExiste("El centro");
  const { rows } = await pool.query(
    `SELECT id, version, name, svg, shape_ids AS "shapeIds", created_at AS "createdAt"
       FROM self_storage_floor_plans WHERE empresa_id = $1 AND center_id = $2
      ORDER BY version DESC LIMIT 1`,
    [actor.empresaId, centerId]
  );
  const plano = rows[0] ?? null;
  const filas = await repoTrasteros.listarTrasteros(pool, actor.empresaId, { centerId });
  const ocupadas = verClientes ? await repoTrasteros.ocupaciones(pool, actor.empresaId, filas.map((f) => f.id)) : new Map();
  const trasteros = filas.map((f) => vistaTrasteroPanel(f, ocupadas.get(f.id) ?? null, verClientes));

  const formas = new Set<string>(plano?.shapeIds ?? []);
  const vinculadas = new Set(trasteros.map((t) => t.floorPlanShapeId).filter((s): s is string => !!s));
  return {
    center: { id: centro.id, code: centro.code, name: centro.name },
    plan: plano,
    units: trasteros,
    /** Formas del plano que no tienen trastero (para vincularlas). */
    unlinkedShapes: [...formas].filter((s) => !vinculadas.has(s)),
    /** Trasteros que apuntan a una forma que el plano vigente ya no tiene. */
    orphanUnits: trasteros.filter((t) => t.floorPlanShapeId && !formas.has(t.floorPlanShapeId)).map((t) => ({ id: t.id, code: t.code, shapeId: t.floorPlanShapeId })),
  };
}

export function subirPlano(actor: Actor, centerId: string, d: { name?: string | null; svg: string }) {
  const saneado = sanearSvg(d.svg);
  return enTx(async (c) => {
    // El centro bloqueado serializa dos subidas a la vez: la versión no se repite.
    const centro = await repoCentros.obtenerCentro(c, actor.empresaId, centerId, true);
    if (!centro) throw noExiste("El centro");
    const { rows } = await c.query(`SELECT coalesce(max(version), 0) + 1 AS v FROM self_storage_floor_plans WHERE center_id = $1`, [centerId]);
    const version = Number(rows[0].v);
    const sha = createHash("sha256").update(saneado.svg).digest("hex");
    const ins = await c.query(
      `INSERT INTO self_storage_floor_plans (empresa_id, center_id, version, name, svg, shape_ids, sha256, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [actor.empresaId, centerId, version, d.name || "Planta", saneado.svg, saneado.shapeIds, sha, actor.userId || null]
    );
    await auditar(c, actor, {
      action: "floor_plan.uploaded",
      entityType: "floor_plan",
      entityId: ins.rows[0].id,
      after: { centerId, version, shapes: saneado.shapeIds.length, removed: saneado.eliminados, sha256: sha },
    });
    return {
      id: ins.rows[0].id as string,
      version,
      shapeIds: saneado.shapeIds,
      removed: saneado.eliminados,
      warnings: saneado.avisos,
    };
  });
}
