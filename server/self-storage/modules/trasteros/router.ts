import { Router, type Request } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, esUuid, idDe, ruta, validar } from "../../http.ts";
import { filtroTrasteros, tipoAlta, tipoCambio, trasteroAlta, trasteroCambio, trasteroEstado, trasteroForma } from "../../schemas.ts";
import * as servicio from "./service.ts";

/** El rol de mantenimiento ve trasteros, pero no quién los alquila. */
const verClientes = (req: Request) => Boolean(req.ssPermisos?.includes("ss.customers.view"));

export function routerTrasteros(): Router {
  const r = Router();

  r.get("/unit-types", exigirPermiso("ss.view"), ruta(async (req, res) => {
    const centerId = esUuid(req.query.centerId) ? req.query.centerId : null;
    res.json(await servicio.listarTipos(actorDe(req), centerId));
  }));

  r.post("/unit-types", exigirPermiso("ss.units.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearTipo(actorDe(req), validar(tipoAlta, req.body)));
  }));

  r.patch("/unit-types/:id", exigirPermiso("ss.units.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarTipo(actorDe(req), idDe(req, "id", "El tipo de trastero"), validar(tipoCambio, req.body)));
  }));

  r.get("/units", exigirPermiso("ss.view"), ruta(async (req, res) => {
    res.json(await servicio.listarTrasteros(actorDe(req), validar(filtroTrasteros, req.query), verClientes(req)));
  }));

  r.post("/units", exigirPermiso("ss.units.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearTrastero(actorDe(req), validar(trasteroAlta, req.body)));
  }));

  r.get("/units/:id", exigirPermiso("ss.view"), ruta(async (req, res) => {
    res.json(await servicio.obtenerTrastero(actorDe(req), idDe(req, "id", "El trastero"), verClientes(req)));
  }));

  r.patch("/units/:id", exigirPermiso("ss.units.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarTrastero(actorDe(req), idDe(req, "id", "El trastero"), validar(trasteroCambio, req.body), verClientes(req)));
  }));

  r.post("/units/:id/status", exigirPermiso("ss.units.status"), ruta(async (req, res) => {
    res.json(await servicio.cambiarEstado(actorDe(req), idDe(req, "id", "El trastero"), validar(trasteroEstado, req.body), verClientes(req)));
  }));

  r.put("/units/:id/shape", exigirPermiso("ss.floorplan.manage"), ruta(async (req, res) => {
    const { shapeId } = validar(trasteroForma, req.body);
    res.json(await servicio.vincularForma(actorDe(req), idDe(req, "id", "El trastero"), shapeId ?? null));
  }));

  return r;
}
