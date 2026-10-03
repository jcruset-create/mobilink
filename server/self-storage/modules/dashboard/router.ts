import { Router } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, esUuid, ruta } from "../../http.ts";
import * as servicio from "./service.ts";

export function routerDashboard(): Router {
  const r = Router();
  r.get("/dashboard", exigirPermiso("ss.view"), ruta(async (req, res) => {
    res.json(await servicio.dashboard(actorDe(req), esUuid(req.query.centerId) ? req.query.centerId : null, Boolean(req.ssPermisos?.includes("ss.billing.view"))));
  }));
  return r;
}
