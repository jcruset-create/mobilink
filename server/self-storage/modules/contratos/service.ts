/**
 * Contratos: de borrador a finalizado.
 *
 *   crear (draft) → emitir (pending_signature, PDF v1, trastero reservado)
 *   → firmar (pending_payment, documento final e inmutable; si el cobro es
 *     manual, primera factura) → cobrar (Checkout de Stripe o pago manual)
 *   → activo (trastero ocupado) ⇄ suspendido (bloqueos) → finalizado
 *   y cancelado desde cualquier estado anterior a la activación.
 *
 * Reglas fijas:
 *   · el precio se COPIA al crear (precio de tarifa y precio pactado, que puede
 *     ser distinto); cambiar después el del trastero no toca el contrato;
 *   · el trastero tiene que ser de la empresa y del centro del contrato (FKs
 *     compuestas) y no puede tener otro contrato vivo (índice único parcial);
 *   · cada cambio sensible queda auditado.
 */

import type { z } from "zod";
import { auditar, diferencias, type Actor } from "../../shared/audit.ts";
import { enTx, pool, type Ejecutor } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { anioDe, hoyMadrid, siguienteNumero } from "../../shared/numeracion.ts";
import * as archivos from "../../shared/archivos.ts";
import { ErrorSelfStorage, noExiste } from "../../errors.ts";
import { accionesPosibles, exigirEditable, transicion } from "../../domain/contractState.ts";
import { validarCambioEstado } from "../../domain/unitStatus.ts";
import { resolverPrecio, redondear2 } from "../../domain/pricing.ts";
import { siguienteAncla } from "../../domain/facturacion.ts";
import { levantablesPorPersona } from "../../domain/bloqueos.ts";
import { pdfContrato, type InstantaneaContrato } from "../../documentos/pdf.ts";
import { direccionCliente, emisor, facturarPeriodo, nombreCliente } from "../facturas/service.ts";
import { encolar } from "../notificaciones/service.ts";
import { bloquear, levantar, reactivarSiProcede, suspenderSiActivo } from "../impagos/bloqueos.ts";
import * as conceptos from "../conceptos/service.ts";
import { activarContrato, exigirMotivo } from "./activacion.ts";
import { ETIQUETA_PAYMENT_METHOD, LIVE_CONTRACT_STATUSES, type BlockReason, type PaymentMethod } from "../../../../src/modules/self-storage/types/enums.ts";
import type { contratoAlta, contratoCambio } from "../../schemas.ts";

const metodoCobro = (m: PaymentMethod | null | undefined) => (m === "card" || m === "sepa" ? "stripe" : "manual");

// ── Lectura ─────────────────────────────────────────────────────────────────

const COLUMNAS = `
  k.id, k.contract_number AS "contractNumber", k.status, k.center_id AS "centerId", ce.name AS "centerName",
  k.customer_id AS "customerId",
  CASE WHEN cu.customer_type = 'company' THEN cu.company_name ELSE btrim(coalesce(cu.first_name,'') || ' ' || coalesce(cu.last_name,'')) END AS "customerName",
  k.storage_unit_id AS "unitId", u.code AS "unitCode", z.name AS "zoneName",
  to_char(k.start_date,'YYYY-MM-DD') AS "startDate", to_char(k.end_date,'YYYY-MM-DD') AS "endDate",
  k.list_monthly_price::float8 AS "listMonthlyPrice", k.monthly_price::float8 AS "monthlyPrice", k.tax_rate::float8 AS "taxRate",
  -- Contratos anteriores a la fase 2 no tienen el PVP guardado: se calcula.
  coalesce(k.monthly_price_gross, round(k.monthly_price * (1 + k.tax_rate / 100), 2))::float8 AS "monthlyPriceGross",
  k.deposit_amount::float8 AS "depositAmount",
  k.deposit_tax_rate::float8 AS "depositTaxRate", k.billing_day AS "billingDay", k.billing_period AS "billingPeriod",
  k.payment_method AS "paymentMethod", k.collection_method AS "collectionMethod", k.notes,
  k.terms_version AS "termsVersion", k.signed_at AS "signedAt", k.signature_name AS "signatureName",
  k.signed_by_type AS "signedByType", k.activated_at AS "activatedAt", k.suspended_at AS "suspendedAt",
  k.terminated_at AS "terminatedAt", k.termination_reason AS "terminationReason", k.cancelled_at AS "cancelledAt",
  k.cancellation_reason AS "cancellationReason", k.stripe_subscription_id AS "stripeSubscriptionId",
  k.stripe_subscription_status AS "stripeSubscriptionStatus", k.first_sepa_payment_access_policy AS "firstSepaPaymentAccessPolicy",
  k.first_payment_status AS "firstPaymentStatus", k.activation_override_reason AS "activationOverrideReason",
  to_char(k.next_invoice_date,'YYYY-MM-DD') AS "nextInvoiceDate", k.created_at AS "createdAt"`;

const FROM = `FROM self_storage_contracts k
  JOIN self_storage_customers cu ON cu.id = k.customer_id
  JOIN self_storage_units u ON u.id = k.storage_unit_id
  JOIN self_storage_zones z ON z.id = u.zone_id
  JOIN self_storage_centers ce ON ce.id = k.center_id`;

