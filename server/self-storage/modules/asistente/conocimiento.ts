/**
 * Base de conocimiento del asistente: CONOCIMIENTO ESTÁTICO (cómo funciona el
 * servicio, contratación online, calculadora, visitas, modelo low cost,
 * preguntas frecuentes). Nunca datos dinámicos: esos los da una herramienta.
 *
 * Por empresa y, opcionalmente, por centro (lo del centro gana al buscar).
 */

import type { z } from "zod";
import { enTx, pool } from "../../shared/db.ts";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { ordenarPorRelevancia, type EntradaConocimiento } from "../../domain/asistente.ts";
import { PAQUETE_TLC, rellenar } from "./paqueteTlc.ts";
import type { conocimientoAlta, conocimientoCambio } from "../../schemas.ts";

const COLUMNAS = `id, center_id AS "centerId", category, question, answer, language, active, priority, seed_key AS "seedKey", created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function listar(empresaId: string, f: { language?: string; category?: string; centerId?: string; q?: string }) {
  const vals: unknown[] = [empresaId];
  const cond = ["empresa_id = $1"];
  const add = (sql: string, v: unknown) => {
    vals.push(v);
    cond.push(sql.replace("?", `$${vals.length}`));
  };
  if (f.language) add("language = ?", f.language);
  if (f.category) add("category = ?", f.category);
  if (f.centerId) add("center_id = ?", f.centerId);
  if (f.q) {
    vals.push(f.q.replace(/[%_]/g, ""));
    cond.push(`(question ILIKE '%' || $${vals.length} || '%' OR answer ILIKE '%' || $${vals.length} || '%')`);
  }
  const { rows } = await pool.query(`SELECT ${COLUMNAS} FROM self_storage_ai_knowledge WHERE ${cond.join(" AND ")} ORDER BY category, priority DESC, question LIMIT 500`, vals);
  return rows;
}

/**
 * Lo más relevante para una consulta, en el idioma pedido (si en ese idioma no
 * hay nada, en castellano). Sólo activas, de la empresa y del centro o generales.
 */
export async function buscar(empresaId: string, centerId: string | null, idioma: string, consulta: string, limite = 8) {
  const { rows } = await pool.query(
    `SELECT id, center_id AS "centerId", category, question, answer, language, priority
       FROM self_storage_ai_knowledge
      WHERE empresa_id = $1 AND active AND (center_id IS NULL OR center_id = $2) AND language = ANY($3::text[])`,
    [empresaId, centerId, [idioma, "es"]]
  );
  const enIdioma = (rows as EntradaConocimiento[]).filter((r) => r.language === idioma);
  const base = enIdioma.length ? enIdioma : (rows as EntradaConocimiento[]);
  return ordenarPorRelevancia(base, consulta, limite);
}

export async function crear(actor: Actor, d: z.infer<typeof conocimientoAlta>) {
  return enTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO self_storage_ai_knowledge (empresa_id, center_id, category, question, answer, language, active, priority, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${COLUMNAS}`,
      [actor.empresaId, d.centerId ?? null, d.category, d.question, d.answer, d.language, d.active, d.priority, actor.userId || null]
    );
    await auditar(c, actor, { action: "ai_knowledge.created", entityType: "ai_knowledge", entityId: rows[0].id, after: { category: d.category, language: d.language, question: d.question } });
    return rows[0];
  });
}

export async function actualizar(actor: Actor, id: string, d: z.infer<typeof conocimientoCambio>) {
  return enTx(async (c) => {
    const { rows } = await c.query(`SELECT ${COLUMNAS} FROM self_storage_ai_knowledge WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [actor.empresaId, id]);
    if (!rows.length) throw noExiste("La entrada de conocimiento");
    const antes = rows[0];
    const despues = { ...antes, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) };
    const { rows: n } = await c.query(
      `UPDATE self_storage_ai_knowledge SET center_id = $3, category = $4, question = $5, answer = $6, language = $7, active = $8, priority = $9
        WHERE empresa_id = $1 AND id = $2 RETURNING ${COLUMNAS}`,
      [actor.empresaId, id, despues.centerId, despues.category, despues.question, despues.answer, despues.language, despues.active, despues.priority]
    );
    const dif = diferencias(antes, n[0]);
    if (dif) await auditar(c, actor, { action: "ai_knowledge.updated", entityType: "ai_knowledge", entityId: id, ...dif });
    return n[0];
  });
}

export async function borrar(actor: Actor, id: string) {
  await enTx(async (c) => {
    const { rows } = await c.query(`DELETE FROM self_storage_ai_knowledge WHERE empresa_id = $1 AND id = $2 RETURNING category, question, language`, [actor.empresaId, id]);
    if (!rows.length) throw noExiste("La entrada de conocimiento");
    await auditar(c, actor, { action: "ai_knowledge.deleted", entityType: "ai_knowledge", entityId: id, before: rows[0] });
  });
}

/**
 * Carga el conocimiento inicial (paquete TLC) en la empresa y, si se indica,
 * en un centro. IDEMPOTENTE: lo ya cargado (misma clave e idioma) no se toca
 * ni se duplica, aunque se haya editado. Marca y web, de la configuración.
 */
export async function cargarInicial(actor: Actor, d: { pack: "tlc"; centerId?: string | null }) {
  const enlaces = await leerAjuste(pool, actor.empresaId, d.centerId ?? null, "call_center.links");
  if (!enlaces.brandName || !enlaces.web) {
    throw new ErrorSelfStorage("FALTA_MARCA", "Configura antes el nombre comercial y la web (Call Center → Configuración): el conocimiento inicial los usa.", 422);
  }
  if (d.centerId) {
    const { rows } = await pool.query(`SELECT 1 FROM self_storage_centers WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, d.centerId]);
    if (!rows.length) throw noExiste("El centro");
  }
  const v = { marca: enlaces.brandName, web: enlaces.web, calculadora: enlaces.calculator ?? enlaces.web };
  return enTx(async (c) => {
    let nuevas = 0;
    for (const e of PAQUETE_TLC) {
      for (const idioma of ["es", "ca"] as const) {
        const t = e[idioma];
        const { rowCount } = await c.query(
          `INSERT INTO self_storage_ai_knowledge (empresa_id, center_id, category, question, answer, language, priority, seed_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (empresa_id, coalesce(center_id, '00000000-0000-0000-0000-000000000000'::uuid), seed_key, language) WHERE seed_key IS NOT NULL DO NOTHING`,
          [actor.empresaId, d.centerId ?? null, e.category, rellenar(t.q, v), rellenar(t.a, v), idioma, e.priority, `${d.pack}.${e.key}`, actor.userId || null]
        );
        nuevas += rowCount ?? 0;
      }
    }
    await auditar(c, actor, { action: "ai_knowledge.seeded", entityType: "ai_knowledge", entityId: null, after: { pack: d.pack, centerId: d.centerId ?? null, nuevas } });
    return { pack: d.pack, nuevas, total: PAQUETE_TLC.length * 2, yaExistian: PAQUETE_TLC.length * 2 - nuevas };
  });
}
