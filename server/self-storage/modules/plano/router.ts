import { Router, type Request } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, idDe, ruta, validar } from "../../http.ts";
import { planoSubida } from "../../schemas.ts";
import * as servicio from "./service.ts";

const verClientes = (req: Request) => Boolean(req.ssPermisos?.includes("ss.customers.view"));

export function routerPlano(): Router {
  const r = Router();

  r.get("/centers/:id/floor-plan", exigirPermiso("ss.view"), ruta(async (req, res) => {
    res.json(await servicio.obtenerPlano(actorDe(req), idDe(req, "id", "El centro"), verClientes(req)));
  }));

  r.put("/centers/:id/floor-plan", exigirPermiso("ss.floorplan.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.subirPlano(actorDe(req), idDe(req, "id", "El centro"), validar(planoSubida, req.body)));
  }));

  return r;
}
