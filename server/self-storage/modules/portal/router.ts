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
import { autenticarCliente, actorCliente } from "../../auth/customer.ts";
import { idDe, ruta, validar } from "../../http.ts";
import { firmaContrato } from "../../schemas.ts";
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
  r.use(autenticarCliente);

  r.get("/me", ruta(async (req, res) => {
    const c = cliente(req);
    res.json({ name: c.nombre, email: c.email, status: c.status, debt: await pagos.deuda(c.empresaId, c.customerId) });
  }));

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

