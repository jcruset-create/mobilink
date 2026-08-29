/**
 * API de enrutado: reglas, pesos, simulador e historial de decisiones.
 *
 * Cambiar cómo se elige partner mueve dinero y trabajo, así que escribir es de
 * supervisor para arriba; leer y simular, de operador, porque es la pantalla
 * donde se contesta «por qué no salió nadie».
 *
 * El centro sale del usuario, nunca del cuerpo. Mismo `requireConnectRole` que
 * el resto de Central: no se estrena un segundo sistema de permisos.
 */

import { Router, json, type Request, type Response } from "express";

import { auditConnect, requireConnectRole } from "../connect/rbac.ts";
import {
  ErrorEnrutado,
  actualizarRegla, borrarRegla, configuracionDe, crearRegla, decisionesDe, enrutar,
  guardarModo, guardarPesos, reglasDe,
} from "./servicio.ts";
import { metricasDe } from "./metricas.ts";
import { PESOS_POR_DEFECTO } from "./dominio.ts";

function centroDe(req: Request): number | null {
  const u = req.connectUser;
  if (!u || u.role === "superadmin") return null;
  return u.controlCenterId;
}

function centroPedido(req: Request): number | null {
  const propio = centroDe(req);
  if (propio != null) return propio;
  const n = Number(req.query?.controlCenterId ?? req.body?.controlCenterId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorEnrutado) {
    return res.status(e.estado).json({ error: { code: e.codigo, message: e.message } });
  }
  console.error("[Enrutado] error:", (e as any)?.message);
  return res.status(500).json({ error: { code: "server_error", message: "Error en el enrutado" } });
}

export function createEnrutadoRouter(): Router {
  const router = Router();
  router.use(json({ limit: "512kb" }));
  router.use(requireConnectRole("operator"));

  /** Requiere un centro concreto y contesta 422 si no lo hay. */
  function conCentro(req: Request, res: Response): number | null {
    const c = centroPedido(req);
    if (c == null) {
      res.status(422).json({ error: { code: "center_required", message: "Indica la central" } });
      return null;
    }
    return c;
  }

  /* ── Configuración ─────────────────────────────────────────────────────── */

  router.get("/config", async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      const [reglas, { pesos, modo }] = await Promise.all([
        reglasDe(centro), configuracionDe(centro),
      ]);
      res.json({ pesos, modo, porDefecto: PESOS_POR_DEFECTO, reglas });
    } catch (e) { fallo(res, e); }
  });

  router.put("/config/pesos", requireConnectRole("supervisor"), async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      const pesos = await guardarPesos(centro, req.body?.pesos ?? req.body);
      await auditConnect({ req, action: "routing.weights", resourceType: "control_center", resourceId: centro, detail: pesos });
      res.json(pesos);
    } catch (e) { fallo(res, e); }
  });

  /*
   * Pasar a automático es la decisión más grande de esta pantalla: a partir de
   * ahí sale una grúa sin que nadie mire. Va con auditoría y con `cc_admin`.
   */
  router.put("/config/modo", requireConnectRole("cc_admin"), async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      const modo = await guardarModo(centro, String(req.body?.modo ?? "suggest"));
      await auditConnect({ req, action: "routing.mode", resourceType: "control_center", resourceId: centro, detail: { modo } });
      res.json({ modo });
    } catch (e) { fallo(res, e); }
  });

  /* ── Reglas ────────────────────────────────────────────────────────────── */

  router.get("/reglas", async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      res.json({ data: await reglasDe(centro) });
    } catch (e) { fallo(res, e); }
  });

  router.post("/reglas", requireConnectRole("supervisor"), async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      const r = await crearRegla(centro, req.body, req.connectUser?.id ?? null);
      await auditConnect({ req, action: "routing.rule.create", resourceType: "routing_rule", resourceId: r.id, detail: { nombre: r.nombre, accion: r.accion } });
      res.status(201).json(r);
    } catch (e) { fallo(res, e); }
  });

  router.patch("/reglas/:id", requireConnectRole("supervisor"), async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      const r = await actualizarRegla(Number(req.params.id), centro, req.body, req.connectUser?.id ?? null);
      await auditConnect({ req, action: "routing.rule.update", resourceType: "routing_rule", resourceId: r.id });
      res.json(r);
    } catch (e) { fallo(res, e); }
  });

  router.delete("/reglas/:id", requireConnectRole("supervisor"), async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      await borrarRegla(Number(req.params.id), centro);
      await auditConnect({ req, action: "routing.rule.delete", resourceType: "routing_rule", resourceId: req.params.id });
      res.json({ ok: true });
    } catch (e) { fallo(res, e); }
  });

  /* ── Simulador ─────────────────────────────────────────────────────────── */

  /*
   * No guarda la decisión: probar una regla no puede ensuciar el historial de
   * decisiones reales, o el historial deja de servir para auditar.
   */
  router.post("/simular", async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      const b = req.body ?? {};
      res.json(await enrutar(centro, {
        servicio: b.servicio ?? null, provincia: b.provincia ?? null,
        codigoPostal: b.codigoPostal ?? null, tipoVehiculo: b.tipoVehiculo ?? null,
        prioridad: b.prioridad ?? null, clienteId: b.clienteId ?? null,
        importeEstimado: b.importeEstimado ?? null, distanciaKm: b.distanciaKm ?? null,
        cuando: b.cuandoMs ? new Date(Number(b.cuandoMs)) : new Date(),
      }, { guardar: false }));
    } catch (e) { fallo(res, e); }
  });

  /* ── Métricas e historial ──────────────────────────────────────────────── */

  /*
   * Sin un solo importe: estas métricas las ve un operador, y un «coste medio
   * del partner» es justo el dato que su competencia no puede leer.
   */
  router.get("/metricas", async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      res.json({ data: [...(await metricasDe(centro)).values()] });
    } catch (e) { fallo(res, e); }
  });

  router.get("/decisiones", async (req, res) => {
    try {
      const centro = conCentro(req, res); if (centro == null) return;
      res.json({ data: await decisionesDe(centro, Number(req.query?.limit ?? 50)) });
    } catch (e) { fallo(res, e); }
  });

  return router;
}
