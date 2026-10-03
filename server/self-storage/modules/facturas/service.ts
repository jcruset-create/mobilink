/**
 * Facturas de Self Storage: la contabilidad es NUESTRA.
 *
 * Toda factura emitida pasa por `emitir()`, venga de donde venga (borrador
 * manual, periodo de un contrato de cobro manual o factura de Stripe):
 *
 *   1. instantánea fiscal del cliente y del emisor (lo que diga la ficha
 *      mañana no cambia esta factura);
 *   2. número correlativo de la serie, pedido DENTRO de la transacción
 *      (`siguienteNumero`): sin colisiones y sin huecos;
 *   3. líneas con su base, su IVA y su total;
 *   4. auditoría y aviso al cliente en la misma transacción.
 *
 * El PDF se genera después, a demanda, desde la instantánea: si falla, no
 * deshace una factura emitida. Una emitida no se borra ni se renumera (lo
 * impide además un trigger): se corrige con una rectificativa.
 */

import type { PoolClient } from "pg";
import type { z } from "zod";
import { auditar, type Actor } from "../../shared/audit.ts";
import { enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { anioDe, hoyMadrid, siguienteNumero } from "../../shared/numeracion.ts";
import * as archivos from "../../shared/archivos.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { calcularLinea, lineasDelPeriodo, periodoDesde, sumarDias, totales, type LineaCalculada, type Periodo } from "../../domain/facturacion.ts";
import { pdfFactura, type InstantaneaFactura } from "../../documentos/pdf.ts";
import * as conceptos from "../conceptos/service.ts";
import { encolar } from "../notificaciones/service.ts";
import type { facturaBorrador } from "../../schemas.ts";
import type { InvoiceStatus } from "../../../../src/modules/self-storage/types/enums.ts";

const eur = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** Actor del sistema (webhooks, trabajos programados). */
export const sistema = (empresaId: string): Actor => ({ empresaId, userId: "", nombre: "Sistema", ip: null });

export async function emisor(c: Ejecutor, empresaId: string) {
  const e = await leerAjuste(c, empresaId, null, "billing.issuer");
  if (!e) {
    throw new ErrorSelfStorage(
      "EMISOR_NO_CONFIGURADO",
      "Faltan los datos fiscales del emisor (Configuración → Facturación). Sin ellos no se emite ninguna factura ni contrato.",
      409
    );
  }
  return e;
}

export function direccionCliente(c: { address: string | null; postal_code: string | null; city: string | null; province: string | null; country: string }) {
  return [c.address, [c.postal_code, c.city].filter(Boolean).join(" "), c.province, c.country].filter(Boolean).join(", ");
}

export function nombreCliente(c: { customer_type: string; first_name: string | null; last_name: string | null; company_name: string | null }) {
  return c.customer_type === "company" ? (c.company_name ?? "") : `${c.first_name ?? ""} ${c.last_name ?? ""}`.trim();
}

export type DatosEmision = {
  empresaId: string;
  customerId: string;
  contractId: string | null;
  kind: "rent" | "one_off" | "rectifying";
  collection: "stripe" | "manual";
  lineas: LineaCalculada[];
  periodo?: { start: string; end: string } | null;
  issueDate?: string;
  dueDate?: string | null;
  stripeInvoiceId?: string | null;
  stripeHostedUrl?: string | null;
  rectifiesId?: string | null;
  rectificationReason?: string | null;
  notes?: string | null;
  /** Estado tras emitir: normalmente `pending`; una rectificativa que anula una impagada nace `paid`. */
  estadoFinal?: InvoiceStatus;
  /** Si ya existe un borrador, se emite ese en vez de crear otro. */
  borradorId?: string | null;
};

/** Emite una factura. Hay que llamarla DENTRO de una transacción. */
export async function emitir(c: Ejecutor, actor: Actor, d: DatosEmision): Promise<{ id: string; numero: string; total: number }> {
  const em = await emisor(c, d.empresaId);
  const { rows: cl } = await c.query(
    `SELECT id, customer_type, first_name, last_name, company_name, tax_id, email, address, postal_code, city, province, country
       FROM self_storage_customers WHERE empresa_id = $1 AND id = $2`,
    [d.empresaId, d.customerId]
  );
  if (!cl.length) throw noExiste("El cliente");
  const cliente = cl[0];

  const fecha = d.issueDate ?? hoyMadrid();
  const serie = await leerAjuste(c, d.empresaId, null, d.kind === "rectifying" ? "billing.rectifying_series" : "billing.invoice_series");
  const { numero } = await siguienteNumero(c, d.empresaId, serie, anioDe(fecha));
  const t = totales(d.lineas);

  const columnas = {
    series: serie,
    invoice_number: numero,
    issue_date: fecha,
    due_date: d.dueDate ?? null,
    subtotal: t.subtotal,
    tax: t.tax,
    total: t.total,
    customer_name: nombreCliente(cliente),
    customer_tax_id: cliente.tax_id,
    customer_address: direccionCliente(cliente),
    issuer_name: em.name,
    issuer_tax_id: em.taxId,
    issuer_address: em.address,
  };

  let id: string;
  if (d.borradorId) {
    id = d.borradorId;
    await c.query(
      `UPDATE self_storage_invoices SET series=$3, invoice_number=$4, issue_date=$5, due_date=$6, subtotal=$7, tax=$8, total=$9,
              customer_name=$10, customer_tax_id=$11, customer_address=$12, issuer_name=$13, issuer_tax_id=$14, issuer_address=$15
        WHERE empresa_id = $1 AND id = $2 AND status = 'draft'`,
      [d.empresaId, id, ...Object.values(columnas)]
    );
  } else {
    const { rows } = await c.query(
      `INSERT INTO self_storage_invoices
         (empresa_id, customer_id, contract_id, kind, collection_method, series, invoice_number, issue_date, due_date,
          billing_period_start, billing_period_end, subtotal, tax, total, customer_name, customer_tax_id, customer_address,
          issuer_name, issuer_tax_id, issuer_address, stripe_invoice_id, stripe_hosted_url, rectifies_invoice_id,
          rectification_reason, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'draft')
       RETURNING id`,
      [
        d.empresaId, d.customerId, d.contractId, d.kind, d.collection, serie, numero, fecha, d.dueDate ?? null,
        d.periodo?.start ?? null, d.periodo?.end ?? null, t.subtotal, t.tax, t.total, columnas.customer_name,
        columnas.customer_tax_id, columnas.customer_address, em.name, em.taxId, em.address, d.stripeInvoiceId ?? null,
        d.stripeHostedUrl ?? null, d.rectifiesId ?? null, d.rectificationReason ?? null, d.notes ?? null, actor.userId || null,
      ]
    );
    id = rows[0].id;
    await insertarLineas(c, id, d.lineas);
  }

  const estado = d.estadoFinal ?? "pending";
  await c.query(
    `UPDATE self_storage_invoices SET status = $3::self_storage_invoice_status, paid_at = CASE WHEN $3::text IN ('paid','refunded') THEN now() ELSE paid_at END
      WHERE empresa_id = $1 AND id = $2`,
    [d.empresaId, id, estado]
  );
  await auditar(c, actor, {
    action: "invoice.issued",
    entityType: "invoice",
    entityId: id,
    after: { number: numero, kind: d.kind, total: t.total, period: d.periodo ?? null, stripeInvoiceId: d.stripeInvoiceId ?? null },
  });
  if (d.kind !== "rectifying") {
    await encolar(c, {
      empresaId: d.empresaId,
      plantilla: "invoice.issued",
      dedupeKey: id,
      destinatario: cliente.email,
      customerId: d.customerId,
      contractId: d.contractId,
      invoiceId: id,
      datos: { cliente: nombreCliente(cliente), factura: numero, importe: eur(t.total), vencimiento: d.dueDate ?? undefined, empresa: em.name },
    });
  }
  return { id, numero, total: t.total };
}

async function insertarLineas(c: Ejecutor, invoiceId: string, lineas: LineaCalculada[]) {
  let orden = 0;
  for (const l of lineas) {
    await c.query(
      `INSERT INTO self_storage_invoice_items
         (invoice_id, billing_item_id, item_type, description, quantity, unit_price, tax_rate, subtotal, tax_amount, total,
          period_start, period_end, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [invoiceId, l.billingItemId ?? null, l.itemType, l.description, l.quantity, l.unitPrice, l.taxRate, l.subtotal, l.taxAmount, l.total, l.periodStart ?? null, l.periodEnd ?? null, orden++]
    );
  }
}

// ── Contratos de cobro manual: una factura por periodo ──────────────────────

export type ContratoParaFacturar = {
  id: string;
  empresa_id: string;
  customer_id: string;
  start_date: string;
  billing_day: number;
  monthly_price: number;
  monthly_price_gross: number | null;
  tax_rate: number;
  deposit_amount: number;
  deposit_tax_rate: number;
  unit_code: string;
  collection_method: "stripe" | "manual";
};

export async function cargarContratoFacturable(c: Ejecutor, empresaId: string, contractId: string): Promise<ContratoParaFacturar & { extras: Parameters<typeof lineasDelPeriodo>[0]["extras"] }> {
  const { rows } = await c.query(
    `SELECT k.id, k.empresa_id, k.customer_id, to_char(k.start_date,'YYYY-MM-DD') AS start_date, k.billing_day,
            k.monthly_price::float8 AS monthly_price, k.monthly_price_gross::float8 AS monthly_price_gross,
            k.tax_rate::float8 AS tax_rate, k.deposit_amount::float8 AS deposit_amount,
            k.deposit_tax_rate::float8 AS deposit_tax_rate, u.code AS unit_code, k.collection_method
       FROM self_storage_contracts k JOIN self_storage_units u ON u.id = k.storage_unit_id
      WHERE k.empresa_id = $1 AND k.id = $2`,
    [empresaId, contractId]
  );
  if (!rows.length) throw noExiste("El contrato");
  const extras = await c.query(
    `SELECT item_type AS "itemType", description, quantity::float8 AS quantity, unit_price::float8 AS "unitPrice",
            tax_rate::float8 AS "taxRate", is_recurring AS "isRecurring", billing_item_id AS "billingItemId"
       FROM self_storage_contract_items WHERE contract_id = $1 ORDER BY sort_order`,
    [contractId]
  );
  return { ...rows[0], extras: extras.rows };
}

/**
 * Factura el periodo que empieza en `inicio`. Idempotente: si ese periodo ya
 * está facturado (índice único parcial en la base), no hace nada y lo dice.
 */
export async function facturarPeriodo(c: PoolClient, contractId: string, empresaId: string, inicio: string, primera: boolean): Promise<{ id: string; periodo: Periodo } | null> {
  const k = await cargarContratoFacturable(c, empresaId, contractId);
  const periodo = periodoDesde(inicio, k.billing_day);
  const { rows: ya } = await c.query(
    `SELECT id FROM self_storage_invoices WHERE contract_id = $1 AND kind = 'rent' AND billing_period_start = $2 AND status <> 'cancelled'`,
    [contractId, periodo.start]
  );
  if (ya.length) return null;
  const lineas = lineasDelPeriodo(
    {
      monthlyPrice: k.monthly_price,
      monthlyPriceGross: k.monthly_price_gross,
      taxRate: k.tax_rate,
      depositAmount: k.deposit_amount,
      depositTaxRate: k.deposit_tax_rate,
      billingDay: k.billing_day,
      unitCode: k.unit_code,
      extras: k.extras,
    },
    periodo,
    primera
  );
  const dias = await leerAjuste(c, empresaId, null, "billing.due_days");
  const hoy = hoyMadrid();
  const r = await emitir(c, sistema(empresaId), {
    empresaId,
    customerId: k.customer_id,
    contractId,
    kind: "rent",
    collection: "manual",
    lineas,
    periodo,
    dueDate: sumarDias(hoy, dias),
  });
  await c.query(`UPDATE self_storage_contracts SET next_invoice_date = $2 WHERE id = $1`, [contractId, sumarDias(periodo.end, 1)]);
  return { id: r.id, periodo };
}

/**
 * Trabajo programado: factura los periodos vencidos de los contratos de cobro
 * manual. Cada contrato en su transacción, con el contrato bloqueado: dos
 * pasadas a la vez no facturan dos veces el mismo periodo (y aunque lo
 * intentaran, el índice único lo impide).
 */
export async function facturarPeriodosManuales(hoy = hoyMadrid()): Promise<{ facturas: number }> {
  const { rows } = await pool.query(
    `SELECT id, empresa_id FROM self_storage_contracts
      WHERE collection_method = 'manual' AND status IN ('active','suspended') AND next_invoice_date IS NOT NULL AND next_invoice_date <= $1
        AND (end_date IS NULL OR next_invoice_date <= end_date)`,
    [hoy]
  );
  let n = 0;
  for (const k of rows) {
    // Varios periodos atrasados se facturan uno a uno, hasta hoy.
    for (let i = 0; i < 24; i++) {
      const hecho = await enTx(async (c) => {
        const { rows: r } = await c.query(
          `SELECT to_char(next_invoice_date,'YYYY-MM-DD') AS d, status, to_char(end_date,'YYYY-MM-DD') AS fin FROM self_storage_contracts WHERE id = $1 FOR UPDATE`,
          [k.id]
        );
        const d = r[0]?.d as string | undefined;
        if (!d || d > hoy || !["active", "suspended"].includes(r[0].status) || (r[0].fin && d > r[0].fin)) return false;
        const f = await facturarPeriodo(c, k.id, k.empresa_id, d, false);
        if (!f) {
          // Ya facturado: avanzar la marca igualmente para no atascarse.
          const p = periodoDesde(d, (await cargarContratoFacturable(c, k.empresa_id, k.id)).billing_day);
          await c.query(`UPDATE self_storage_contracts SET next_invoice_date = $2 WHERE id = $1`, [k.id, sumarDias(p.end, 1)]);
        } else n++;
        return true;
      });
      if (!hecho) break;
    }
  }
  return { facturas: n };
}

// ── Borradores manuales (conceptos sueltos: penalización, candado…) ─────────

export async function crearBorrador(actor: Actor, d: z.infer<typeof facturaBorrador>) {
  return enTx(async (c) => {
    const { rows: cl } = await c.query(`SELECT id FROM self_storage_customers WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, d.customerId]);
    if (!cl.length) throw noExiste("El cliente");
    if (d.contractId) {
      const { rows } = await c.query(`SELECT id FROM self_storage_contracts WHERE empresa_id = $1 AND id = $2 AND customer_id = $3`, [actor.empresaId, d.contractId, d.customerId]);
      if (!rows.length) throw noExiste("El contrato");
    }
    const lineas = await lineasDesdeCatalogo(c, actor.empresaId, d.lines);
    const t = totales(lineas);
    const { rows } = await c.query(
      `INSERT INTO self_storage_invoices (empresa_id, customer_id, contract_id, kind, collection_method, subtotal, tax, total, due_date, notes, created_by)
       VALUES ($1,$2,$3,'one_off','manual',$4,$5,$6,$7,$8,$9) RETURNING id`,
      [actor.empresaId, d.customerId, d.contractId ?? null, t.subtotal, t.tax, t.total, d.dueDate ?? null, d.notes ?? null, actor.userId || null]
    );
    await insertarLineas(c, rows[0].id, lineas);
    await auditar(c, actor, { action: "invoice.draft_created", entityType: "invoice", entityId: rows[0].id, after: { lines: lineas.length, total: t.total } });
    return obtener(actor, rows[0].id, c);
  });
}

