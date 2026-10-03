/**
 * Impagos: casos, avisos y suspensión, con plazos configurables.
 *
 *   factura que falla (Stripe) o vence sin cobrar (manual) → `overdue` + caso
 *   el motor pasa → primer aviso, segundo aviso, suspensión (bloqueo `payment`)
 *   se cobra → caso resuelto → se levanta SÓLO el bloqueo `payment` → el
 *              contrato vuelve a `active` si no le queda otro bloqueo
 *
 * Una mensualidad SEPA en `processing` NO abre caso: no ha fallado nada. Las
 * facturas que cobra Stripe sólo pasan a vencidas por un fallo que comunica
 * Stripe, nunca por la fecha.
 */

import { auditar, type Actor } from "../../shared/audit.ts";
import { enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { hoyMadrid } from "../../shared/numeracion.ts";
import { accionesPendientes, validarPolitica } from "../../domain/impagos.ts";
import { levantablesPorPago } from "../../domain/bloqueos.ts";
import { encolar } from "../notificaciones/service.ts";
import { bloquear, bloqueosDelContrato, levantar, reactivarSiProcede, suspenderSiActivo } from "./bloqueos.ts";

const eur = (v: number) => `${Number(v).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

async function datosAviso(c: Ejecutor, invoiceId: string) {
  const { rows } = await c.query(
    `SELECT i.invoice_number, i.total, i.customer_id, i.contract_id, i.empresa_id, i.customer_name, cu.email, k.contract_number
       FROM self_storage_invoices i
       JOIN self_storage_customers cu ON cu.id = i.customer_id
       LEFT JOIN self_storage_contracts k ON k.id = i.contract_id
      WHERE i.id = $1`,
    [invoiceId]
  );
  return rows[0];
}

/** Factura impagada: `overdue` y caso abierto (si no lo había). Idempotente. */
export async function abrirImpago(c: Ejecutor, actor: Actor, invoiceId: string, motivo: string | null): Promise<string | null> {
  const d = await datosAviso(c, invoiceId);
  await c.query(`UPDATE self_storage_invoices SET status = 'overdue' WHERE id = $1 AND status = 'pending'`, [invoiceId]);
  const { rows } = await c.query(
    `INSERT INTO self_storage_dunning_cases (empresa_id, customer_id, contract_id, invoice_id, failure_reason)
     SELECT $1, $2, $3, $4, $5
      WHERE NOT EXISTS (SELECT 1 FROM self_storage_dunning_cases WHERE invoice_id = $4 AND status = 'open')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [d.empresa_id, d.customer_id, d.contract_id, invoiceId, motivo]
  );
  if (!rows.length) return null;
  await auditar(c, actor, { action: "dunning.opened", entityType: "invoice", entityId: invoiceId, after: { caseId: rows[0].id, reason: motivo } });
  await encolar(c, {
    empresaId: d.empresa_id,
    plantilla: "payment.failed",
    dedupeKey: rows[0].id,
    destinatario: d.email,
    customerId: d.customer_id,
    contractId: d.contract_id,
    invoiceId,
    datos: { cliente: d.customer_name, factura: d.invoice_number, importe: eur(d.total), motivo: motivo ?? undefined },
  });
  return rows[0].id;
}

/**
 * La factura se ha cobrado (o anulado): se cierran sus casos y, si el contrato
 * ya no debe nada más, se levantan SÓLO sus bloqueos de impago. Nunca toca
 * `security`, `incident` ni `manual`.
 */
export async function resolverImpagoDeFactura(c: Ejecutor, actor: Actor, invoiceId: string, resolucion: "paid" | "cancelled"): Promise<void> {
  const { rows } = await c.query(
    `UPDATE self_storage_dunning_cases SET status = $2, resolved_at = now(), resolution = $3
      WHERE invoice_id = $1 AND status = 'open' RETURNING id, contract_id`,
    [invoiceId, resolucion === "paid" ? "resolved" : "cancelled", resolucion]
  );
  for (const caso of rows) {
    await auditar(c, actor, { action: "dunning.resolved", entityType: "invoice", entityId: invoiceId, after: { caseId: caso.id, resolution: resolucion } });
  }
  const contratos = new Set<string>(rows.map((r) => r.contract_id).filter(Boolean));
  if (!rows.length) {
    const { rows: f } = await c.query(`SELECT contract_id FROM self_storage_invoices WHERE id = $1`, [invoiceId]);
    if (f[0]?.contract_id) contratos.add(f[0].contract_id);
  }
  for (const contractId of contratos) {
    const { rows: abiertos } = await c.query(`SELECT 1 FROM self_storage_dunning_cases WHERE contract_id = $1 AND status = 'open' LIMIT 1`, [contractId]);
    if (abiertos.length) continue; // aún debe otra factura: el bloqueo de impago sigue
    for (const b of levantablesPorPago(await bloqueosDelContrato(c, contractId))) {
      await levantar(c, actor, b.id, resolucion === "paid" ? "Deuda cobrada" : "Factura anulada");
    }
    await reactivarSiProcede(c, actor, contractId);
  }
}

