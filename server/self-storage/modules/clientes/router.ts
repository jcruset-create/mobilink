import { Router } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, idDe, ruta, validar } from "../../http.ts";
import { clienteAlta, clienteCambio, filtroClientes, telefonoAlta } from "../../schemas.ts";
import * as servicio from "./service.ts";

export function routerClientes(): Router {
  const r = Router();

  r.get("/customers", exigirPermiso("ss.customers.view"), ruta(async (req, res) => {
    res.json(await servicio.listar(actorDe(req), validar(filtroClientes, req.query)));
  }));

  r.post("/customers", exigirPermiso("ss.customers.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crear(actorDe(req), validar(clienteAlta, req.body)));
  }));

  r.get("/customers/:id", exigirPermiso("ss.customers.view"), ruta(async (req, res) => {
    res.json(await servicio.ficha(actorDe(req), idDe(req, "id", "El cliente")));
  }));

  r.patch("/customers/:id", exigirPermiso("ss.customers.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizar(actorDe(req), idDe(req, "id", "El cliente"), validar(clienteCambio, req.body)));
  }));

  r.post("/customers/:id/phones", exigirPermiso("ss.customers.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.anadirTelefono(actorDe(req), idDe(req, "id", "El cliente"), validar(telefonoAlta, req.body)));
  }));

  r.delete("/customers/:id/phones/:phoneId", exigirPermiso("ss.customers.manage"), ruta(async (req, res) => {
    res.json(await servicio.quitarTelefono(actorDe(req), idDe(req, "id", "El cliente"), idDe(req, "phoneId", "El teléfono")));
  }));

  return r;
}
