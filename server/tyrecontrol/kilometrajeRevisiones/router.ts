/**
 * Km de revisiones y montajes pedidos desde la ficha del neumático
 * (`aDemanda.ts`). Solo administradores (de su empresa) o superadmin.
 */

import { Router, json, type Request, type Response } from "express";
import { resolverSolicitante } from "../conciliacion/router.ts";
import {
  ErrorKm, guardarMontaje, guardarRevision, pedirTodasDelVehiculo, proponerMontaje, proponerRevision,
  type Quien,
} from "./aDemanda.ts";

const UUID = /^[0-9a-f-]{36}$/i;

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorKm) return res.status(e.estado).json({ error: e.message });
  console.error("[km-ficha] error:", e instanceof Error ? e.message : e);
  return res.status(500).json({ error: "No se ha podido consultar el kilometraje" });
}

export function createKmFichaRouter(): Router {
  const router = Router();
  router.use(json({ limit: "8kb" }));

  router.use(async (req, res, next) => {
    try {
      const s = await resolverSolicitante(req, { exigirAdmin: true });
      if (!s) return res.status(403).json({ error: "Solo un administrador puede poner kilómetros" });
      (req as Request & { quien: Quien }).quien = { empresaPropia: s.empresaPropia, esSuperadmin: s.esSuperadmin, usuarioId: s.usuarioId };
      next();
    } catch (e) { fallo(res, e); }
  });
  const quien = (req: Request) => (req as Request & { quien: Quien }).quien;
  const origen = (v: unknown) => (v === "manual" ? "manual" : "telematica") as "manual" | "telematica";
  const id = (req: Request, res: Response, campo: string) => {
    const v = String(req.params[campo] ?? "");
    if (!UUID.test(v)) { res.status(400).json({ error: "Identificador no válido" }); return null; }
    return v;
  };

  router.post("/revision/:id/proponer", async (req, res) => {
    const r = id(req, res, "id"); if (!r) return;
    try { res.json(await proponerRevision(quien(req), r)); } catch (e) { fallo(res, e); }
  });
  router.post("/revision/:id/guardar", async (req, res) => {
    const r = id(req, res, "id"); if (!r) return;
    try { res.json(await guardarRevision(quien(req), r, { origen: origen(req.body?.origen), km: req.body?.km })); } catch (e) { fallo(res, e); }
  });
  router.post("/vehiculo/:id/todas", async (req, res) => {
    const r = id(req, res, "id"); if (!r) return;
    try { res.json(await pedirTodasDelVehiculo(quien(req), r)); } catch (e) { fallo(res, e); }
  });
  router.post("/montaje/:neumaticoId/proponer", async (req, res) => {
    const r = id(req, res, "neumaticoId"); if (!r) return;
    try { res.json(await proponerMontaje(quien(req), r)); } catch (e) { fallo(res, e); }
  });
  router.post("/montaje/:neumaticoId/guardar", async (req, res) => {
    const r = id(req, res, "neumaticoId"); if (!r) return;
    try { res.json(await guardarMontaje(quien(req), r, { origen: origen(req.body?.origen), km: req.body?.km })); } catch (e) { fallo(res, e); }
  });

  return router;
}
