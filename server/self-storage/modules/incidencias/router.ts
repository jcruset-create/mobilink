import { Router } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, idDe, ruta, validar } from "../../http.ts";
import { filtroIncidencias, incidenciaAlta, incidenciaCambio } from "../../schemas.ts";
import * as servicio from "./service.ts";

/** Incidencias de Self Storage (`/incidents`). No dependen de que el Call Center esté activo. */
export function routerIncidencias(): Router {
  const r = Router();
  const id = (req: Parameters<typeof idDe>[0]) => idDe(req, "id", "La incidencia");

  r.get("/incidents", exigirPermiso("ss.incidents.view"), ruta(async (req, res) => {
    res.json(await servicio.listarIncidencias(actorDe(req).empresaId, validar(filtroIncidencias, req.query)));
  }));
  r.get("/incidents/:id", exigirPermiso("ss.incidents.view"), ruta(async (req, res) => {
    res.json(await servicio.obtenerIncidencia(actorDe(req).empresaId, id(req)));
  }));
  r.post("/incidents", exigirPermiso("ss.incidents.create"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearIncidencia(actorDe(req), validar(incidenciaAlta, req.body)));
  }));
  r.patch("/incidents/:id", exigirPermiso("ss.incidents.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarIncidencia(actorDe(req), id(req), validar(incidenciaCambio, req.body)));
  }));
  return r;
}
