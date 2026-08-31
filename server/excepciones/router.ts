/**
 * API de la bandeja de excepciones y de los importes.
 */

import { Router, json, type RequestHandler, type Response } from "express";

import {
  ErrorExcepciones,
  aprobarDesviacion,
  bandejaDe,
  guardarImportes,
  importesDe,
} from "./servicio.ts";
import { CAJONES, ETIQUETA_CAJON } from "./dominio.ts";

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorExcepciones) {
    return res.status(e.estado).json({ error: e.message, code: e.codigo });
  }
  console.error("[Excepciones] error:", (e as any)?.message);
  return res.status(500).json({ error: "Error en la bandeja" });
}

export function createExcepcionesRouter(guarda: RequestHandler): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));
  router.use(guarda);

  router.get("/cajones", (_req, res) => {
    res.json({ data: CAJONES.map((c) => ({ valor: c, etiqueta: ETIQUETA_CAJON[c] })) });
  });

  router.get("/bandeja", async (req: any, res) => {
    try {
      const taller = req.assistPanelUser?.tallerId ?? req.query?.tallerId ?? null;
      res.json(await bandejaDe(taller == null || taller === "" ? null : String(taller)));
    } catch (e) { fallo(res, e); }
  });

  router.get("/asistencias/:id/importes", async (req, res) => {
    try {
      res.json(await importesDe(Number(req.params.id)));
    } catch (e) { fallo(res, e); }
  });

  router.patch("/asistencias/:id/importes", async (req: any, res) => {
    try {
      res.json(await guardarImportes(
        Number(req.params.id), req.body ?? {}, req.authCtx?.nombre ?? null));
    } catch (e) { fallo(res, e); }
  });

  router.post("/asistencias/:id/aprobar-desviacion", async (req: any, res) => {
    try {
      res.json(await aprobarDesviacion(Number(req.params.id), req.authCtx?.nombre ?? null));
    } catch (e) { fallo(res, e); }
  });

  return router;
}
