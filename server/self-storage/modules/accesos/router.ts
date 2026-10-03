import { Router, type Request } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, esUuid, idDe, ruta, validar } from "../../http.ts";
import {
  aperturaAdmin,
  dispositivoAlta,
  dispositivoCambio,
  filtroEventos,
  miembroAlta,
  miembroCambio,
  permisoManual,
  puertaAlta,
  puertaCambio,
  salidaAlta,
  salidaCambio,
  temporalAlta,
} from "../../schemas.ts";
import { baseApp } from "../../shared/urls.ts";
import * as servicio from "./service.ts";
import { abrirPuerta } from "./apertura.ts";

const centroDe = (req: Request) => (esUuid(req.query.centerId) ? req.query.centerId : null);

export function routerAccesos(): Router {
  const r = Router();
  const kid = (req: Request) => idDe(req, "id", "El contrato");

  // ── Dispositivos y salidas ──
  r.get("/devices", exigirPermiso("ss.doors.view"), ruta(async (req, res) => {
    res.json(await servicio.dispositivos(actorDe(req).empresaId, centroDe(req)));
  }));
  r.post("/devices", exigirPermiso("ss.devices.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearDispositivo(actorDe(req), validar(dispositivoAlta, req.body)));
  }));
  r.patch("/devices/:id", exigirPermiso("ss.devices.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarDispositivo(actorDe(req), idDe(req, "id", "El dispositivo"), validar(dispositivoCambio, req.body)));
  }));
  r.post("/devices/:id/test", exigirPermiso("ss.devices.test"), ruta(async (req, res) => {
    res.json(await servicio.probarDispositivo(actorDe(req), idDe(req, "id", "El dispositivo")));
  }));
  r.post("/devices/:id/sync", exigirPermiso("ss.devices.manage"), ruta(async (req, res) => {
    res.json(await servicio.sincronizarAhora(actorDe(req), idDe(req, "id", "El dispositivo")));
  }));
  r.post("/devices/:id/outputs", exigirPermiso("ss.devices.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearSalida(actorDe(req), idDe(req, "id", "El dispositivo"), validar(salidaAlta, req.body)));
  }));
  r.patch("/outputs/:id", exigirPermiso("ss.devices.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarSalida(actorDe(req), idDe(req, "id", "La salida"), validar(salidaCambio, req.body)));
  }));

  // ── Puertas ──
  r.get("/doors", exigirPermiso("ss.doors.view"), ruta(async (req, res) => {
    res.json(await servicio.puertas(actorDe(req).empresaId, centroDe(req)));
  }));
  r.post("/doors", exigirPermiso("ss.devices.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearPuerta(actorDe(req), validar(puertaAlta, req.body)));
  }));
  r.patch("/doors/:id", exigirPermiso("ss.devices.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarPuerta(actorDe(req), idDe(req, "id", "La puerta"), validar(puertaCambio, req.body)));
  }));
  /** Apertura administrativa: queda en los eventos (método admin) y en la auditoría. */
  r.post("/doors/:id/open", exigirPermiso("ss.access.open"), ruta(async (req, res) => {
    const actor = actorDe(req);
    const d = validar(aperturaAdmin, req.body ?? {});
    res.json(
      await abrirPuerta({
        empresaId: actor.empresaId,
        quien: { tipo: "staff", userId: actor.userId, nombre: actor.nombre },
        doorId: idDe(req, "id", "La puerta"),
        method: "admin",
        ip: req.ip ?? null,
        userAgent: req.get("user-agent") ?? null,
        adminReason: d.reason ?? null,
      })
    );
  }));

  // ── Eventos ──
  r.get("/access-events", exigirPermiso("ss.access.view"), ruta(async (req, res) => {
    res.json(await servicio.eventos(actorDe(req).empresaId, validar(filtroEventos, req.query)));
  }));

  // ── Personas autorizadas ──
  r.get("/contracts/:id/members", exigirPermiso("ss.access.view"), ruta(async (req, res) => {
    res.json(await servicio.miembros(actorDe(req).empresaId, kid(req)));
  }));
  r.post("/contracts/:id/members", exigirPermiso("ss.access.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearMiembro(actorDe(req), kid(req), validar(miembroAlta, req.body)));
  }));
  r.patch("/contracts/:id/members/:memberId", exigirPermiso("ss.access.manage"), ruta(async (req, res) => {
    res.json(await servicio.actualizarMiembro(actorDe(req), kid(req), idDe(req, "memberId", "La persona autorizada"), validar(miembroCambio, req.body)));
  }));
  r.post("/contracts/:id/members/:memberId/portal-invite", exigirPermiso("ss.access.manage"), ruta(async (req, res) => {
    res.json(await servicio.invitarMiembro(actorDe(req), kid(req), idDe(req, "memberId", "La persona autorizada"), `${baseApp()}/trasteros/portal`));
  }));

  // ── Permisos del contrato ──
  r.get("/contracts/:id/access", exigirPermiso("ss.access.view"), ruta(async (req, res) => {
    res.json(await servicio.accesosDelContrato(actorDe(req).empresaId, kid(req)));
  }));
  r.post("/contracts/:id/permissions", exigirPermiso("ss.access.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.concederPermiso(actorDe(req), kid(req), validar(permisoManual, req.body)));
  }));
  r.delete("/contracts/:id/permissions/:permId", exigirPermiso("ss.access.manage"), ruta(async (req, res) => {
    res.json(await servicio.revocarPermiso(actorDe(req), kid(req), idDe(req, "permId", "El permiso")));
  }));

  // ── Accesos temporales ──
  r.get("/temporary-accesses", exigirPermiso("ss.access.view"), ruta(async (req, res) => {
    res.json(
      await servicio.temporales(actorDe(req).empresaId, {
        contractId: esUuid(req.query.contractId) ? req.query.contractId : undefined,
        centerId: centroDe(req) ?? undefined,
        activos: req.query.active === "1",
      })
    );
  }));
  r.post("/temporary-accesses", exigirPermiso("ss.access.manage"), ruta(async (req, res) => {
    res.status(201).json(await servicio.crearTemporal(actorDe(req), validar(temporalAlta, req.body)));
  }));
  r.post("/temporary-accesses/:id/revoke", exigirPermiso("ss.access.manage"), ruta(async (req, res) => {
    res.json(await servicio.revocarTemporal(actorDe(req), idDe(req, "id", "El acceso temporal")));
  }));

  return r;
}
