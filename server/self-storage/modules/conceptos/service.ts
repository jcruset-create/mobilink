/**
 * Catálogo de conceptos facturables (`self_storage_billing_items`).
 *
 * Cada concepto lleva SU tratamiento fiscal: política `inherit_default` (usa
 * el IVA general de la empresa, `default_vat_rate`) o `custom` (su propio
 * tipo, con el motivo si no lleva IVA). Lo que sale de aquí trae ya el tipo
 * EFECTIVO en `taxRate`; el panel no conoce ningún tipo impositivo.
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
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import type { conceptoAlta, conceptoCambio } from "../../schemas.ts";

const COLUMNAS = `id, code, name, item_type AS "itemType", default_price::float8 AS "defaultPrice",
  vat_policy AS "vatPolicy", tax_rate::float8 AS "customTaxRate",
  tax_exemption_reason AS "taxExemptionReason", is_recurring AS "isRecurring", is_rental_component AS "isRentalComponent",
  active, sort_order AS "sortOrder"`;

const COLUMNA: Record<string, string> = {
  name: "name",
  defaultPrice: "default_price",
  vatPolicy: "vat_policy",
  customTaxRate: "tax_rate",
  taxExemptionReason: "tax_exemption_reason",
  isRecurring: "is_recurring",
  isRentalComponent: "is_rental_component",
  active: "active",
  sortOrder: "sort_order",
};

async function sembrar(c: Ejecutor, empresaId: string) {
  const revisar = "Valor de partida: revísalo con tu asesoría.";
  // null = hereda el IVA general; un número = tipo propio del concepto.
  const base: [string, string, string, number | null, string | null, boolean, boolean][] = [
    ["RENT", "Alquiler de trastero", "rental", null, null, true, true],
    ["DEPOSIT", "Fianza", "deposit", 0, `Fianza: no sujeta a IVA. ${revisar}`, false, false],
    ["INSURANCE", "Seguro de contenido", "insurance", 0, `Seguro: exento de IVA. ${revisar}`, true, false],
    ["LOCK", "Candado", "lock", null, null, false, false],
    ["SETUP", "Alta", "setup_fee", null, null, false, false],
    ["PENALTY", "Penalización", "penalty", 0, `Penalización/indemnización: no sujeta. ${revisar}`, false, false],
    ["DISCOUNT", "Descuento", "discount", null, null, false, false],
    ["OTHER", "Otros", "other", null, null, false, false],
  ];
  let orden = 0;
  for (const [code, name, tipo, tasa, motivo, recurrente, cuota] of base) {
    await c.query(
      `INSERT INTO self_storage_billing_items (empresa_id, code, name, item_type, default_price, vat_policy, tax_rate, tax_exemption_reason, is_recurring, is_rental_component, sort_order)
       VALUES ($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10) ON CONFLICT (empresa_id, code) DO NOTHING`,
      [empresaId, code, name, tipo, tasa == null ? "inherit_default" : "custom", tasa, motivo, recurrente, cuota, orden++]
    );
  }
}

type FilaConcepto = { vatPolicy: "inherit_default" | "custom"; customTaxRate: number | null } & Record<string, unknown>;

/** IVA general de la empresa (porcentaje). Por empresa: nunca el de un centro. */
export const ivaGeneral = (c: Ejecutor, empresaId: string) => leerAjuste(c, empresaId, null, "default_vat_rate");

/** Tipo efectivo de un concepto: el general si lo hereda, el suyo si es propio. */
export function tipoEfectivo(f: { vatPolicy: string; customTaxRate: number | null }, general: number): number {
  return f.vatPolicy === "inherit_default" ? general : Number(f.customTaxRate ?? 0);
}

const conTipo = <T extends FilaConcepto>(f: T, general: number) => ({ ...f, taxRate: tipoEfectivo(f, general) });

export async function listar(empresaId: string, db: Ejecutor = pool) {
  const q = () => db.query(`SELECT ${COLUMNAS} FROM self_storage_billing_items WHERE empresa_id = $1 ORDER BY sort_order, name`, [empresaId]);
  let { rows } = await q();
  if (!rows.length) {
    await sembrar(db, empresaId);
    ({ rows } = await q());
  }
  const general = await ivaGeneral(db, empresaId);
  return rows.map((f: FilaConcepto) => conTipo(f, general));
}

/** El concepto de un tipo (para la fianza del contrato), sembrando si hace falta. */
export async function porTipo(c: Ejecutor, empresaId: string, tipo: string) {
  await listar(empresaId, c);
  const { rows } = await c.query(
    `SELECT ${COLUMNAS} FROM self_storage_billing_items WHERE empresa_id = $1 AND item_type = $2 AND active ORDER BY sort_order LIMIT 1`,
    [empresaId, tipo]
  );
  return rows[0] ? conTipo(rows[0], await ivaGeneral(c, empresaId)) : null;
}

export async function obtener(c: Ejecutor, empresaId: string, id: string) {
  const { rows } = await c.query(`SELECT ${COLUMNAS} FROM self_storage_billing_items WHERE empresa_id = $1 AND id = $2`, [empresaId, id]);
  return rows[0] ? conTipo(rows[0], await ivaGeneral(c, empresaId)) : null;
}

export function crear(actor: Actor, d: z.infer<typeof conceptoAlta>) {
  return enTx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO self_storage_billing_items (empresa_id, code, name, item_type, default_price, vat_policy, tax_rate, tax_exemption_reason, is_recurring, is_rental_component, active, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [actor.empresaId, d.code, d.name, d.itemType, d.defaultPrice, d.vatPolicy, d.vatPolicy === "custom" ? d.customTaxRate : null, d.taxExemptionReason ?? null, d.isRecurring, d.isRentalComponent, d.active, d.sortOrder]
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
    // Pasar a heredar deja el tipo propio vacío: no hay dos tipos a la vez.
    const cambios = d.vatPolicy === "inherit_default" ? { ...d, customTaxRate: null } : d;
    if (cambios.vatPolicy === "custom" && cambios.customTaxRate === undefined && antes.customTaxRate == null) {
      throw new ErrorSelfStorage("IVA_OBLIGATORIO", "Indica el tipo de IVA del concepto.", 422);
    }
    const set = construirSet(cambios, COLUMNA, 3);
    if (set.sql) await c.query(`UPDATE self_storage_billing_items SET ${set.sql} WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, id, ...set.valores]);
    const dif = diferencias(antes, cambios);
    // Cambiar el IVA de un concepto no toca facturas emitidas (tienen su línea
    // congelada) ni contratos firmados (copiaron el suyo).
    if (dif) await auditar(c, actor, { action: "billing_item.updated", entityType: "billing_item", entityId: id, ...dif });
    return obtener(c, actor.empresaId, id);
  });
}