/** El IVA de cada línea sale del CATÁLOGO: el panel no decide tipos impositivos. */
async function lineasDesdeCatalogo(c: Ejecutor, empresaId: string, lines: z.infer<typeof facturaBorrador>["lines"]): Promise<LineaCalculada[]> {
  const out: LineaCalculada[] = [];
  for (const l of lines) {
    // Tipo EFECTIVO del concepto (hereda el IVA general o el suyo), copiado a
    // la línea: emitida la factura, ya no cambia aunque cambie la configuración.
    const item = await conceptos.obtener(c, empresaId, l.billingItemId);
    if (!item) throw noExiste("El concepto");
    if (!item.active) throw new ErrorSelfStorage("CONCEPTO_INACTIVO", `El concepto «${item.name}» está inactivo.`, 409);
    const precio = l.unitPrice ?? (item.defaultPrice as number);
    if (item.itemType === "discount" ? precio > 0 : precio < 0) {
      throw new ErrorSelfStorage("PRECIO_NO_VALIDO", `El precio de «${item.name}» no tiene el signo correcto.`, 422);
    }
    out.push(
      calcularLinea({
        itemType: item.itemType as LineaCalculada["itemType"],
        description: l.description?.trim() || (item.name as string),
        quantity: l.quantity,
        unitPrice: precio,
        taxRate: item.taxRate,
        billingItemId: item.id as string,
      })
    );
  }
  if (totales(out).total <= 0) throw new ErrorSelfStorage("TOTAL_NO_VALIDO", "El total de la factura tiene que ser mayor que cero.", 422);
  return out;
}

