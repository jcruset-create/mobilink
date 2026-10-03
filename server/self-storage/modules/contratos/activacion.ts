/**
 * Activar un contrato: el paso que convierte una firma en un alquiler.
 *
 * Lo llaman tres caminos y los tres pasan por aquí:
 *   · el primer cobro confirmado (webhook de Stripe o pago manual registrado);
 *   · el primer SEPA en `processing` cuando la política del contrato es
 *     `allow_while_processing`;
 *   · una activación administrativa (excepción a la política), con motivo.
 *
 * Efectos, en la misma transacción: contrato `active`, trastero `occupied`,
 * cliente `active`, siguiente periodo por facturar (cobro manual), auditoría.
 */

import type { Ejecutor } from "../../shared/db.ts";
import { auditar, type Actor } from "../../shared/audit.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { transicion } from "../../domain/contractState.ts";
import { validarCambioEstado } from "../../domain/unitStatus.ts";
import { periodoDesde, sumarDias } from "../../domain/facturacion.ts";

export type MotivoActivacion = { tipo: "pago" } | { tipo: "sepa_en_proceso" } | { tipo: "excepcion"; motivo: string };

export async function activarContrato(c: Ejecutor, actor: Actor, contractId: string, por: MotivoActivacion): Promise<boolean> {
  const { rows } = await c.query(
    `SELECT k.id, k.empresa_id, k.status, k.customer_id, k.storage_unit_id, k.collection_method, k.billing_day,
            to_char(k.start_date,'YYYY-MM-DD') AS start_date, to_char(k.next_invoice_date,'YYYY-MM-DD') AS next_invoice_date,
            u.status AS unit_status
       FROM self_storage_contracts k JOIN self_storage_units u ON u.id = k.storage_unit_id
      WHERE k.id = $1 FOR UPDATE OF k, u`,
    [contractId]
  );
  const k = rows[0];
  if (!k) throw noExiste("El contrato");
  if (k.status === "active") return false; // ya lo estaba: idempotente
  transicion(k.status, "activate");

  if (k.unit_status !== "occupied") {
    // reserved → occupied es una transición del SISTEMA.
    validarCambioEstado(k.unit_status, "occupied", { origen: "sistema", tieneContratoVivo: true, tieneReservaActiva: false });
    await c.query(`UPDATE self_storage_units SET status = 'occupied', status_reason = NULL WHERE id = $1`, [k.storage_unit_id]);
  }

  let siguiente = k.next_invoice_date;
  if (k.collection_method === "manual" && !siguiente) siguiente = sumarDias(periodoDesde(k.start_date, k.billing_day).end, 1);

  await c.query(
    `UPDATE self_storage_contracts
        SET status = 'active', activated_at = now(), next_invoice_date = $2,
            activation_override_at = CASE WHEN $3::text IS NOT NULL THEN now() ELSE activation_override_at END,
            activation_override_by = CASE WHEN $3::text IS NOT NULL THEN $4::uuid ELSE activation_override_by END,
            activation_override_reason = COALESCE($3, activation_override_reason)
      WHERE id = $1`,
    [contractId, siguiente, por.tipo === "excepcion" ? por.motivo : null, por.tipo === "excepcion" ? actor.userId || null : null]
  );
  await c.query(`UPDATE self_storage_customers SET status = 'active' WHERE id = $1 AND status = 'inactive'`, [k.customer_id]);
  await auditar(c, actor, {
    action: por.tipo === "excepcion" ? "contract.activated_by_override" : "contract.activated",
    entityType: "contract",
    entityId: contractId,
    before: { status: k.status },
    after: { status: "active", by: por.tipo, reason: por.tipo === "excepcion" ? por.motivo : null },
  });
  return true;
}

export function exigirMotivo(motivo: string | null | undefined): string {
  const m = (motivo ?? "").trim();
  if (!m) throw new ErrorSelfStorage("MOTIVO_OBLIGATORIO", "Indica el motivo.", 422);
  return m.slice(0, 500);
}
