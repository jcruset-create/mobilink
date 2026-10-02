import { Router } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, idDe, ruta, validar } from "../../http.ts";
import { centroAlta, centroCambio, zonaAlta, zonaCambio } from "../../schemas.ts";
import * as servicio from "./service.ts";

export function routerCentros(): Router {
  const r = Router();

  r.get("/centers", exigirPermiso("ss.view"), ruta(async (req, res) => {
    res.json(await servicio.listarCentros(actorDe(req)));
  }));

  r.post("/centers", exigirPermiso("ss.centers.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearCentro(actorDe(req), validar(centroAlta, req.body)));
  }));

  r.get("/centers/:id", exigirPermiso("ss.view"), ruta(async (req, res) => {
    res.json(await servicio.obtenerCentro(actorDe(req), idDe(req, "id", "El centro")));
  }));

  r.patch("/centers/:id", exigirPermiso("ss.centers.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarCentro(actorDe(req), idDe(req, "id", "El centro"), validar(centroCambio, req.body)));
  }));

  r.get("/centers/:id/zones", exigirPermiso("ss.view"), ruta(async (req, res) => {
    res.json(await servicio.listarZonas(actorDe(req), idDe(req, "id", "El centro")));
  }));

  r.post("/centers/:id/zones", exigirPermiso("ss.centers.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearZona(actorDe(req), idDe(req, "id", "El centro"), validar(zonaAlta, req.body)));
  }));

  r.patch("/zones/:id", exigirPermiso("ss.centers.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarZona(actorDe(req), idDe(req, "id", "La zona"), validar(zonaCambio, req.body)));
  }));

  return r;
}