export function emitirBorrador(actor: Actor, id: string) {
  return enTx(async (c) => {
    const { rows } = await c.query(
      `SELECT id, customer_id, contract_id, status, to_char(due_date,'YYYY-MM-DD') AS due_date FROM self_storage_invoices WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
      [actor.empresaId, id]
    );
    if (!rows.length) throw noExiste("La factura");
    if (rows[0].status !== "draft") throw new ErrorSelfStorage("FACTURA_YA_EMITIDA", "La factura ya está emitida.", 409);
    const { rows: lineas } = await c.query(
      `SELECT item_type AS "itemType", description, quantity::float8 AS quantity, unit_price::float8 AS "unitPrice", tax_rate::float8 AS "taxRate",
              subtotal::float8 AS subtotal, tax_amount::float8 AS "taxAmount", total::float8 AS total
         FROM self_storage_invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
      [id]
    );
    const dias = await leerAjuste(c, actor.empresaId, null, "billing.due_days");
    await emitir(c, actor, {
      empresaId: actor.empresaId,
      customerId: rows[0].customer_id,
      contractId: rows[0].contract_id,
      kind: "one_off",
      collection: "manual",
      lineas,
      dueDate: rows[0].due_date ?? sumarDias(hoyMadrid(), dias),
      borradorId: id,
    });
    return obtener(actor, id, c);
  });
}