export async function listar(empresaId: string, f: { status?: string; customerId?: string; unitId?: string; centerId?: string; q?: string }) {
  const cond = ["k.empresa_id = $1"];
  const v: unknown[] = [empresaId];
  const add = (sql: string, val: unknown) => {
    v.push(val);
    cond.push(sql.replaceAll("?", `$${v.length}`));
  };
  if (f.status) add("k.status = ?", f.status);
  if (f.customerId) add("k.customer_id = ?", f.customerId);
  if (f.unitId) add("k.storage_unit_id = ?", f.unitId);
  if (f.centerId) add("k.center_id = ?", f.centerId);
  if (f.q) add("(k.contract_number ILIKE ? OR u.code ILIKE ? OR cu.company_name ILIKE ? OR cu.last_name ILIKE ? OR cu.first_name ILIKE ?)", `%${f.q}%`);
  const { rows } = await pool.query(
    `SELECT ${COLUMNAS},
            (SELECT coalesce(sum(i.total),0)::float8 FROM self_storage_invoices i WHERE i.contract_id = k.id AND i.status IN ('pending','overdue')) AS "pendingAmount",
            EXISTS (SELECT 1 FROM self_storage_dunning_cases d WHERE d.contract_id = k.id AND d.status = 'open') AS "inDunning"
       ${FROM} WHERE ${cond.join(" AND ")} ORDER BY k.created_at DESC LIMIT 300`,
    v
  );
  return rows;
}

export async function obtener(empresaId: string, id: string, db: Ejecutor = pool) {
  const { rows } = await db.query(`SELECT ${COLUMNAS} ${FROM} WHERE k.empresa_id = $1 AND k.id = $2`, [empresaId, id]);
  if (!rows.length) throw noExiste("El contrato");
  const [items, docs, bloqueos, facturas] = await Promise.all([
    db.query(
      `SELECT id, billing_item_id AS "billingItemId", item_type AS "itemType", description, quantity::float8 AS quantity,
              unit_price::float8 AS "unitPrice", tax_rate::float8 AS "taxRate", is_recurring AS "isRecurring"
         FROM self_storage_contract_items WHERE contract_id = $1 ORDER BY sort_order`,
      [id]
    ),
    db.query(
      `SELECT id, document_type AS "documentType", version, status, terms_version AS "termsVersion", sha256, size_bytes AS "sizeBytes",
              accepted_at AS "acceptedAt", accepted_by_type AS "acceptedByType", accepted_name AS "acceptedName",
              accepted_ip AS "acceptedIp", created_at AS "createdAt"
         FROM self_storage_contract_documents WHERE contract_id = $1 ORDER BY created_at`,
      [id]
    ),
    db.query(
      `SELECT id, reason, source, notes, created_at AS "createdAt", lifted_at AS "liftedAt", lift_reason AS "liftReason"
         FROM self_storage_access_blocks WHERE contract_id = $1 ORDER BY created_at DESC`,
      [id]
    ),
    db.query(
      `SELECT id, invoice_number AS "invoiceNumber", status, total::float8 AS total, to_char(issue_date,'YYYY-MM-DD') AS "issueDate",
              to_char(billing_period_start,'YYYY-MM-DD') AS "periodStart", to_char(billing_period_end,'YYYY-MM-DD') AS "periodEnd", kind
         FROM self_storage_invoices WHERE contract_id = $1 ORDER BY created_at DESC`,
      [id]
    ),
  ]);
  // Lo que se puede hacer con él lo dice el servidor; la pantalla sólo pinta botones.
  return { ...rows[0], actions: accionesPosibles(rows[0].status), items: items.rows, documents: docs.rows, blocks: bloqueos.rows, invoices: facturas.rows };
}

/** Historial: todo lo auditado del contrato y de sus facturas. */
export async function historial(empresaId: string, id: string) {
  await obtener(empresaId, id);
  const { rows } = await pool.query(
    `SELECT a.id, a.occurred_at AS "occurredAt", a.actor_type AS "actorType", a.actor_name AS "actorName", a.action,
            a.entity_type AS "entityType", a.entity_id AS "entityId", a.before, a.after
       FROM self_storage_audit_logs a
      WHERE a.empresa_id = $1 AND (
              (a.entity_type = 'contract' AND a.entity_id = $2)
           OR (a.entity_type = 'invoice' AND a.entity_id IN (SELECT id FROM self_storage_invoices WHERE contract_id = $2)))
      ORDER BY a.occurred_at DESC LIMIT 500`,
    [empresaId, id]
  );
  return rows;
}

// ── Alta y edición (borrador) ───────────────────────────────────────────────

type Extra = { billingItemId: string; quantity: number; unitPrice?: number | null; description?: string | null };

async function extrasDesdeCatalogo(c: Ejecutor, empresaId: string, extras: Extra[]) {
  const out = [];
  for (const e of extras) {
    const item = await conceptos.obtener(c, empresaId, e.billingItemId);
    if (!item) throw noExiste("El concepto");
    if (!item.active) throw new ErrorSelfStorage("CONCEPTO_INACTIVO", `El concepto «${item.name}» está inactivo.`, 409);
    if (item.itemType === "rental" || item.itemType === "deposit") {
      throw new ErrorSelfStorage("CONCEPTO_NO_ADICIONAL", "El alquiler y la fianza se indican en el propio contrato, no como conceptos adicionales.", 422);
    }
    const precio = e.unitPrice ?? item.defaultPrice;
    if (item.itemType === "discount" ? precio > 0 : precio < 0) throw new ErrorSelfStorage("PRECIO_NO_VALIDO", `El precio de «${item.name}» no tiene el signo correcto.`, 422);
    out.push({ billingItemId: item.id, itemType: item.itemType, description: e.description?.trim() || item.name, quantity: e.quantity, unitPrice: precio, taxRate: item.taxRate, isRecurring: item.isRecurring });
  }
  return out;
}

