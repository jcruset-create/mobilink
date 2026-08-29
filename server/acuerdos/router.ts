/**
 * API de acuerdos comerciales y presupuestos.
 *
 * El centro sale SIEMPRE del usuario autenticado, nunca del cuerpo: un centro
 * que se puede mandar es un centro que se puede falsificar. La única excepción
 * es el superadministrador del hub, que ya la tenía en `backoffice.ts` y aquí
 * se limita a decir en cuál está trabajando.
 *
 * No se estrena sistema de permisos: se usa el mismo `requireConnectRole` del
 * resto de Central, con la jerarquía que ya existía.
 */

import { Router, json, type Request, type Response } from "express";

import { auditConnect, requireConnectRole } from "../connect/rbac.ts";
import {
  ErrorAcuerdo,
  actualizarAcuerdo,
  cargarAcuerdo,
  decidirPresupuesto,
  evaluarPartners,
  listarAcuerdos,
  pedirPresupuesto,
  presupuestosDe,
} from "./servicio.ts";

function centroDe(req: Request): number | null {
  const u = req.connectUser;
  if (!u || u.role === "superadmin") return null;
  return u.controlCenterId;
}

/** Cuando hace falta un centro concreto: un acuerdo «de todas» no existe. */
function centroPedido(req: Request): number | null {
  const propio = centroDe(req);
  if (propio != null) return propio;
  const pedido = req.query?.controlCenterId ?? req.body?.controlCenterId;
  const n = Number(pedido);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorAcuerdo) {
    return res.status(e.estado).json({ error: { code: e.codigo, message: e.message } });
  }
  console.error("[Acuerdos] error:", (e as any)?.message);
  return res.status(500).json({ error: { code: "server_error", message: "Error en acuerdos" } });
}

export function createAcuerdosRouter(): Router {
  const router = Router();
  router.use(json({ limit: "512kb" }));
  router.use(requireConnectRole("operator"));

  /* ── Acuerdos ──────────────────────────────────────────────────────────── */

  router.get("/", async (req, res) => {
    try {
      res.json({ data: await listarAcuerdos(centroDe(req)) });
    } catch (e) { fallo(res, e); }
  });

  router.get("/:id", async (req, res) => {
    try {
      const a = await cargarAcuerdo(Number(req.params.id), centroDe(req));
      // 404 igual si no existe que si es de otra plataforma: quien prueba ids
      // no puede averiguar cuáles existen.
      if (!a) return res.status(404).json({ error: { code: "not_found", message: "Acuerdo no encontrado" } });
      res.json(a);
    } catch (e) { fallo(res, e); }
  });

  /* Cambiar condiciones es cosa de supervisor: fija lo que se va a pagar. */
  router.patch("/:id", requireConnectRole("supervisor"), async (req, res) => {
    try {
      const id = Number(req.params.id);
      const a = await actualizarAcuerdo(id, centroDe(req), req.body ?? {}, req.connectUser?.id ?? null);
      await auditConnect({
        req, action: "agreement.update", resourceType: "provider_authorization", resourceId: id,
        detail: { campos: Object.keys(req.body ?? {}) },
      });
      res.json(a);
    } catch (e) { fallo(res, e); }
  });

  /**
   * Qué partners pueden hacerse cargo, con los motivos de los descartados.
   *
   * Es una consulta, no una decisión: quien encarga sigue siendo una persona
   * (o, en la tanda siguiente, el motor de reglas). La lógica está aquí y no
   * en la pantalla para que la respuesta sea la misma se pregunte desde donde
   * se pregunte.
   */
  router.post("/evaluar", async (req, res) => {
    try {
      const centro = centroPedido(req);
      if (centro == null) {
        return res.status(422).json({ error: { code: "center_required", message: "Indica la central" } });
      }
      const b = req.body ?? {};
      const candidatos = await evaluarPartners(centro, {
        servicio: b.servicio ?? b.serviceType ?? null,
        pais: b.pais ?? b.country ?? null,
        provincia: b.provincia ?? b.province ?? null,
        codigoPostal: b.codigoPostal ?? b.postalCode ?? null,
        distanciaKm: b.distanciaKm ?? null,
        importeEstimado: b.importeEstimado ?? null,
        cuando: b.cuandoMs ? new Date(Number(b.cuandoMs)) : new Date(),
      });
      res.json({
        aptos: candidatos.filter((c) => c.evaluacion.apto),
        descartados: candidatos.filter((c) => !c.evaluacion.apto),
      });
    } catch (e) { fallo(res, e); }
  });

  /* ── Presupuestos ──────────────────────────────────────────────────────── */

  router.get("/presupuestos/asistencia/:id", async (req, res) => {
    try {
      res.json({ data: await presupuestosDe(Number(req.params.id), centroDe(req)) });
    } catch (e) { fallo(res, e); }
  });

  router.post("/presupuestos", async (req, res) => {
    try {
      const centro = centroPedido(req);
      if (centro == null) {
        return res.status(422).json({ error: { code: "center_required", message: "Indica la central" } });
      }
      const assistanceId = Number(req.body?.assistanceId);
      if (!Number.isInteger(assistanceId) || assistanceId <= 0) {
        return res.status(422).json({ error: { code: "assistance_required", message: "Indica la asistencia" } });
      }
      const authorizationId = req.body?.authorizationId == null ? null : Number(req.body.authorizationId);
      const q = await pedirPresupuesto({
        centro, assistanceId, authorizationId,
        dispatchId: req.body?.dispatchId ?? null,
        correlationId: req.body?.correlationId ?? null,
      });
      res.status(201).json(q);
    } catch (e) { fallo(res, e); }
  });

  /* Aceptar una oferta compromete dinero: supervisor. */
  router.post("/presupuestos/:id/decidir", requireConnectRole("supervisor"), async (req, res) => {
    try {
      const aceptar = req.body?.aceptar === true;
      const q = await decidirPresupuesto(
        Number(req.params.id), centroDe(req), aceptar, req.connectUser?.id ?? null, req.body?.motivo ?? null,
      );

      /*
       * Aceptar un precio ES encargar el servicio. Si se dejara en dos pasos,
       * habría presupuestos aceptados que nadie confirmó y partners esperando
       * una llamada que no llega.
       *
       * Si la confirmación falla, el presupuesto SIGUE aceptado: la decisión
       * ya se tomó y es correcta. Lo que queda pendiente es el envío, que la
       * pantalla enseña con su error y su botón de reintentar.
       */
      let confirmacion: { ok: boolean; error?: string } | null = null;
      if (aceptar && q.dispatchId != null) {
        try {
          const { confirmarTrasPresupuesto } = await import("../dispatch/servicio.ts");
          const centro = req.connectUser?.controlCenterId;
          await confirmarTrasPresupuesto(
            Number(q.dispatchId), centro == null ? null : String(centro), "central",
          );
          confirmacion = { ok: true };
        } catch (e: any) {
          console.error("[Acuerdos] presupuesto aceptado pero no confirmado:", e?.message);
          confirmacion = { ok: false, error: e?.message ?? "No se pudo confirmar el encargo" };
        }
      }

      await auditConnect({
        req, action: aceptar ? "quote.accept" : "quote.reject",
        resourceType: "quote", resourceId: req.params.id,
        detail: { importe: q.amount, moneda: q.currency },
      });
      res.json({ ...q, confirmacion });
    } catch (e) { fallo(res, e); }
  });

  return router;
}
