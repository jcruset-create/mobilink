import { Router } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, idDe, ruta, validar } from "../../http.ts";
import { importacionAlta } from "../../schemas.ts";
import * as servicio from "./service.ts";

export function routerImportacion(): Router {
  const r = Router();

  /** Dry-run: valida y guarda la vista previa. No crea ni cambia trasteros. */
  r.post("/centers/:id/imports", exigirPermiso("ss.import"), ruta(async (req, res) => {
    res.status(201).json(await servicio.validar(actorDe(req), idDe(req, "id", "El centro"), validar(importacionAlta, req.body)));
  }));

  r.get("/centers/:id/imports", exigirPermiso("ss.import"), ruta(async (req, res) => {
    res.json(await servicio.listar(actorDe(req), idDe(req, "id", "El centro")));
  }));

  r.get("/imports/:id", exigirPermiso("ss.import"), ruta(async (req, res) => {
    res.json(await servicio.obtener(actorDe(req), idDe(req, "id", "La importación")));
  }));

  /** Confirmación: aplica, en una transacción, lo que la vista previa decidió. */
  r.post("/imports/:id/apply", exigirPermiso("ss.import"), ruta(async (req, res) => {
    res.json(await servicio.aplicar(actorDe(req), idDe(req, "id", "La importación")));
  }));

  return r;
}
