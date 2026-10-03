/**
 * Portal del cliente · parte financiera (fase 2).
 *
 * Ver y descargar su contrato, aceptarlo, ver y descargar sus facturas, ver
 * sus pagos, pagar lo pendiente y gestionar su método de pago. Sin puertas
 * todavía (fase 3).
 *
 * Todas las consultas filtran por el cliente de la SESIÓN. Lo que no es suyo
 * contesta 404, igual que lo que no existe.
 */

import { Router, type Request } from "express";
import { autenticarCliente, actorCliente, soloTitular } from "../../auth/customer.ts";
import { idDe, ruta, validar } from "../../http.ts";
import { aperturaEnlace, aperturaPortal, firmaContrato } from "../../schemas.ts";
import { pool } from "../../shared/db.ts";
import { evaluateAccess } from "../../domain/accesos.ts";
import { abrirPuerta } from "../accesos/apertura.ts";
import { cargarActor, cargarPuerta, type Quien } from "../accesos/contexto.ts";
import { temporalPorToken } from "../accesos/service.ts";
import { urlsRetorno } from "../../shared/urls.ts";
import { noExiste } from "../../errors.ts";
import * as contratos from "../contratos/service.ts";
import * as facturas from "../facturas/service.ts";
import * as pagos from "../pagos/service.ts";
import * as stripe from "../../integrations/stripe/servicios.ts";

const cliente = (req: Request) => req.ssCliente!;

/**
 * El cliente ve un contrato desde que se le emite (al emitir se fija la
 * versión de las condiciones). Un borrador, o uno que se canceló antes de
 * emitirse, nunca lo llegó a ver: para él no existe.
 */
const visibleParaCliente = (k: { status: string; termsVersion: string | null }) => k.status !== "draft" && k.termsVersion != null;

async function contratoPropio(req: Request) {
  const id = idDe(req, "id", "El contrato");
  const k = await contratos.obtener(cliente(req).empresaId, id).catch(() => null);
  if (!k || k.customerId !== cliente(req).customerId || !visibleParaCliente(k)) throw noExiste("El contrato");
  return k;
}

/** Lo que un cliente ve de su contrato: sin notas internas ni datos de Stripe. */
function vistaContrato(k: Awaited<ReturnType<typeof contratos.obtener>>) {
  return {
    id: k.id,
    contractNumber: k.contractNumber,
    status: k.status,
    centerName: k.centerName,
    unitCode: k.unitCode,
    zoneName: k.zoneName,
    startDate: k.startDate,
    endDate: k.endDate,
    monthlyPrice: k.monthlyPrice,
    taxRate: k.taxRate,
    monthlyPriceGross: k.monthlyPriceGross,
    depositAmount: k.depositAmount,
    billingDay: k.billingDay,
    paymentMethod: k.paymentMethod,
    signedAt: k.signedAt,
    // El primer pago se hace online (Stripe) sólo con tarjeta/SEPA; el resto, por transferencia o en el centro.
    canPayFirstOnline: k.status === "pending_payment" && k.collectionMethod === "stripe",
    firstPaymentStatus: k.firstPaymentStatus,
    items: k.items.map((i: { description: string; quantity: number; unitPrice: number; taxRate: number; isRecurring: boolean }) => ({ description: i.description, quantity: i.quantity, unitPrice: i.unitPrice, taxRate: i.taxRate, isRecurring: i.isRecurring })),
    documents: k.documents.map((d: { id: string; documentType: string; version: number; status: string; acceptedAt: string | null; sha256: string; termsVersion: string | null }) => ({ id: d.id, documentType: d.documentType, version: d.version, status: d.status, acceptedAt: d.acceptedAt, sha256: d.sha256, termsVersion: d.termsVersion })),
    invoices: k.invoices.filter((i: { status: string }) => i.status !== "draft"),
  };
}

const vistaFactura = (f: Record<string, unknown>) => ({
  id: f.id,
  invoiceNumber: f.invoiceNumber,
  issueDate: f.issueDate,
  dueDate: f.dueDate,
  periodStart: f.periodStart,
  periodEnd: f.periodEnd,
  total: f.total,
  status: f.status,
  kind: f.kind,
  contractNumber: f.contractNumber,
  amountPaid: f.amountPaid,
});

