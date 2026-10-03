import { Router, type Request } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, idDe, ruta, validar } from "../../http.ts";
import { anexo, conMotivo, contratoAlta, contratoCambio, filtroContratos, finalizacion, firmaContrato, suspension } from "../../schemas.ts";
import { urlsRetorno } from "../../shared/urls.ts";
import * as servicio from "./service.ts";

const esAdmin = (req: Request) => Boolean(req.ssPermisos?.includes("ss.contracts.admin"));

export function routerContratos(): Router {
  const r = Router();
  const id = (req: Request) => idDe(req, "id", "El contrato");

  r.get("/contracts", exigirPermiso("ss.contracts.view"), ruta(async (req, res) => {
    res.json(await servicio.listar(actorDe(req).empresaId, validar(filtroContratos, req.query)));
  }));
  r.post("/contracts", exigirPermiso("ss.contracts.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crear(actorDe(req), validar(contratoAlta, req.body)));
  }));
  r.get("/contracts/:id", exigirPermiso("ss.contracts.view"), ruta(async (req, res) => {
    res.json(await servicio.obtener(actorDe(req).empresaId, id(req)));
  }));
  r.patch("/contracts/:id", exigirPermiso("ss.contracts.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizar(actorDe(req), id(req), validar(contratoCambio, req.body)));
  }));
  r.get("/contracts/:id/history", exigirPermiso("ss.contracts.view"), ruta(async (req, res) => {
    res.json(await servicio.historial(actorDe(req).empresaId, id(req)));
  }));
  r.post("/contracts/:id/issue", exigirPermiso("ss.contracts.manage"), ruta(async (req, res) => {
    res.json(await servicio.emitir(actorDe(req), id(req)));
  }));
  /** Firma en presencia: el empleado registra la aceptación del cliente. */
  r.post("/contracts/:id/sign", exigirPermiso("ss.contracts.manage"), ruta(async (req, res) => {
    const d = validar(firmaContrato, req.body);
    const actor = actorDe(req);
    res.json(
      await servicio.firmar(actor, id(req), {
        nombre: d.signerName,
        documentoId: d.documentId ?? null,
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
        por: "staff",
        porId: actor.userId,
      })
    );
  }));
  r.post("/contracts/:id/checkout", exigirPermiso("ss.contracts.manage"), ruta(async (req, res) => {
    res.json(await servicio.checkoutPrimerCobro(actorDe(req), id(req), urlsRetorno(`/self-storage/contratos/${id(req)}`)));
  }));
  r.post("/contracts/:id/activate", exigirPermiso("ss.contracts.admin"), ruta(async (req, res) => {
    res.json(await servicio.activarPorExcepcion(actorDe(req), id(req), validar(conMotivo, req.body).reason));
  }));
  r.post("/contracts/:id/suspend", exigirPermiso("ss.contracts.manage"), ruta(async (req, res) => {
    const d = validar(suspension, req.body);
    res.json(await servicio.suspender(actorDe(req), id(req), d.reason, d.notes));
  }));
  r.post("/contracts/:id/blocks/:blockId/lift", exigirPermiso("ss.contracts.manage"), ruta(async (req, res) => {
    res.json(await servicio.levantarBloqueo(actorDe(req), id(req), idDe(req, "blockId", "El bloqueo"), validar(conMotivo, req.body).reason, esAdmin(req)));
  }));
  r.post("/contracts/:id/terminate", exigirPermiso("ss.contracts.admin"), ruta(async (req, res) => {
    res.json(await servicio.finalizar(actorDe(req), id(req), validar(finalizacion, req.body)));
  }));
  r.post("/contracts/:id/cancel", exigirPermiso("ss.contracts.manage"), ruta(async (req, res) => {
    res.json(await servicio.cancelar(actorDe(req), id(req), validar(conMotivo, req.body).reason));
  }));
  r.post("/contracts/:id/annexes", exigirPermiso("ss.contracts.admin"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearAnexo(actorDe(req), id(req), validar(anexo, req.body).text));
  }));
  r.get("/contracts/:id/documents/:docId/pdf", exigirPermiso("ss.contracts.view"), ruta(async (req, res) => {
    const d = await servicio.descargarDocumento(actorDe(req).empresaId, id(req), idDe(req, "docId", "El documento"));
    res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${d.nombre}"`);
    res.send(d.contenido);
  }));
  return r;
}