export function borrarBorrador(actor: Actor, id: string) {
  return enTx(async (c) => {
    const { rows } = await c.query(`DELETE FROM self_storage_invoices WHERE empresa_id = $1 AND id = $2 AND status = 'draft' RETURNING id`, [actor.empresaId, id]);
    if (!rows.length) throw new ErrorSelfStorage("NO_ES_BORRADOR", "Sólo se puede borrar un borrador: una factura emitida se rectifica.", 409);
    await auditar(c, actor, { action: "invoice.draft_deleted", entityType: "invoice", entityId: id });
  });
}

// ── Rectificativas ──────────────────────────────────────────────────────────

/**
 * Anula una factura emitida con otra en negativo (serie de rectificativas).
 * La original queda `cancelled` si no estaba pagada o `refunded` si se
 * devolvió el cobro; nunca se borra ni se toca su contenido.
 */
export async function rectificarEnTx(c: Ejecutor, actor: Actor, invoiceId: string, motivo: string, estadoOriginal: "cancelled" | "refunded") {
  const { rows } = await c.query(
    `SELECT id, empresa_id, customer_id, contract_id, status, invoice_number, collection_method FROM self_storage_invoices
      WHERE empresa_id = $1 AND id = $2 FOR UPDATE`,
    [actor.empresaId, invoiceId]
  );
  if (!rows.length) throw noExiste("La factura");
  const f = rows[0];
  const { rows: lineas } = await c.query(
    `SELECT item_type AS "itemType", description, quantity::float8 AS quantity, unit_price::float8 AS "unitPrice", tax_rate::float8 AS "taxRate",
            billing_item_id AS "billingItemId"
       FROM self_storage_invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
    [invoiceId]
  );
  const negativas = lineas.map((l) => calcularLinea({ ...l, quantity: -l.quantity, description: `Rectificación: ${l.description}` }));
  const r = await emitir(c, actor, {
    empresaId: actor.empresaId,
    customerId: f.customer_id,
    contractId: f.contract_id,
    kind: "rectifying",
    collection: f.collection_method,
    lineas: negativas,
    rectifiesId: invoiceId,
    rectificationReason: motivo,
    estadoFinal: estadoOriginal === "refunded" ? "refunded" : "paid",
  });
  await c.query(
    `UPDATE self_storage_invoices SET status = $3::self_storage_invoice_status, cancelled_at = CASE WHEN $3::text = 'cancelled' THEN now() ELSE cancelled_at END WHERE empresa_id = $1 AND id = $2`,
    [actor.empresaId, invoiceId, estadoOriginal]
  );
  await auditar(c, actor, { action: "invoice.rectified", entityType: "invoice", entityId: invoiceId, before: { status: f.status }, after: { status: estadoOriginal, rectifyingId: r.id, reason: motivo } });
  return r;
}

export function rectificar(actor: Actor, invoiceId: string, motivo: string) {
  return enTx(async (c) => {
    const { rows } = await c.query(`SELECT status, collection_method, stripe_invoice_id FROM self_storage_invoices WHERE empresa_id = $1 AND id = $2 FOR UPDATE`, [actor.empresaId, invoiceId]);
    if (!rows.length) throw noExiste("La factura");
    if (!["pending", "overdue"].includes(rows[0].status)) {
      throw new ErrorSelfStorage(
        "NO_RECTIFICABLE",
        rows[0].status === "paid" ? "Una factura cobrada se rectifica devolviendo el cobro (reembolso), no anulándola." : `No se puede anular una factura en estado «${rows[0].status}».`,
        409
      );
    }
    if (rows[0].stripe_invoice_id) {
      throw new ErrorSelfStorage("FACTURA_DE_STRIPE", "Esta factura la cobra Stripe: anúlala allí (void) y llegará por webhook.", 409);
    }
    const r = await rectificarEnTx(c, actor, invoiceId, motivo, "cancelled");
    const { resolverImpagoDeFactura } = await import("../impagos/service.ts");
    await resolverImpagoDeFactura(c, actor, invoiceId, "cancelled");
    return r;
  });
}

// ── Lectura ─────────────────────────────────────────────────────────────────

const COLUMNAS = `
  i.id, i.customer_id AS "customerId", i.contract_id AS "contractId", i.kind, i.collection_method AS "collectionMethod",
  i.series, i.invoice_number AS "invoiceNumber", to_char(i.issue_date,'YYYY-MM-DD') AS "issueDate",
  to_char(i.due_date,'YYYY-MM-DD') AS "dueDate", to_char(i.billing_period_start,'YYYY-MM-DD') AS "periodStart",
  to_char(i.billing_period_end,'YYYY-MM-DD') AS "periodEnd", i.subtotal::float8 AS subtotal, i.tax::float8 AS tax,
  i.total::float8 AS total, i.currency, i.status, i.customer_name AS "customerName", i.customer_tax_id AS "customerTaxId",
  i.customer_address AS "customerAddress", i.issuer_name AS "issuerName", i.issuer_tax_id AS "issuerTaxId",
  i.issuer_address AS "issuerAddress", i.stripe_invoice_id AS "stripeInvoiceId", i.stripe_hosted_url AS "stripeHostedUrl",
  i.rectifies_invoice_id AS "rectifiesInvoiceId", i.rectification_reason AS "rectificationReason", i.paid_at AS "paidAt",
  i.notes, i.created_at AS "createdAt",
  k.contract_number AS "contractNumber",
  coalesce(i.customer_name, CASE WHEN cu.customer_type = 'company' THEN cu.company_name ELSE btrim(coalesce(cu.first_name,'') || ' ' || coalesce(cu.last_name,'')) END) AS "displayCustomer",
  (SELECT coalesce(sum(p.amount - p.refunded_amount), 0)::float8 FROM self_storage_payments p WHERE p.invoice_id = i.id AND p.status IN ('succeeded','refunded')) AS "amountPaid"`;

const FROM = `FROM self_storage_invoices i
  JOIN self_storage_customers cu ON cu.id = i.customer_id
  LEFT JOIN self_storage_contracts k ON k.id = i.contract_id`;

export type FiltroFacturas = { customerId?: string; contractId?: string; status?: string; q?: string; limit?: number; offset?: number };

export async function listar(empresaId: string, f: FiltroFacturas, db: Ejecutor = pool) {
  const cond = ["i.empresa_id = $1"];
  const v: unknown[] = [empresaId];
  const add = (sql: string, val: unknown) => {
    v.push(val);
    cond.push(sql.replaceAll("?", `$${v.length}`));
  };
  if (f.customerId) add("i.customer_id = ?", f.customerId);
  if (f.contractId) add("i.contract_id = ?", f.contractId);
  if (f.status) add("i.status = ?", f.status);
  if (f.q) add("(i.invoice_number ILIKE ? OR i.customer_name ILIKE ?)", `%${f.q}%`);
  const where = cond.join(" AND ");
  const total = await db.query(`SELECT count(*)::int AS n FROM self_storage_invoices i WHERE ${where}`, v);
  const { rows } = await db.query(
    `SELECT ${COLUMNAS} ${FROM} WHERE ${where} ORDER BY coalesce(i.issue_date, i.created_at::date) DESC, i.invoice_number DESC NULLS FIRST
      LIMIT ${Math.min(f.limit ?? 50, 200)} OFFSET ${f.offset ?? 0}`,
    v
  );
  return { total: total.rows[0].n, items: rows };
}

export async function obtener(actor: Actor, id: string, db: Ejecutor = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNAS} ${FROM} WHERE i.empresa_id = $1 AND i.id = $2`, [actor.empresaId, id]);
  if (!rows.length) throw noExiste("La factura");
  const [lineas, pagos] = await Promise.all([
    db.query(
      `SELECT id, item_type AS "itemType", description, quantity::float8 AS quantity, unit_price::float8 AS "unitPrice",
              tax_rate::float8 AS "taxRate", subtotal::float8 AS subtotal, tax_amount::float8 AS "taxAmount", total::float8 AS total,
              to_char(period_start,'YYYY-MM-DD') AS "periodStart", to_char(period_end,'YYYY-MM-DD') AS "periodEnd"
         FROM self_storage_invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
      [id]
    ),
    db.query(
      `SELECT id, amount::float8 AS amount, refunded_amount::float8 AS "refundedAmount", payment_method AS "paymentMethod", status,
              paid_at AS "paidAt", failure_reason AS "failureReason", created_at AS "createdAt"
         FROM self_storage_payments WHERE invoice_id = $1 ORDER BY created_at`,
      [id]
    ),
  ]);
  return { ...rows[0], lines: lineas.rows, payments: pagos.rows };
}

/**
 * El PDF de una factura emitida. Se genera la primera vez que se pide, desde
 * la instantánea guardada, y se archiva: las siguientes descargas sirven el
 * mismo fichero.
 */
export async function pdf(empresaId: string, id: string, soloCliente?: string): Promise<{ nombre: string; contenido: Buffer }> {
  const { rows } = await pool.query(
    `SELECT i.*, to_char(i.issue_date,'YYYY-MM-DD') AS fecha, to_char(i.due_date,'YYYY-MM-DD') AS vence,
            to_char(i.billing_period_start,'YYYY-MM-DD') AS pini, to_char(i.billing_period_end,'YYYY-MM-DD') AS pfin,
            k.contract_number, r.invoice_number AS rectifica
       FROM self_storage_invoices i
       LEFT JOIN self_storage_contracts k ON k.id = i.contract_id
       LEFT JOIN self_storage_invoices r ON r.id = i.rectifies_invoice_id
      WHERE i.empresa_id = $1 AND i.id = $2 ${soloCliente ? "AND i.customer_id = $3" : ""}`,
    soloCliente ? [empresaId, id, soloCliente] : [empresaId, id]
  );
  const f = rows[0];
  if (!f || f.status === "draft") throw noExiste("La factura");
  const nombre = `${f.invoice_number}.pdf`;
  if (f.pdf_path) {
    const guardado = await archivos.leer(f.pdf_path);
    if (guardado) return { nombre, contenido: guardado };
  }
  const { rows: lineas } = await pool.query(
    `SELECT description, quantity::float8 AS quantity, unit_price::float8 AS "unitPrice", tax_rate::float8 AS "taxRate",
            subtotal::float8 AS subtotal, tax_amount::float8 AS "taxAmount", total::float8 AS total
       FROM self_storage_invoice_items WHERE invoice_id = $1 ORDER BY sort_order`,
    [id]
  );
  const instantanea: InstantaneaFactura = {
    invoiceNumber: f.invoice_number,
    kind: f.kind,
    issueDate: f.fecha,
    dueDate: f.vence,
    periodStart: f.pini,
    periodEnd: f.pfin,
    rectifies: f.rectifica,
    rectificationReason: f.rectification_reason,
    issuer: { name: f.issuer_name, taxId: f.issuer_tax_id, address: f.issuer_address },
    customer: { name: f.customer_name, taxId: f.customer_tax_id, address: f.customer_address },
    contractNumber: f.contract_number,
    lines: lineas,
    subtotal: Number(f.subtotal),
    tax: Number(f.tax),
    total: Number(f.total),
  };
  const contenido = await pdfFactura(instantanea);
  const ruta = `invoices/${f.customer_id}/${f.fecha.slice(0, 4)}/${f.invoice_number}.pdf`;
  try {
    await archivos.guardar(ruta, contenido);
    await pool.query(`UPDATE self_storage_invoices SET pdf_path = $2, pdf_sha256 = $3 WHERE id = $1 AND pdf_path IS NULL`, [id, ruta, archivos.sha256(contenido)]);
  } catch (e) {
    // Archivar es una comodidad: si falla, el PDF se sirve igual y se vuelve a
    // generar la próxima vez desde la misma instantánea.
    console.warn("[Self Storage] no se ha podido archivar el PDF de la factura:", e);
  }
  return { nombre, contenido };
}
