/**
 * Auditoría del módulo (`self_storage_audit_logs`, sólo inserción).
 *
 * Se escribe en la MISMA transacción que el cambio: un cambio de precio sin
 * su rastro, o un rastro de un cambio que luego hizo ROLLBACK, son dos formas
 * de mentir. Por eso recibe el cliente de la transacción y lanza si falla.
 */

import type { Ejecutor } from "./db.ts";

export type Actor = {
  empresaId: string;
  userId: string;
  nombre: string;
  ip?: string | null;
  /** Quién es: un empleado (por defecto si hay userId), un cliente del portal, el sistema o Stripe. */
  tipo?: "staff" | "customer" | "system" | "stripe";
  /** Lo hace el Asistente IA (en la auditoría figura como «system» con su nombre). */
  esIA?: boolean;
};

export type EntradaAuditoria = {
  action: string;
  entityType: string;
  entityId: string | null;
  before?: unknown;
  after?: unknown;
};

export async function auditar(c: Ejecutor, actor: Actor, e: EntradaAuditoria): Promise<void> {
  await c.query(
    `INSERT INTO self_storage_audit_logs
       (empresa_id, actor_type, actor_id, actor_name, action, entity_type, entity_id, before, after, ip)
     VALUES ($1, $10, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor.empresaId,
      actor.userId || null,
      actor.nombre || null,
      e.action,
      e.entityType,
      e.entityId,
      e.before === undefined ? null : JSON.stringify(e.before),
      e.after === undefined ? null : JSON.stringify(e.after),
      actor.ip ?? null,
      actor.tipo ?? (actor.userId ? "staff" : "system"),
    ]
  );
}

/** Sólo los campos que cambian, para no llenar la auditoría de ruido. */
export function diferencias<T extends Record<string, unknown>>(antes: T, despues: Partial<T>): { before: Partial<T>; after: Partial<T> } | null {
  const before: Partial<T> = {};
  const after: Partial<T> = {};
  for (const k of Object.keys(despues) as (keyof T)[]) {
    const a = antes[k];
    const b = despues[k];
    const igual = typeof a === "number" || typeof b === "number" ? Number(a) === Number(b) : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (!igual) {
      before[k] = a;
      after[k] = b as T[keyof T];
    }
  }
  return Object.keys(after).length ? { before, after } : null;
}