/** Trabajo: facturas de cobro MANUAL vencidas sin cobrar → impago. */
export async function marcarVencidas(hoy = hoyMadrid()): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id, empresa_id FROM self_storage_invoices
      WHERE status = 'pending' AND collection_method = 'manual' AND due_date IS NOT NULL AND due_date < $1 AND kind <> 'rectifying'`,
    [hoy]
  );
  let n = 0;
  for (const f of rows) {
    await enTx(async (c) => {
      const { rows: r } = await c.query(`SELECT status FROM self_storage_invoices WHERE id = $1 FOR UPDATE`, [f.id]);
      if (r[0]?.status !== "pending") return;
      if (await abrirImpago(c, sistemaDe(f.empresa_id), f.id, "Vencida sin cobrar")) n++;
    });
  }
  return n;
}

const sistemaDe = (empresaId: string): Actor => ({ empresaId, userId: "", nombre: "Sistema", ip: null });

/** Trabajo: avanza los casos abiertos según los plazos configurados. */
export async function ejecutarImpagos(ahora = new Date()): Promise<{ avisos: number; suspensiones: number }> {
  const r = { avisos: 0, suspensiones: 0 };
  const { rows } = await pool.query(`SELECT id, empresa_id FROM self_storage_dunning_cases WHERE status = 'open'`);
  for (const caso of rows) {
    await enTx(async (c) => {
      const { rows: cs } = await c.query(
        `SELECT d.*, k.center_id FROM self_storage_dunning_cases d LEFT JOIN self_storage_contracts k ON k.id = d.contract_id
          WHERE d.id = $1 FOR UPDATE OF d`,
        [caso.id]
      );
      const d = cs[0];
      if (!d || d.status !== "open") return;
      const politica = validarPolitica(await leerAjuste(c, d.empresa_id, d.center_id ?? null, "dunning.policy"));
      const acciones = accionesPendientes(
        { openedAt: new Date(d.opened_at), firstNoticeAt: d.first_notice_at, secondNoticeAt: d.second_notice_at, suspendedAt: d.suspended_at },
        ahora,
        politica
      );
      if (!acciones.length) return;
      const aviso = await datosAviso(c, d.invoice_id);
      const actor = sistemaDe(d.empresa_id);
      const comun = { empresaId: d.empresa_id, destinatario: aviso.email, customerId: d.customer_id, contractId: d.contract_id, invoiceId: d.invoice_id };
      const datos = { cliente: aviso.customer_name, factura: aviso.invoice_number, importe: eur(aviso.total), contrato: aviso.contract_number };
      for (const a of acciones) {
        if (a === "first_notice") {
          await encolar(c, { ...comun, plantilla: "dunning.first_notice", dedupeKey: d.id, datos });
          await c.query(`UPDATE self_storage_dunning_cases SET first_notice_at = $2 WHERE id = $1`, [d.id, ahora]);
          r.avisos++;
        } else if (a === "second_notice") {
          await encolar(c, { ...comun, plantilla: "dunning.second_notice", dedupeKey: d.id, datos });
          await c.query(`UPDATE self_storage_dunning_cases SET second_notice_at = $2 WHERE id = $1`, [d.id, ahora]);
          r.avisos++;
        } else {
          if (d.contract_id) {
            await bloquear(c, actor, { empresaId: d.empresa_id, customerId: d.customer_id, contractId: d.contract_id, reason: "payment", source: "system", notes: `Impago de la factura ${aviso.invoice_number}`, dunningCaseId: d.id });
            await suspenderSiActivo(c, actor, d.contract_id, "payment");
            await encolar(c, { ...comun, plantilla: "dunning.suspended", dedupeKey: d.id, datos });
          }
          await c.query(`UPDATE self_storage_dunning_cases SET suspended_at = $2 WHERE id = $1`, [d.id, ahora]);
          r.suspensiones++;
        }
      }
      await auditar(c, actor, { action: "dunning.advanced", entityType: "invoice", entityId: d.invoice_id, after: { caseId: d.id, actions: acciones } });
    });
  }
  return r;
}

export async function listarCasos(empresaId: string, estado: string | null) {
  const { rows } = await pool.query(
    `SELECT d.id, d.status, d.opened_at AS "openedAt", d.failure_reason AS "failureReason", d.first_notice_at AS "firstNoticeAt",
            d.second_notice_at AS "secondNoticeAt", d.suspended_at AS "suspendedAt", d.resolved_at AS "resolvedAt", d.resolution,
            d.invoice_id AS "invoiceId", i.invoice_number AS "invoiceNumber", i.total::float8 AS total, i.status AS "invoiceStatus",
            d.customer_id AS "customerId", i.customer_name AS "customerName", d.contract_id AS "contractId",
            k.contract_number AS "contractNumber", k.status AS "contractStatus"
       FROM self_storage_dunning_cases d
       JOIN self_storage_invoices i ON i.id = d.invoice_id
       LEFT JOIN self_storage_contracts k ON k.id = d.contract_id
      WHERE d.empresa_id = $1 ${estado ? "AND d.status = $2" : ""}
      ORDER BY d.opened_at DESC LIMIT 200`,
    estado ? [empresaId, estado] : [empresaId]
  );
  return rows;
}