async function guardarExtras(c: Ejecutor, empresaId: string, contractId: string, extras: Awaited<ReturnType<typeof extrasDesdeCatalogo>>) {
  await c.query(`DELETE FROM self_storage_contract_items WHERE contract_id = $1`, [contractId]);
  let orden = 0;
  for (const e of extras) {
    await c.query(
      `INSERT INTO self_storage_contract_items (empresa_id, contract_id, billing_item_id, item_type, description, quantity, unit_price, tax_rate, is_recurring, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [empresaId, contractId, e.billingItemId, e.itemType, e.description, e.quantity, e.unitPrice, e.taxRate, e.isRecurring, orden++]
    );
  }
}

/**
 * Precio del contrato. El TIPO de IVA es el vigente al crearlo (el del
 * concepto de alquiler: hereda el IVA general o tiene uno propio) y se queda
 * como fotografía en el contrato: cambiar después la configuración no lo toca.
 * Sin precio pactado se parte de la BASE del trastero con ese tipo.
 */
function precioPactado(unidad: { monthly_price: number }, ivaVigente: number, d: { monthlyPrice?: number | null; monthlyPriceGross?: number | null; taxRate?: number | null }) {
  const iva = d.taxRate ?? ivaVigente;
  if (d.monthlyPrice == null && d.monthlyPriceGross == null) return resolverPrecio({ base: unidad.monthly_price, iva });
  return resolverPrecio({ base: d.monthlyPrice ?? null, iva, pvp: d.monthlyPriceGross ?? null });
}

export function crear(actor: Actor, d: z.infer<typeof contratoAlta>) {
  return enTx(async (c) => {
    const { rows: cl } = await c.query(`SELECT id, status FROM self_storage_customers WHERE empresa_id = $1 AND id = $2`, [actor.empresaId, d.customerId]);
    if (!cl.length) throw noExiste("El cliente");
    if (cl[0].status === "blocked") throw new ErrorSelfStorage("CLIENTE_BLOQUEADO", "El cliente está bloqueado: no se le puede hacer un contrato.", 409);
    const { rows: un } = await c.query(
      `SELECT id, center_id, code, monthly_price::float8 AS monthly_price, tax_rate::float8 AS tax_rate, deposit_amount::float8 AS deposit_amount
         FROM self_storage_units WHERE empresa_id = $1 AND id = $2`,
      [actor.empresaId, d.unitId]
    );
    if (!un.length) throw noExiste("El trastero");
    const unidad = un[0];
    const alquiler = await conceptos.porTipo(c, actor.empresaId, "rental");
    const ivaVigente = alquiler?.taxRate ?? (await conceptos.ivaGeneral(c, actor.empresaId));
    const precio = precioPactado(unidad, ivaVigente, d);
    const fianza = await conceptos.porTipo(c, actor.empresaId, "deposit");
    const extras = await extrasDesdeCatalogo(c, actor.empresaId, d.extras ?? []);
    const politica = await leerAjuste(c, actor.empresaId, unidad.center_id, "billing.first_sepa_payment_access_policy");
    const serie = await leerAjuste(c, actor.empresaId, null, "contracts.series");
    const { numero } = await siguienteNumero(c, actor.empresaId, serie, anioDe(hoyMadrid()));
    const billingDay = d.billingDay ?? Math.min(28, Number(d.startDate.slice(8, 10)));

    const { rows } = await c.query(
      `INSERT INTO self_storage_contracts
         (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date, end_date, list_monthly_price,
          monthly_price, tax_rate, monthly_price_gross, deposit_amount, deposit_tax_rate, billing_day, payment_method,
          collection_method, first_sepa_payment_access_policy, notes, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'draft') RETURNING id`,
      [
        actor.empresaId, unidad.center_id, numero, d.customerId, d.unitId, d.startDate, d.endDate ?? null, unidad.monthly_price,
        precio.base, precio.iva, precio.pvp, d.depositAmount ?? unidad.deposit_amount, fianza?.taxRate ?? 0, billingDay,
        d.paymentMethod ?? null, metodoCobro(d.paymentMethod), politica, d.notes ?? null, actor.userId || null,
      ]
    );
    const id = rows[0].id as string;
    await guardarExtras(c, actor.empresaId, id, extras);
    await auditar(c, actor, {
      action: "contract.created",
      entityType: "contract",
      entityId: id,
      after: { number: numero, unit: unidad.code, monthlyPrice: precio.base, listMonthlyPrice: unidad.monthly_price, taxRate: precio.iva, deposit: d.depositAmount ?? unidad.deposit_amount },
    });
    if (precio.base !== unidad.monthly_price) {
      await auditar(c, actor, { action: "contract.price_custom", entityType: "contract", entityId: id, before: { listMonthlyPrice: unidad.monthly_price }, after: { monthlyPrice: precio.base } });
    }
    return obtener(actor.empresaId, id, c);
  });
}

export function actualizar(actor: Actor, id: string, d: z.infer<typeof contratoCambio>) {
  return enTx(async (c) => {
    const { rows } = await c.query(
      `SELECT k.*, k.monthly_price::float8 AS mp, k.tax_rate::float8 AS tr, k.deposit_amount::float8 AS dep,
              to_char(k.start_date,'YYYY-MM-DD') AS sd, to_char(k.end_date,'YYYY-MM-DD') AS ed
         FROM self_storage_contracts k WHERE k.empresa_id = $1 AND k.id = $2 FOR UPDATE`,
      [actor.empresaId, id]
    );
    const k = rows[0];
    if (!k) throw noExiste("El contrato");
    exigirEditable(k.status);
    const cambios: Record<string, unknown> = {};
    if (d.startDate !== undefined) cambios.start_date = d.startDate;
    if (d.endDate !== undefined) cambios.end_date = d.endDate;
    if (d.billingDay !== undefined) cambios.billing_day = d.billingDay;
    if (d.depositAmount !== undefined) cambios.deposit_amount = d.depositAmount;
    if (d.notes !== undefined) cambios.notes = d.notes;
    if (d.paymentMethod !== undefined) {
      cambios.payment_method = d.paymentMethod;
      cambios.collection_method = metodoCobro(d.paymentMethod);
    }
    if (d.monthlyPrice !== undefined || d.monthlyPriceGross !== undefined || d.taxRate !== undefined) {
      const p = resolverPrecio({
        base: d.monthlyPrice ?? (d.monthlyPriceGross !== undefined ? null : k.mp),
        iva: d.taxRate ?? k.tr,
        pvp: d.monthlyPriceGross ?? null,
      });
      cambios.monthly_price = p.base;
      cambios.tax_rate = p.iva;
      cambios.monthly_price_gross = p.pvp;
    }
    const cols = Object.keys(cambios);
    if (cols.length) {
      await c.query(
        `UPDATE self_storage_contracts SET ${cols.map((col, i) => `${col} = $${i + 3}`).join(", ")} WHERE empresa_id = $1 AND id = $2`,
        [actor.empresaId, id, ...Object.values(cambios)]
      );
    }
    if (d.extras) await guardarExtras(c, actor.empresaId, id, await extrasDesdeCatalogo(c, actor.empresaId, d.extras));
    const antes = { start_date: k.sd, end_date: k.ed, billing_day: k.billing_day, deposit_amount: k.dep, notes: k.notes, payment_method: k.payment_method, monthly_price: k.mp, tax_rate: k.tr };
    const dif = diferencias(antes as Record<string, unknown>, cambios);
    if (dif) await auditar(c, actor, { action: "contract.updated", entityType: "contract", entityId: id, ...dif });
    if (dif && ("monthly_price" in dif.after || "tax_rate" in dif.after)) {
      await auditar(c, actor, { action: "contract.price_changed", entityType: "contract", entityId: id, before: { monthlyPrice: k.mp, taxRate: k.tr }, after: { monthlyPrice: cambios.monthly_price, taxRate: cambios.tax_rate } });
    }
    if (d.extras) await auditar(c, actor, { action: "contract.items_changed", entityType: "contract", entityId: id, after: { extras: d.extras.length } });
    return obtener(actor.empresaId, id, c);
  });
}

// ── Documentos ──────────────────────────────────────────────────────────────

async function generarDocumento(c: Ejecutor, actor: Actor, contractId: string, tipo: "contract" | "annex", textoAnexo?: string | null) {
  const { rows } = await c.query(
    `SELECT k.*, to_char(k.start_date,'YYYY-MM-DD') AS sd, to_char(k.end_date,'YYYY-MM-DD') AS ed,
            cu.customer_type, cu.first_name, cu.last_name, cu.company_name, cu.tax_id, cu.email, cu.phone, cu.address, cu.postal_code,
            cu.city, cu.province, cu.country, ce.name AS center_name,
            concat_ws(', ', ce.address, ce.postal_code, ce.city) AS center_address,
            u.code AS unit_code, z.name AS zone_name, u.width_cm, u.length_cm, u.height_cm, u.area_m2::float8 AS area_m2, u.volume_m3::float8 AS volume_m3
       FROM self_storage_contracts k
       JOIN self_storage_customers cu ON cu.id = k.customer_id
       JOIN self_storage_centers ce ON ce.id = k.center_id
       JOIN self_storage_units u ON u.id = k.storage_unit_id
       JOIN self_storage_zones z ON z.id = u.zone_id
      WHERE k.id = $1`,
    [contractId]
  );
  const k = rows[0];
  const em = await emisor(c, k.empresa_id);
  const termsVersion = await leerAjuste(c, k.empresa_id, k.center_id, "contracts.terms_version");
  const termsText = await leerAjuste(c, k.empresa_id, k.center_id, "contracts.terms_text");
  const { rows: extras } = await c.query(
    `SELECT description, quantity::float8 AS quantity, unit_price::float8 AS "unitPrice", tax_rate::float8 AS "taxRate", is_recurring AS recurring
       FROM self_storage_contract_items WHERE contract_id = $1 ORDER BY sort_order`,
    [contractId]
  );
  const { rows: v } = await c.query(
    `SELECT coalesce(max(version), 0) + 1 AS v FROM self_storage_contract_documents WHERE contract_id = $1 AND document_type = $2`,
    [contractId, tipo]
  );
  const version = Number(v[0].v);
  const instantanea: InstantaneaContrato = {
    documentType: tipo,
    version,
    contractNumber: k.contract_number,
    generatedAt: hoyMadrid(),
    termsVersion,
    termsText,
    annexText: textoAnexo ?? null,
    issuer: { name: em.name, taxId: em.taxId, address: em.address },
    customer: { name: nombreCliente(k), taxId: k.tax_id, address: direccionCliente(k), email: k.email, phone: k.phone, type: k.customer_type },
    center: { name: k.center_name, address: k.center_address },
    unit: { code: k.unit_code, zone: k.zone_name, widthCm: k.width_cm, lengthCm: k.length_cm, heightCm: k.height_cm, areaM2: k.area_m2, volumeM3: k.volume_m3 },
    price: { monthlyBase: Number(k.monthly_price), taxRate: Number(k.tax_rate), monthlyGross: Number(k.monthly_price_gross), listMonthlyBase: k.list_monthly_price == null ? null : Number(k.list_monthly_price) },
    deposit: { amount: Number(k.deposit_amount), taxRate: Number(k.deposit_tax_rate) },
    extras,
    dates: { start: k.sd, end: k.ed, billingDay: k.billing_day, billingPeriod: k.billing_period },
    paymentMethod: k.payment_method ? ETIQUETA_PAYMENT_METHOD[k.payment_method as PaymentMethod] : null,
  };
  const contenido = await pdfContrato(instantanea);
  const hash = archivos.sha256(contenido);
  const ruta = `contracts/${k.customer_id}/${k.contract_number}/${tipo}-v${version}-${hash.slice(0, 12)}.pdf`;
  await archivos.guardar(ruta, contenido);
  const { rows: doc } = await c.query(
    `INSERT INTO self_storage_contract_documents
       (empresa_id, contract_id, customer_id, document_type, version, terms_version, snapshot, storage_path, file_name, size_bytes, sha256, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [k.empresa_id, contractId, k.customer_id, tipo, version, termsVersion, JSON.stringify(instantanea), ruta, `${k.contract_number}-${tipo}-v${version}.pdf`, contenido.length, hash, actor.userId || null]
  );
  await auditar(c, actor, { action: "contract.document_generated", entityType: "contract", entityId: contractId, after: { documentId: doc[0].id, type: tipo, version, sha256: hash } });
  return { id: doc[0].id as string, version, sha256: hash, termsVersion, email: k.email, customerName: nombreCliente(k), number: k.contract_number, unitCode: k.unit_code };
}

export async function descargarDocumento(empresaId: string, contractId: string, docId: string, soloCliente?: string) {
  const { rows } = await pool.query(
    `SELECT storage_path, file_name FROM self_storage_contract_documents
      WHERE empresa_id = $1 AND contract_id = $2 AND id = $3 ${soloCliente ? "AND customer_id = $4" : ""}`,
    soloCliente ? [empresaId, contractId, docId, soloCliente] : [empresaId, contractId, docId]
  );
  if (!rows.length) throw noExiste("El documento");
  const contenido = await archivos.leer(rows[0].storage_path);
  if (!contenido) throw new ErrorSelfStorage("DOCUMENTO_NO_DISPONIBLE", "El fichero del documento no está disponible.", 404);
  return { nombre: rows[0].file_name as string, contenido };
}

// ── Transiciones ────────────────────────────────────────────────────────────

async function bloquearContrato(c: Ejecutor, empresaId: string, id: string) {
  const { rows } = await c.query(
    `SELECT k.*, to_char(k.start_date,'YYYY-MM-DD') AS start_txt, u.status AS unit_status, u.code AS unit_code
       FROM self_storage_contracts k JOIN self_storage_units u ON u.id = k.storage_unit_id
      WHERE k.empresa_id = $1 AND k.id = $2 FOR UPDATE OF k, u`,
    [empresaId, id]
  );
  if (!rows.length) throw noExiste("El contrato");
  return rows[0];
}

/** Emitir para firma: genera el PDF y reserva el trastero. */
export function emitir(actor: Actor, id: string) {
  return enTx(async (c) => {
    const k = await bloquearContrato(c, actor.empresaId, id);
    const nuevo = transicion(k.status, "issue");
    const { rows: cl } = await c.query(`SELECT status FROM self_storage_customers WHERE id = $1`, [k.customer_id]);
    if (cl[0].status === "blocked") throw new ErrorSelfStorage("CLIENTE_BLOQUEADO", "El cliente está bloqueado.", 409);
    const { rows: res } = await c.query(
      `SELECT 1 FROM self_storage_reservations WHERE storage_unit_id = $1 AND status = 'active' AND expires_at > now()
          AND (customer_id IS NULL OR customer_id <> $2) LIMIT 1`,
      [k.storage_unit_id, k.customer_id]
    );
    if (res.length) throw new ErrorSelfStorage("TRASTERO_RESERVADO", "El trastero tiene una reserva activa de otro cliente.", 409);
    if (k.unit_status !== "available") {
      throw new ErrorSelfStorage("TRASTERO_NO_DISPONIBLE", `El trastero ${k.unit_code} no está disponible (está «${k.unit_status}»).`, 409);
    }
    validarCambioEstado("available", "reserved", { origen: "sistema", tieneContratoVivo: false, tieneReservaActiva: false });
    // El índice único de contrato vivo por trastero salta aquí si otro se adelantó.
    await c.query(`UPDATE self_storage_contracts SET status = $2 WHERE id = $1`, [id, nuevo]);
    await c.query(`UPDATE self_storage_units SET status = 'reserved' WHERE id = $1`, [k.storage_unit_id]);
    const doc = await generarDocumento(c, actor, id, "contract");
    await c.query(`UPDATE self_storage_contracts SET terms_version = $2 WHERE id = $1`, [id, doc.termsVersion]);
    await auditar(c, actor, { action: "contract.issued", entityType: "contract", entityId: id, before: { status: k.status }, after: { status: nuevo, documentId: doc.id } });
    await encolar(c, {
      empresaId: actor.empresaId,
      plantilla: "contract.generated",
      dedupeKey: doc.id,
      destinatario: doc.email,
      customerId: k.customer_id,
      contractId: id,
      datos: { cliente: doc.customerName, contrato: doc.number, trastero: doc.unitCode },
    });
    return obtener(actor.empresaId, id, c);
  });
}

export type Aceptacion = { nombre: string; ip: string | null; userAgent: string | null; por: "staff" | "customer"; porId: string | null; documentoId?: string | null };

/**
 * Firma/aceptación simple del documento vigente. El documento pasa a `final`
 * y ya no se puede modificar (trigger). Si es el contrato, el contrato pasa a
 * `pending_payment` y, si el cobro es manual, se emite la primera factura.
 */
export function firmar(actor: Actor, id: string, a: Aceptacion) {
  return enTx(async (c) => {
    const k = await bloquearContrato(c, actor.empresaId, id);
    const { rows: docs } = await c.query(
      `SELECT id, document_type, sha256, terms_version FROM self_storage_contract_documents
        WHERE contract_id = $1 AND status = 'draft' ${a.documentoId ? "AND id = $2" : "AND document_type = 'contract'"}
        ORDER BY created_at DESC LIMIT 1`,
      a.documentoId ? [id, a.documentoId] : [id]
    );
    const doc = docs[0];
    if (!doc) throw new ErrorSelfStorage("SIN_DOCUMENTO_PENDIENTE", "No hay ningún documento pendiente de aceptar.", 409);
    const nombre = exigirMotivo(a.nombre);
    const esContrato = doc.document_type === "contract";
    const nuevo = esContrato ? transicion(k.status, "sign") : k.status;
    await c.query(
      `UPDATE self_storage_contract_documents
          SET status = 'final', accepted_at = now(), accepted_by_type = $2, accepted_by_id = $3, accepted_name = $4,
              accepted_ip = $5, accepted_user_agent = $6
        WHERE id = $1`,
      [doc.id, a.por, a.porId, nombre, a.ip, a.userAgent?.slice(0, 500) ?? null]
    );
    if (esContrato) {
      // Si había versiones anteriores sin firmar, quedan sustituidas.
      await c.query(`UPDATE self_storage_contract_documents SET status = 'superseded' WHERE contract_id = $1 AND document_type = 'contract' AND status = 'draft'`, [id]);
      await c.query(
        `UPDATE self_storage_contracts
            SET status = $2, signed_at = now(), signature_name = $3, signature_ip = $4, signature_user_agent = $5,
                signed_by_type = $6, signed_by_id = $7, signed_document_id = $8, terms_version = $9
          WHERE id = $1`,
        [id, nuevo, nombre, a.ip, a.userAgent?.slice(0, 500) ?? null, a.por, a.porId, doc.id, doc.terms_version]
      );
    }
    await auditar(c, actor, {
      action: esContrato ? "contract.signed" : "contract.annex_accepted",
      entityType: "contract",
      entityId: id,
      before: { status: k.status },
      after: { status: nuevo, documentId: doc.id, sha256: doc.sha256, termsVersion: doc.terms_version, by: a.por, name: nombre, ip: a.ip },
    });
    const { rows: cl } = await c.query(`SELECT email, customer_type, first_name, last_name, company_name FROM self_storage_customers WHERE id = $1`, [k.customer_id]);
    await encolar(c, {
      empresaId: actor.empresaId,
      plantilla: "contract.accepted",
      dedupeKey: doc.id,
      destinatario: cl[0].email,
      customerId: k.customer_id,
      contractId: id,
      datos: { cliente: nombreCliente(cl[0]), contrato: k.contract_number },
    });
    if (esContrato && k.collection_method === "manual") {
      await facturarPeriodo(c, id, actor.empresaId, k.start_txt, true);
    }
    return obtener(actor.empresaId, id, c);
  });
}

/** Excepción administrativa: activar sin el cobro confirmado. Siempre con motivo. */
export function activarPorExcepcion(actor: Actor, id: string, motivo: string) {
  return enTx(async (c) => {
    const m = exigirMotivo(motivo);
    await bloquearContrato(c, actor.empresaId, id);
    await activarContrato(c, actor, id, { tipo: "excepcion", motivo: m });
    return obtener(actor.empresaId, id, c);
  });
}

/** Suspensión manual (seguridad, incidencia o manual). El impago lo hace el motor. */
export function suspender(actor: Actor, id: string, motivo: BlockReason, notas: string) {
  return enTx(async (c) => {
    const k = await bloquearContrato(c, actor.empresaId, id);
    if (!["security", "incident", "manual"].includes(motivo)) {
      throw new ErrorSelfStorage("MOTIVO_NO_VALIDO", "A mano se suspende por seguridad, incidencia o motivo manual. El impago lo gestiona el motor de impagos.", 422);
    }
    if (!["active", "suspended"].includes(k.status)) transicion(k.status, "suspend");
    await bloquear(c, actor, { empresaId: actor.empresaId, customerId: k.customer_id, contractId: id, reason: motivo, source: "staff", notes: exigirMotivo(notas) });
    await suspenderSiActivo(c, actor, id, motivo);
    return obtener(actor.empresaId, id, c);
  });
}

/** Levanta UN bloqueo. Seguridad sólo un administrador; impago, sólo cobrando. */
export function levantarBloqueo(actor: Actor, contractId: string, blockId: string, motivo: string, esAdmin: boolean) {
  return enTx(async (c) => {
    await bloquearContrato(c, actor.empresaId, contractId);
    const { rows } = await c.query(`SELECT reason FROM self_storage_access_blocks WHERE id = $1 AND contract_id = $2 AND lifted_at IS NULL`, [blockId, contractId]);
    if (!rows.length) throw noExiste("El bloqueo");
    if (rows[0].reason === "payment") {
      throw new ErrorSelfStorage("BLOQUEO_DE_IMPAGO", "El bloqueo por impago se levanta solo al cobrar la deuda (o anulando la factura).", 409);
    }
    if (!levantablesPorPersona(rows[0].reason, esAdmin)) {
      throw new ErrorSelfStorage("PERMISO_DENEGADO", "Este bloqueo sólo lo puede levantar un administrador.", 403);
    }
    await levantar(c, actor, blockId, exigirMotivo(motivo));
    await reactivarSiProcede(c, actor, contractId);
    return obtener(actor.empresaId, contractId, c);
  });
}

/** Lo que hay que pedirle a Stripe DESPUÉS del COMMIT. */
type TrasCommit = { cancelarSuscripcion?: string };

async function cancelarEnStripe(t: TrasCommit) {
  if (!t.cancelarSuscripcion) return null;
  try {
    const { pasarela } = await import("../../integrations/stripe/pasarela.ts");
    await pasarela().cancelarSuscripcion(t.cancelarSuscripcion);
    return null;
  } catch (e) {
    // El contrato ya está finalizado/cancelado; la cancelación en Stripe se
    // reintenta desde la ficha. Lo que NO puede pasar es seguir cobrando sin
    // que se vea: por eso se devuelve el aviso.
    return `No se ha podido cancelar la suscripción en Stripe: ${e instanceof Error ? e.message : String(e)}. Cancélala desde Stripe.`;
  }
}

export async function finalizar(actor: Actor, id: string, d: { endDate?: string | null; reason: string }) {
  const t: TrasCommit = {};
  const r = await enTx(async (c) => {
    const k = await bloquearContrato(c, actor.empresaId, id);
    const nuevo = transicion(k.status, "terminate");
    const motivo = exigirMotivo(d.reason);
    const fin = d.endDate ?? hoyMadrid();
    await c.query(
      `UPDATE self_storage_contracts SET status = $2, terminated_at = now(), end_date = $3, termination_reason = $4,
              subscription_cancel_requested_at = CASE WHEN stripe_subscription_id IS NOT NULL THEN now() ELSE subscription_cancel_requested_at END,
              next_invoice_date = NULL
        WHERE id = $1`,
      [id, nuevo, fin, motivo]
    );
    validarCambioEstado(k.unit_status, "available", { origen: "sistema", tieneContratoVivo: false, tieneReservaActiva: false });
    await c.query(`UPDATE self_storage_units SET status = 'available' WHERE id = $1`, [k.storage_unit_id]);
    await bloquear(c, actor, { empresaId: actor.empresaId, customerId: k.customer_id, contractId: id, reason: "terminated", source: "system", notes: motivo });
    await auditar(c, actor, { action: "contract.terminated", entityType: "contract", entityId: id, before: { status: k.status }, after: { status: nuevo, endDate: fin, reason: motivo } });
    if (k.stripe_subscription_id) t.cancelarSuscripcion = k.stripe_subscription_id;
    return obtener(actor.empresaId, id, c);
  });
  return { ...r, warning: await cancelarEnStripe(t) };
}

export async function cancelar(actor: Actor, id: string, reason: string) {
  const t: TrasCommit = {};
  const r = await enTx(async (c) => {
    const k = await bloquearContrato(c, actor.empresaId, id);
    const nuevo = transicion(k.status, "cancel");
    const motivo = exigirMotivo(reason);
    await c.query(
      `UPDATE self_storage_contracts SET status = $2, cancelled_at = now(), cancellation_reason = $3,
              subscription_cancel_requested_at = CASE WHEN stripe_subscription_id IS NOT NULL THEN now() ELSE subscription_cancel_requested_at END
        WHERE id = $1`,
      [id, nuevo, motivo]
    );
    // El trastero se liberó si este contrato lo tenía reservado.
    if (k.status !== "draft" && k.unit_status === "reserved") {
      await c.query(`UPDATE self_storage_units SET status = 'available' WHERE id = $1`, [k.storage_unit_id]);
    }
    // Facturas emitidas sin cobrar de un contrato que no llegó a empezar: se anulan.
    const { rows: pendientes } = await c.query(`SELECT id FROM self_storage_invoices WHERE contract_id = $1 AND status IN ('pending','overdue') AND stripe_invoice_id IS NULL`, [id]);
    if (pendientes.length) {
      const { rectificarEnTx } = await import("../facturas/service.ts");
      const { resolverImpagoDeFactura } = await import("../impagos/service.ts");
      for (const f of pendientes) {
        await rectificarEnTx(c, actor, f.id, `Contrato ${k.contract_number} cancelado antes de activarse`, "cancelled");
        await resolverImpagoDeFactura(c, actor, f.id, "cancelled");
      }
    }
    await auditar(c, actor, { action: "contract.cancelled", entityType: "contract", entityId: id, before: { status: k.status }, after: { status: nuevo, reason: motivo } });
    if (k.stripe_subscription_id) t.cancelarSuscripcion = k.stripe_subscription_id;
    return obtener(actor.empresaId, id, c);
  });
  return { ...r, warning: await cancelarEnStripe(t) };
}

/** Un anexo: cambio importante sobre un contrato ya firmado. Otro documento, nunca el mismo. */
export function crearAnexo(actor: Actor, id: string, texto: string) {
  return enTx(async (c) => {
    const k = await bloquearContrato(c, actor.empresaId, id);
    if (!["pending_payment", "active", "suspended"].includes(k.status)) {
      throw new ErrorSelfStorage("ANEXO_NO_PERMITIDO", "Sólo se añaden anexos a contratos firmados y vivos.", 409);
    }
    const doc = await generarDocumento(c, actor, id, "annex", exigirMotivo(texto).slice(0, 5000));
    return { documentId: doc.id, version: doc.version, sha256: doc.sha256 };
  });
}

// ── Cobro con Stripe ────────────────────────────────────────────────────────

/** Instante unix del día `d` (YYYY-MM-DD) a medianoche de Madrid, aproximado a las 00:00 UTC+1/+2. */
function unixMadrid(d: string): number {
  return Math.floor(new Date(`${d}T00:00:00+01:00`).getTime() / 1000);
}

export async function checkoutPrimerCobro(actor: Actor, id: string, urls: { successUrl: string; cancelUrl: string }) {
  const { pasarela } = await import("../../integrations/stripe/pasarela.ts");
  const { asegurarClienteStripe } = await import("../../integrations/stripe/servicios.ts");
  const k = await obtener(actor.empresaId, id);
  if (k.status !== "pending_payment") throw new ErrorSelfStorage("CONTRATO_NO_PENDIENTE_DE_PAGO", "El contrato no está pendiente del primer pago.", 409);
  if (k.collectionMethod !== "stripe") throw new ErrorSelfStorage("COBRO_MANUAL", "Este contrato se cobra por transferencia o en efectivo: registra el pago de su primera factura.", 409);
  // Sin emisor no se podrían emitir las facturas que lleguen de Stripe.
  await emisor(pool, actor.empresaId);
  const stripeCustomer = await asegurarClienteStripe(actor.empresaId, k.customerId);

  const g = pasarela();
  const productos: Record<string, { itemType: string; taxRate: number; description: string; billingItemId: string | null; recurring: boolean }> = {};
  const lineas = [];
  // `bruto`: el importe CON IVA que se cobra. Para el alquiler, el PVP firmado tal cual.
  const nuevoProducto = async (clave: string, nombre: string, meta: (typeof productos)[string], importeBase: number, cantidad: number, bruto?: number) => {
    const p = await g.crearProducto({ name: nombre, metadata: { ss_contract_id: id, ss_item_type: meta.itemType, ss_tax_rate: String(meta.taxRate) }, idempotencyKey: `ss-prod-${id}-${clave}` });
    productos[p.id] = meta;
    const conIva = bruto ?? redondear2(importeBase * (1 + meta.taxRate / 100));
    lineas.push({ productId: p.id, unitAmountCents: Math.round(conIva * 100), quantity: cantidad, recurring: meta.recurring });
  };
  await nuevoProducto("rent", `Alquiler trastero ${k.unitCode} (${k.contractNumber})`, { itemType: "rental", taxRate: k.taxRate, description: `Alquiler trastero ${k.unitCode}`, billingItemId: null, recurring: true }, k.monthlyPrice, 1, k.monthlyPriceGross);
  if (k.depositAmount > 0) {
    await nuevoProducto("deposit", `Fianza trastero ${k.unitCode}`, { itemType: "deposit", taxRate: k.depositTaxRate, description: `Fianza trastero ${k.unitCode}`, billingItemId: null, recurring: false }, k.depositAmount, 1);
  }
  for (const [i, e] of k.items.entries()) {
    await nuevoProducto(`x${i}`, e.description, { itemType: e.itemType, taxRate: e.taxRate, description: e.description, billingItemId: e.billingItemId, recurring: e.isRecurring }, e.unitPrice, e.quantity);
  }

  const hoy = hoyMadrid();
  const ancla = Number(hoy.slice(8, 10)) === k.billingDay ? null : unixMadrid(siguienteAncla(hoy, k.billingDay));
  const metadata = { ss_kind: "contract_subscription", ss_contract_id: id, ss_empresa_id: actor.empresaId };
  const s = await g.crearCheckoutSuscripcion({
    customerId: stripeCustomer,
    lineas,
    billingCycleAnchor: ancla,
    metodos: [k.paymentMethod === "sepa" ? "sepa_debit" : "card"],
    metadata,
    successUrl: urls.successUrl,
    cancelUrl: urls.cancelUrl,
    idempotencyKey: `ss-checkout-${id}-${Date.now() >> 16}`,
  });
  await enTx(async (c) => {
    await c.query(`UPDATE self_storage_contracts SET stripe_checkout_session_id = $2, stripe_products = $3 WHERE id = $1`, [id, s.id, JSON.stringify(productos)]);
    await auditar(c, actor, { action: "contract.checkout_created", entityType: "contract", entityId: id, after: { sessionId: s.id, method: k.paymentMethod } });
  });
  return { url: s.url, sessionId: s.id };
}

export const ESTADOS_VIVOS = LIVE_CONTRACT_STATUSES;
