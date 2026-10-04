/**
 * Catálogo de motivos y resultados de llamada, por empresa.
 *
 * Los de partida (`domain/callcenter.ts`) se crean la primera vez que la
 * empresa usa el Call Center, con `ON CONFLICT DO NOTHING`: no se duplican ni
 * pisan lo que la empresa haya renombrado. Los suyos (`is_system`) no cambian
 * de código —lo usan los informes y las reglas de estado—, pero sí de
 * etiqueta, orden y si están activos. La empresa puede añadir más.
 */

import type { z } from "zod";
import { enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { MOTIVOS_INICIALES, RESULTADOS_INICIALES } from "../../domain/callcenter.ts";
import type { catalogoAlta, catalogoCambio } from "../../schemas.ts";
import type { Priority } from "../../../../src/modules/self-storage/types/enums.ts";

export type EntradaCatalogoFila = {
  id: string;
  kind: "reason" | "result";
  code: string;
  label: string;
  active: boolean;
  sortOrder: number;
  defaultPriority: Priority | null;
  isSystem: boolean;
};

const COLUMNAS = `id, kind, code, label, active, sort_order AS "sortOrder", default_priority AS "defaultPriority", is_system AS "isSystem"`;

/** Empresas cuyo catálogo ya se ha comprobado en este proceso (no hace falta repetir el INSERT). */
const asegurados = new Set<string>();

export async function asegurarCatalogo(empresaId: string, c: Ejecutor = pool): Promise<void> {
  if (asegurados.has(empresaId)) return;
  const filas = [
    ...MOTIVOS_INICIALES.map((m, i) => ["reason", m.code, m.label, (i + 1) * 10, m.defaultPriority ?? null]),
    ...RESULTADOS_INICIALES.map((r, i) => ["result", r.code, r.label, (i + 1) * 10, null]),
  ];
  const vals: unknown[] = [empresaId];
  const tuplas = filas.map((f) => {
    vals.push(...f);
    const n = vals.length;
    return `($1, $${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}::int, $${n}, true)`;
  });
  await c.query(
    `INSERT INTO self_storage_call_catalog (empresa_id, kind, code, label, sort_order, default_priority, is_system)
     VALUES ${tuplas.join(", ")}
     ON CONFLICT (empresa_id, kind, code) DO NOTHING`,
    vals
  );
  // Dentro de una transacción no se apunta: si hace ROLLBACK, el INSERT no quedó.
  if (c === pool) asegurados.add(empresaId);
}

/** Para pruebas: vuelve a comprobar el catálogo de todas las empresas. */
export function olvidarCatalogos(): void {
  asegurados.clear();
}

export async function catalogo(empresaId: string): Promise<EntradaCatalogoFila[]> {
  await asegurarCatalogo(empresaId);
  const { rows } = await pool.query(`SELECT ${COLUMNAS} FROM self_storage_call_catalog WHERE empresa_id = $1 ORDER BY kind, sort_order, label`, [empresaId]);
  return rows;
}

/** Una entrada ACTIVA del catálogo (o error claro). */
export async function entradaActiva(c: Ejecutor, empresaId: string, kind: "reason" | "result", code: string): Promise<EntradaCatalogoFila> {
  await asegurarCatalogo(empresaId, c);
  const { rows } = await c.query(`SELECT ${COLUMNAS} FROM self_storage_call_catalog WHERE empresa_id = $1 AND kind = $2 AND code = $3`, [empresaId, kind, code]);
  if (!rows.length || !rows[0].active) {
    throw new ErrorSelfStorage(kind === "reason" ? "MOTIVO_NO_VALIDO" : "RESULTADO_NO_VALIDO", `${kind === "reason" ? "El motivo" : "El resultado"} «${code}» no existe o está desactivado.`, 422);
  }
  return rows[0];
}

export async function crearEntrada(actor: Actor, d: z.infer<typeof catalogoAlta>) {
  return enTx(async (c) => {
    await asegurarCatalogo(actor.empresaId, c);
    const { rows } = await c.query(
      `INSERT INTO self_storage_call_catalog (empresa_id, kind, code, label, default_priority, sort_order)
       VALUES ($1,$2,$3,$4,$5,coalesce($6, (SELECT coalesce(max(sort_order),0) + 10 FROM self_storage_call_catalog WHERE empresa_id = $1 AND kind = $2)))
       RETURNING ${COLUMNAS}`,
      [actor.empresaId, d.kind, d.code, d.label, d.kind === "reason" ? (d.defaultPriority ?? null) : null, d.sortOrder ?? null]
    );
    await auditar(c, actor, { action: "call_catalog.created", entityType: "call_catalog", entityId: rows[0].id, after: d });
    return rows[0] as EntradaCatalogoFila;
  });
}

export async function actualizarEntrada(actor: Actor, id: string, d: z.infer<typeof catalogoCambio>) {
  return enTx(async (c) => {
    const { rows } = await c.query(`SELECT ${COLUMNAS} FROM self_storage_call_catalog WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [actor.empresaId, id]);
    if (!rows.length) throw noExiste("La entrada del catálogo");
    const antes = rows[0] as EntradaCatalogoFila;
    const { rows: n } = await c.query(
      `UPDATE self_storage_call_catalog
          SET label = coalesce($3, label), active = coalesce($4, active), sort_order = coalesce($5, sort_order),
              default_priority = CASE WHEN $6::boolean THEN $7 ELSE default_priority END
        WHERE empresa_id = $1 AND id = $2 RETURNING ${COLUMNAS}`,
      [actor.empresaId, id, d.label ?? null, d.active ?? null, d.sortOrder ?? null, d.defaultPriority !== undefined && antes.kind === "reason", d.defaultPriority ?? null]
    );
    const dif = diferencias(antes as unknown as Record<string, unknown>, n[0]);
    if (dif) await auditar(c, actor, { action: "call_catalog.updated", entityType: "call_catalog", entityId: id, ...dif });
    return n[0] as EntradaCatalogoFila;
  });
}
