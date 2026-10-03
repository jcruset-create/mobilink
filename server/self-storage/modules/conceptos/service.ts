/**
 * Catálogo de conceptos facturables (`self_storage_billing_items`).
 *
 * Cada concepto lleva SU tratamiento fiscal (tipo de IVA y, si no lleva, el
 * motivo). El panel no conoce ningún tipo impositivo: los lee de aquí.
 *
 * La primera vez que una empresa abre el catálogo se crean conceptos de
 * partida para que haya con qué empezar. Son DATOS, editables y desactivables,
 * no reglas del código. El tratamiento de la fianza y del seguro, en concreto,
 * tiene que revisarlo la asesoría: por eso el texto lo dice.
 */

import type { z } from "zod";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { construirSet, enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { noExiste } from "../../errors.ts";
import type { conceptoAlta, conceptoCambio } from "../../schemas.ts";

const COLUMNAS = `id, code, name, item_type AS "itemType", default_price::float8 AS "defaultPrice", tax_rate::float8 AS "taxRate",
  tax_exemption_reason AS "taxExemptionReason", is_recurring AS "isRecurring", is_rental_component AS "isRentalComponent",
  active, sort_order AS "sortOrder"`;

const COLUMNA: Record<string, string> = {
  name: "name",
  defaultPrice: "default_price",
  taxRate: "tax_rate",
  taxExemptionReason: "tax_exemption_reason",
  isRecurring: "is_recurring",
  isRentalComponent: "is_rental_component",
  active: "active",
  sortOrder: "sort_order",
};

async function sembrar(c: Ejecutor, empresaId: string) {
  const iva = await leerAjuste(c, empresaId, null, "units.default_rental_tax_rate");
  const revisar = "Valor de partida: revísalo con tu asesoría.";
  const base: [string, string, string, number, number, string | null, boolean, boolean][] = [
    ["RENT", "Alquiler de trastero", "rental", 0, iva, null, true, true],
    ["DEPOSIT", "Fianza", "deposit", 0, 0, `Fianza: no sujeta a IVA. ${revisar}`, false, false],
    ["INSURANCE", "Seguro de contenido", "insurance", 0, 0, `Seguro: exento de IVA. ${revisar}`, true, false],
    ["LOCK", "Candado", "lock", 0, iva, null, false, false],
    ["SETUP", "Alta", "setup_fee", 0, iva, null, false, false],
    ["PENALTY", "Penalización", "penalty", 0, 0, `Penalización/indemnización: no sujeta. ${revisar}`, false, false],
    ["DISCOUNT", "Descuento", "discount", 0, iva, null, false, false],
    ["OTHER", "Otros", "other", 0, iva, null, false, false],
  ];
  let orden = 0;
  for (const [code, name, tipo, precio, tasa, motivo, recurrente, cuota] of base) {
    await c.query(
      `INSERT INTO self_storage_billing_items (empresa_id, code, name, item_type, default_price, tax_rate, tax_exemption_reason, is_recurring, is_rental_component, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (empresa_id, code) DO NOTHING`,
      [empresaId, code, name, tipo, precio, tasa, motivo, recurrente, cuota, orden++]
    );
  }
}

export async function listar(empresaId: string, db: Ejecutor = pool) {
  const q = () => db.query(`SELECT ${COLUMNAS} FROM self_storage_billing_items WHERE empresa_id = $1 ORDER BY sort_order, name`, [empresaId]);
  let { rows } = await q();
  if (!rows.length) {
    await sembrar(db, empresaId);
    ({ rows } = await q());
  }
  return rows;
}

/** El concepto de un tipo (para la fianza del contrato), sembrando si hace falta. */
export async function porTipo(c: Ejecutor, empresaId: string, tipo: string) {
  await listar(empresaId, c);
  const { rows } = await c.query(
    `SELECT ${COLUMNAS} FROM self_storage_billing_items WHERE empresa_id = $1 AND item_type = $2 AND active ORDER BY sort_order LIMIT 1`,
    [empresaId, tipo]
  );
  return rows[0] ?? null;
}

export async function obtener(c: Ejecutor, empresaId: string, id: string) {
  const { rows } = await c.query(`SELECT ${COLUMNAS} FROM self_storage_billing_items WHERE empresa_id = $1 AND id = $2`, [empresaId, id]);
  return rows[0] ?? null;
}

export function crear(actor: Actor, d: z.infer<typeof conceptoAlta>) {
  return enTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO self_storage_billing_items (empresa_id, code, name, item_type, default_price, tax_rate, tax_exemption_reason, is_recurring, is_rental_component, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [actor.empresaId, d.code, d.name, d.itemType, d.defaultPrice, d.taxRate, d.taxExemptionReason ?? null, d.isRecurring, d.isRentalComponent, d.active, d.sortOrder]
    );
    const nuevo = await obtener(c, actor.empresaId, rows[0].id);
    await auditar(c, actor, { action: "billing_item.created", entityType: "billing_item", entityId: rows[0].id, after: nuevo });
    return nuevo;
  });
}

export function actualizar(actor: Actor, id: string, d: z.infer<typeof conceptoCambio>) {
  return enTx(async (c) => {
    const antes = await obtener(c, actor.empresaId, id);
    if (!antes) throw noExiste("El concepto");
    const set = construirSet(d, COLUMNA, 3);
    if (set.sql) await c.query(`UPDATE self_storage_billing_items SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, id, ...set.valores]);
    const dif = diferencias(antes, d);
    // Cambiar el IVA de un concepto no toca facturas emitidas (tienen su línea
    // congelada) ni contratos firmados (copiaron el suyo).
    if (dif) await auditar(c, actor, { action: "billing_item.updated", entityType: "billing_item", entityId: id, ...dif });
    return obtener(c, actor.empresaId, id);
  });
}
