/**
 * Bloqueos de acceso por motivo (`self_storage_access_blocks`).
 *
 * En la fase 2 no hay puertas: un bloqueo es un HECHO registrado que la fase 3
 * convertirá en «no abre». Lo que sí hace ya: decidir si un contrato suspendido
 * puede volver a `active` (sólo si no le queda NINGÚN bloqueo).
 */

import type { Ejecutor } from "../../shared/db.ts";
import { auditar, type Actor } from "../../shared/audit.ts";
import { quedanBloqueos, type Bloqueo } from "../../domain/bloqueos.ts";
import type { BlockReason } from "../../../../src/modules/self-storage/types/enums.ts";

export async function bloqueosDelContrato(c: Ejecutor, contractId: string): Promise<Bloqueo[]> {
  const { rows } = await c.query(
    `SELECT id, reason, lifted_at AS "liftedAt" FROM self_storage_access_blocks WHERE contract_id = $1 AND lifted_at IS NULL`,
    [contractId]
  );
  return rows;
}

/** Crea el bloqueo si no hay ya uno abierto con el mismo motivo (reentrante). */
export async function bloquear(
  c: Ejecutor,
  actor: Actor,
  d: { empresaId: string; customerId: string; contractId: string | null; reason: BlockReason; source: "system" | "staff"; notes?: string | null; dunningCaseId?: string | null }
): Promise<string | null> {
  const { rows } = await c.query(
    `INSERT INTO self_storage_access_blocks (empresa_id, customer_id, contract_id, reason, source, notes, dunning_case_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (customer_id, COALESCE(contract_id, '00000000-0000-0000-0000-000000000000'::uuid), reason) WHERE lifted_at IS NULL
     DO NOTHING RETURNING id`,
    [d.empresaId, d.customerId, d.contractId, d.reason, d.source, d.notes ?? null, d.dunningCaseId ?? null, actor.userId || null]
  );
  if (rows.length) {
    await auditar(c, actor, { action: "access_block.created", entityType: "contract", entityId: d.contractId, after: { blockId: rows[0].id, reason: d.reason, notes: d.notes ?? null } });
  }
  return rows[0]?.id ?? null;
}

export async function levantar(c: Ejecutor, actor: Actor, blockId: string, motivo: string): Promise<boolean> {
  const { rows } = await c.query(
    `UPDATE self_storage_access_blocks SET lifted_at = now(), lifted_by = $2, lift_reason = $3
      WHERE id = $1 AND lifted_at IS NULL RETURNING contract_id, reason`,
    [blockId, actor.userId || null, motivo]
  );
  if (rows.length) {
    await auditar(c, actor, { action: "access_block.lifted", entityType: "contract", entityId: rows[0].contract_id, after: { blockId, reason: rows[0].reason, liftReason: motivo } });
  }
  return rows.length > 0;
}

/**
 * Si el contrato está suspendido y ya no tiene bloqueos, vuelve a `active`.
 * Devuelve el estado resultante.
 */
export async function reactivarSiProcede(c: Ejecutor, actor: Actor, contractId: string): Promise<string> {
  const { rows } = await c.query(`SELECT status FROM self_storage_contracts WHERE id = $1 FOR UPDATE`, [contractId]);
  const estado = rows[0]?.status;
  if (estado !== "suspended") return estado;
  if (quedanBloqueos(await bloqueosDelContrato(c, contractId)).length) return estado;
  await c.query(`UPDATE self_storage_contracts SET status = 'active', suspended_at = NULL WHERE id = $1`, [contractId]);
  await auditar(c, actor, { action: "contract.reactivated", entityType: "contract", entityId: contractId, before: { status: "suspended" }, after: { status: "active" } });
  return "active";
}

/** Suspende un contrato activo (lo llama el impago o una persona con motivo). */
export async function suspenderSiActivo(c: Ejecutor, actor: Actor, contractId: string, motivo: BlockReason): Promise<boolean> {
  const { rows } = await c.query(`UPDATE self_storage_contracts SET status = 'suspended', suspended_at = now() WHERE id = $1 AND status = 'active' RETURNING id`, [contractId]);
  if (rows.length) {
    await auditar(c, actor, { action: "contract.suspended", entityType: "contract", entityId: contractId, before: { status: "active" }, after: { status: "suspended", reason: motivo } });
  }
  return rows.length > 0;
}