export function createPortalRouter(): Router {
  const r = Router();

  // ── Enlace de un acceso temporal (sin sesión: la identidad es el token) ──
  // El token sólo existe en el enlace; en la base, su huella. Límite de
  // frecuencia por acceso y por IP (abrirPuerta).
  r.post("/access/temporary/doors", ruta(async (req, res) => {
    const d = validar(aperturaEnlace.pick({ token: true }), req.body);
    const t = await temporalPorToken(d.token);
    if (!t) throw noExiste("El enlace");
    const { rows } = await pool.query(
      `SELECT t.full_name AS "fullName", t.starts_at AS "startsAt", t.ends_at AS "endsAt", t.max_uses AS "maxUses", t.uses_count AS "usesCount", t.status,
              coalesce((SELECT json_agg(json_build_object('id', d.id, 'name', d.name)) FROM self_storage_temporary_access_doors td
                         JOIN self_storage_doors d ON d.id = td.door_id WHERE td.temporary_access_id = t.id), '[]') AS doors
         FROM self_storage_temporary_accesses t WHERE t.id = $1`,
      [t.id]
    );
    res.json(rows[0]);
  }));
  r.post("/access/temporary/open", ruta(async (req, res) => {
    const d = validar(aperturaEnlace, req.body);
    const t = await temporalPorToken(d.token);
    if (!t) throw noExiste("El enlace");
    res.json(
      await abrirPuerta({ empresaId: t.empresaId, quien: { tipo: "temporary", temporaryAccessId: t.id }, doorId: d.doorId, method: "temporary_link", ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null })
    );
  }));

  r.use(autenticarCliente);

  /** Titular o persona autorizada: la identidad SIEMPRE de la sesión. */
  const quien = (req: Request): { empresaId: string; quien: Quien; nombre: string } =>
    req.ssCliente
      ? { empresaId: req.ssCliente.empresaId, quien: { tipo: "customer", customerId: req.ssCliente.customerId }, nombre: req.ssCliente.nombre }
      : { empresaId: req.ssMiembro!.empresaId, quien: { tipo: "member", memberId: req.ssMiembro!.memberId }, nombre: req.ssMiembro!.nombre };

  r.get("/me", ruta(async (req, res) => {
    if (req.ssMiembro) {
      const m = req.ssMiembro;
      return res.json({ kind: "member", name: m.nombre, email: m.email, status: "active", debt: null });
    }
    const c = cliente(req);
    res.json({ kind: "customer", name: c.nombre, email: c.email, status: c.status, debt: await pagos.deuda(c.empresaId, c.customerId) });
  }));

  // ── Accesos (titular y personas autorizadas) ──
  /** Puertas de sus centros con lo que diría el motor ahora (para pintar «Abrir» o el motivo). */
  r.get("/access/doors", ruta(async (req, res) => {
    const q = quien(req);
    const { rows } = await pool.query(
      `SELECT DISTINCT d.id FROM self_storage_doors d
         JOIN self_storage_contracts k ON k.center_id = d.center_id AND k.status NOT IN ('draft','cancelled')
        WHERE d.empresa_id = $1 AND d.enabled AND d.allow_app
          AND ${q.quien.tipo === "customer" ? "k.customer_id = $2" : "k.id = $2"}`,
      [q.empresaId, q.quien.tipo === "customer" ? q.quien.customerId : req.ssMiembro!.contractId]
    );
    const ahora = new Date();
    const out = [];
    for (const { id } of rows) {
      const p = await cargarPuerta(pool, q.empresaId, id);
      const a = await cargarActor(pool, q.empresaId, q.quien, p);
      if (!a) continue;
      const ev = evaluateAccess(p, a.actor, ahora, "app");
      // Puertas que no son suyas ni por zona ni por permiso: no se enseñan.
      if (ev.reason === "DOOR_NOT_ALLOWED") continue;
      out.push({ id: p.id, name: p.name, doorType: p.doorType, canOpen: ev.granted, reason: ev.reason });
    }
    res.json(out);
  }));

  r.post("/access/open", ruta(async (req, res) => {
    const d = validar(aperturaPortal, req.body);
    const q = quien(req);
    res.json(await abrirPuerta({ empresaId: q.empresaId, quien: q.quien, doorId: d.doorId, method: "app", ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null }));
  }));

  r.get("/access/events", ruta(async (req, res) => {
    const q = quien(req);
    const { rows } = await pool.query(
      `SELECT e.id, e.requested_at AS "requestedAt", d.name AS "doorName", e.method, e.decision, e.reason, e.execution_status AS "executionStatus", e.actor_name AS "actorName"
         FROM self_storage_access_events e LEFT JOIN self_storage_doors d ON d.id = e.door_id
        WHERE e.empresa_id = $1 AND ${q.quien.tipo === "customer" ? "e.customer_id = $2" : "e.contract_member_id = $2"}
        ORDER BY e.requested_at DESC LIMIT 50`,
      [q.empresaId, q.quien.tipo === "customer" ? q.quien.customerId : req.ssMiembro!.memberId]
    );
    res.json(rows);
  }));

  // Lo demás (contratos, facturas, pagos, métodos de pago): sólo el titular.
  r.use(soloTitular);

  r.get("/contracts", ruta(async (req, res) => {
    const c = cliente(req);
    const lista = await contratos.listar(c.empresaId, { customerId: c.customerId });
    res.json(
      lista
        .filter(visibleParaCliente)
        .map((k: Record<string, unknown>) => ({ id: k.id, contractNumber: k.contractNumber, status: k.status, unitCode: k.unitCode, centerName: k.centerName, startDate: k.startDate, monthlyPriceGross: k.monthlyPriceGross, pendingAmount: k.pendingAmount }))
    );
  }));

  r.get("/contracts/:id", ruta(async (req, res) => {
    res.json(vistaContrato(await contratoPropio(req)));
  }));

  r.get("/contracts/:id/documents/:docId/pdf", ruta(async (req, res) => {
    const k = await contratoPropio(req);
    const d = await contratos.descargarDocumento(cliente(req).empresaId, k.id, idDe(req, "docId", "El documento"), cliente(req).customerId);
    res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${d.nombre}"`);
    res.send(d.contenido);
  }));

  /** Aceptación del contrato (o de un anexo) por el propio cliente. */
  r.post("/contracts/:id/accept", ruta(async (req, res) => {
    const k = await contratoPropio(req);
    const d = validar(firmaContrato, req.body);
    const c = cliente(req);
    const hecho = await contratos.firmar(actorCliente(c, req.ip ?? null), k.id, {
      nombre: d.signerName,
      documentoId: d.documentId ?? null,
      ip: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
      por: "customer",
      porId: c.authUserId,
    });
    res.json(vistaContrato(hecho));
  }));

  r.post("/contracts/:id/checkout", ruta(async (req, res) => {
    const k = await contratoPropio(req);
    res.json(await contratos.checkoutPrimerCobro(actorCliente(cliente(req), req.ip ?? null), k.id, urlsRetorno(`/trasteros/portal/contratos/${k.id}`)));
  }));

  r.get("/invoices", ruta(async (req, res) => {
    const c = cliente(req);
    const { items } = await facturas.listar(c.empresaId, { customerId: c.customerId, limit: 200 });
    res.json(items.filter((f: { status: string }) => f.status !== "draft").map(vistaFactura));
  }));

  r.get("/invoices/:id/pdf", ruta(async (req, res) => {
    const c = cliente(req);
    const d = await facturas.pdf(c.empresaId, idDe(req, "id", "La factura"), c.customerId);
    res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${d.nombre}"`);
    res.send(d.contenido);
  }));

  /** Devuelve a dónde ir a pagar. El pago lo confirmará Stripe por webhook. */
  r.post("/invoices/:id/pay", ruta(async (req, res) => {
    const c = cliente(req);
    res.json(await stripe.pagarFactura(actorCliente(c, req.ip ?? null), idDe(req, "id", "La factura"), urlsRetorno("/trasteros/portal/facturas"), c.customerId));
  }));

  r.get("/payments", ruta(async (req, res) => {
    const c = cliente(req);
    const lista = await pagos.listar(c.empresaId, { customerId: c.customerId });
    res.json(lista.map((p: Record<string, unknown>) => ({ id: p.id, invoiceNumber: p.invoiceNumber, amount: p.amount, refundedAmount: p.refundedAmount, paymentMethod: p.paymentMethod, status: p.status, paidAt: p.paidAt, failureReason: p.failureReason, createdAt: p.createdAt })));
  }));

  r.get("/payment-methods", ruta(async (req, res) => {
    const c = cliente(req);
    res.json(await stripe.metodosDePago(c.empresaId, c.customerId));
  }));

  r.post("/payment-methods/setup", ruta(async (req, res) => {
    const c = cliente(req);
    res.json(await stripe.checkoutMetodo(c.empresaId, c.customerId, urlsRetorno("/trasteros/portal/pago")));
  }));

  return r;
}

