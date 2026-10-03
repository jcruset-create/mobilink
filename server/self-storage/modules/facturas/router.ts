import { Router, type Request } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, esUuid, idDe, ruta, validar } from "../../http.ts";
import { ajusteCambio, conMotivo, conceptoAlta, conceptoCambio, facturaBorrador, filtroFacturas, filtroPagos, pagoManual } from "../../schemas.ts";
import { urlsRetorno } from "../../shared/urls.ts";
import { pool } from "../../shared/db.ts";
import { auditar } from "../../shared/audit.ts";
import { esClaveAjuste, guardarAjuste, leerTodos } from "../../shared/settings.ts";
import { ErrorSelfStorage } from "../../errors.ts";
import * as facturas from "./service.ts";
import * as pagos from "../pagos/service.ts";
import * as impagos from "../impagos/service.ts";
import * as conceptos from "../conceptos/service.ts";
import * as stripe from "../../integrations/stripe/servicios.ts";
import { ejecutarTrabajo, TRABAJOS } from "../../jobs/scheduler.ts";

export function routerFacturacion(): Router {
  const r = Router();
  const fid = (req: Request) => idDe(req, "id", "La factura");

  // ── Facturas ──
  r.get("/invoices", exigirPermiso("ss.billing.view"), ruta(async (req, res) => {
    res.json(await facturas.listar(actorDe(req).empresaId, validar(filtroFacturas, req.query)));
  }));
  r.post("/invoices", exigirPermiso("ss.billing.manage"), ruta(async (req, res) => {
    res.status(201).json(await facturas.crearBorrador(actorDe(req), validar(facturaBorrador, req.body)));
  }));
  r.get("/invoices/:id", exigirPermiso("ss.billing.view"), ruta(async (req, res) => {
    res.json(await facturas.obtener(actorDe(req), fid(req)));
  }));
  r.post("/invoices/:id/issue", exigirPermiso("ss.billing.manage"), ruta(async (req, res) => {
    res.json(await facturas.emitirBorrador(actorDe(req), fid(req)));
  }));
  r.delete("/invoices/:id", exigirPermiso("ss.billing.manage"), ruta(async (req, res) => {
    await facturas.borrarBorrador(actorDe(req), fid(req));
    res.status(204).end();
  }));
  r.post("/invoices/:id/rectify", exigirPermiso("ss.billing.admin"), ruta(async (req, res) => {
    res.json(await facturas.rectificar(actorDe(req), fid(req), validar(conMotivo, req.body).reason));
  }));
  r.post("/invoices/:id/pay-link", exigirPermiso("ss.billing.manage"), ruta(async (req, res) => {
    res.json(await stripe.pagarFactura(actorDe(req), fid(req), urlsRetorno(`/self-storage/facturas?f=${fid(req)}`)));
  }));
  r.get("/invoices/:id/pdf", exigirPermiso("ss.billing.view"), ruta(async (req, res) => {
    const d = await facturas.pdf(actorDe(req).empresaId, fid(req));
    res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${d.nombre}"`);
    res.send(d.contenido);
  }));

  // ── Pagos ──
  r.get("/payments", exigirPermiso("ss.billing.view"), ruta(async (req, res) => {
    res.json(await pagos.listar(actorDe(req).empresaId, validar(filtroPagos, req.query)));
  }));
  r.post("/payments/manual", exigirPermiso("ss.billing.manage"), ruta(async (req, res) => {
    res.status(201).json(await pagos.registrarPagoManual(actorDe(req), validar(pagoManual, req.body)));
  }));
  r.get("/customers/:id/billing", exigirPermiso("ss.billing.view"), ruta(async (req, res) => {
    const empresa = actorDe(req).empresaId;
    const cid = idDe(req, "id", "El cliente");
    const [deuda, fs, ps] = await Promise.all([pagos.deuda(empresa, cid), facturas.listar(empresa, { customerId: cid, limit: 100 }), pagos.listar(empresa, { customerId: cid })]);
    res.json({ debt: deuda, invoices: fs.items, payments: ps });
  }));
  r.get("/customers/:id/payment-methods", exigirPermiso("ss.billing.view"), ruta(async (req, res) => {
    res.json(await stripe.metodosDePago(actorDe(req).empresaId, idDe(req, "id", "El cliente")));
  }));

  // ── Impagos ──
  r.get("/dunning", exigirPermiso("ss.billing.view"), ruta(async (req, res) => {
    const estado = typeof req.query.status === "string" && ["open", "resolved", "cancelled"].includes(req.query.status) ? req.query.status : null;
    res.json(await impagos.listarCasos(actorDe(req).empresaId, estado));
  }));

  // ── Catálogo de conceptos ──
  r.get("/billing-items", exigirPermiso("ss.billing.view"), ruta(async (req, res) => {
    res.json(await conceptos.listar(actorDe(req).empresaId));
  }));
  r.post("/billing-items", exigirPermiso("ss.billing.admin"), ruta(async (req, res) => {
    res.status(201).json(await conceptos.crear(actorDe(req), validar(conceptoAlta, req.body)));
  }));
  r.patch("/billing-items/:id", exigirPermiso("ss.billing.admin"), ruta(async (req, res) => {
    res.json(await conceptos.actualizar(actorDe(req), idDe(req, "id", "El concepto"), validar(conceptoCambio, req.body)));
  }));

  // ── Configuración ──
  r.get("/settings", exigirPermiso("ss.settings.manage"), ruta(async (req, res) => {
    const centro = esUuid(req.query.centerId) ? req.query.centerId : null;
    res.json(await leerTodos(pool, actorDe(req).empresaId, centro));
  }));
  r.put("/settings/:key", exigirPermiso("ss.settings.manage"), ruta(async (req, res) => {
    const clave = String(req.params.key);
    if (!esClaveAjuste(clave)) throw new ErrorSelfStorage("AJUSTE_DESCONOCIDO", `No existe el ajuste «${clave}».`, 404);
    const d = validar(ajusteCambio, req.body);
    const actor = actorDe(req);
    const valor = await guardarAjuste(pool, actor.empresaId, d.centerId ?? null, clave, d.value, actor.userId || null);
    await auditar(pool, actor, { action: "settings.changed", entityType: "settings", entityId: null, after: { key: clave, centerId: d.centerId ?? null, value: valor } });
    res.json({ key: clave, value: valor });
  }));

  // ── Trabajos programados (ejecución manual) ──
  r.post("/jobs/:name/run", exigirPermiso("ss.settings.manage"), ruta(async (req, res) => {
    const nombre = String(req.params.name);
    if (!(TRABAJOS as readonly string[]).includes(nombre)) throw new ErrorSelfStorage("TRABAJO_DESCONOCIDO", "Trabajo desconocido.", 404);
    res.json(await ejecutarTrabajo(nombre as (typeof TRABAJOS)[number]));
  }));

  return r;
}
