/**
 * API del Call Center: `/api/self-storage/admin/call-center/*`.
 *
 * Dos llaves, en este orden:
 *   1. interruptor GLOBAL (SELF_STORAGE_CALL_CENTER_ENABLED): apagado, nada
 *      responde salvo `/status`;
 *   2. activación de la EMPRESA (ajuste `call_center.enabled`): apagada, se
 *      puede consultar el estado y preparar el catálogo, pero no operar.
 *
 * Las incidencias NO dependen de estas llaves: son de Self Storage
 * (`modules/incidencias`), el Call Center sólo las abre.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, esUuid, idDe, ruta, validar } from "../../http.ts";
import { ErrorSelfStorage } from "../../errors.ts";
import {
  catalogoAlta,
  catalogoCambio,
  filtroLlamadas,
  incidenciaAlta,
  llamadaAlta,
  llamadaCambio,
  llamadaEscalado,
  llamadaResultado,
  llamadaSeguimiento,
} from "../../schemas.ts";
import { pool } from "../../shared/db.ts";
import { leerAjuste } from "../../shared/settings.ts";
import { crearIncidencia } from "../incidencias/service.ts";
import * as cat from "./catalogo.ts";
import * as llamadas from "./service.ts";
import { identificar } from "./identificacion.ts";
import { dashboard, disponibilidad, infoCentro } from "./informes.ts";

const fecha = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const uuidQ = (v: unknown) => (esUuid(v) ? v : undefined);

/** Express no espera promesas en un middleware: se envuelve igual que las rutas. */
function llave(soloGlobal: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      try {
        const e = await llamadas.estadoCallCenter(actorDe(req).empresaId);
        if (!e.global) throw new ErrorSelfStorage("CALL_CENTER_APAGADO", "El Call Center está desactivado en este servidor.", 503);
        if (!soloGlobal && !e.empresa) throw new ErrorSelfStorage("CALL_CENTER_DESACTIVADO", "El Call Center no está activado para esta empresa.", 409);
        next();
      } catch (err) {
        const x = err instanceof ErrorSelfStorage ? err : new ErrorSelfStorage("ERROR", "Error interno del módulo Self Storage", 500);
        res.status(x.estado).json({ error: x.message, code: x.codigo });
      }
    })();
  };
}

export function routerCallCenter(): Router {
  const r = Router();
  const id = (req: Request) => idDe(req, "id", "La llamada");

  // Estado: siempre responde (para que el panel sepa qué enseñar).
  r.get("/call-center/status", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    const empresaId = actorDe(req).empresaId;
    res.json({ ...(await llamadas.estadoCallCenter(empresaId)), links: await leerAjuste(pool, empresaId, null, "call_center.links") });
  }));

  // Catálogo: con el interruptor global encendido, aunque la empresa no lo use todavía.
  r.get("/call-center/catalog", exigirPermiso("ss.callcenter.view"), llave(true), ruta(async (req, res) => {
    res.json(await cat.catalogo(actorDe(req).empresaId));
  }));
  r.post("/call-center/catalog", exigirPermiso("ss.callcenter.configure"), llave(true), ruta(async (req, res) => {
    res.status(201).json(await cat.crearEntrada(actorDe(req), validar(catalogoAlta, req.body)));
  }));
  r.patch("/call-center/catalog/:id", exigirPermiso("ss.callcenter.configure"), llave(true), ruta(async (req, res) => {
    res.json(await cat.actualizarEntrada(actorDe(req), idDe(req, "id", "La entrada del catálogo"), validar(catalogoCambio, req.body)));
  }));

  // Todo lo operativo: global Y empresa.
  r.use("/call-center", llave(false));

  r.get("/call-center/dashboard", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    res.json(await dashboard(actorDe(req).empresaId, { from: fecha(req.query.from), to: fecha(req.query.to), centerId: uuidQ(req.query.centerId) }));
  }));
  r.get("/call-center/operators", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    res.json(await llamadas.operadores(actorDe(req).empresaId, { from: fecha(req.query.from), to: fecha(req.query.to) }));
  }));
  r.get("/call-center/customer-by-phone", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    res.json(await identificar(actorDe(req), typeof req.query.phone === "string" ? req.query.phone.slice(0, 30) : null));
  }));
  r.get("/call-center/center-info", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    res.json(await infoCentro(actorDe(req).empresaId, uuidQ(req.query.centerId) ?? null));
  }));
  r.get("/call-center/availability", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    const centerId = uuidQ(req.query.centerId);
    if (!centerId) throw new ErrorSelfStorage("CENTRO_OBLIGATORIO", "Indica el centro.", 422);
    res.json(await disponibilidad(actorDe(req).empresaId, centerId));
  }));
  r.get("/call-center/events", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    res.json(
      await llamadas.eventos(actorDe(req).empresaId, {
        callId: uuidQ(req.query.callId),
        eventType: typeof req.query.eventType === "string" && /^[a-z_]{2,40}$/.test(req.query.eventType) ? req.query.eventType : undefined,
        limit: Math.min(500, Math.max(1, Number(req.query.limit) || 200)),
      })
    );
  }));

  // ── Llamadas ──
  r.get("/call-center/calls", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    res.json(await llamadas.listarLlamadas(actorDe(req).empresaId, validar(filtroLlamadas, req.query)));
  }));
  r.get("/call-center/calls/export", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    const csv = await llamadas.exportarLlamadasCsv(actorDe(req).empresaId, validar(filtroLlamadas, req.query));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="llamadas-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }));
  r.post("/call-center/calls", exigirPermiso("ss.callcenter.create"), ruta(async (req, res) => {
    res.status(201).json(await llamadas.crearLlamada(actorDe(req), validar(llamadaAlta, req.body)));
  }));
  r.get("/call-center/calls/:id", exigirPermiso("ss.callcenter.view"), ruta(async (req, res) => {
    res.json(await llamadas.obtenerLlamada(actorDe(req).empresaId, id(req)));
  }));
  r.patch("/call-center/calls/:id", exigirPermiso("ss.callcenter.edit"), ruta(async (req, res) => {
    res.json(await llamadas.actualizarLlamada(actorDe(req), id(req), validar(llamadaCambio, req.body)));
  }));
  r.post("/call-center/calls/:id/answer", exigirPermiso("ss.callcenter.edit"), ruta(async (req, res) => {
    res.json(await llamadas.contestar(actorDe(req), id(req)));
  }));
  r.post("/call-center/calls/:id/result", exigirPermiso("ss.callcenter.edit"), ruta(async (req, res) => {
    res.json(await llamadas.registrarResultado(actorDe(req), id(req), validar(llamadaResultado, req.body)));
  }));
  r.post("/call-center/calls/:id/escalate", exigirPermiso("ss.callcenter.escalate"), ruta(async (req, res) => {
    res.json(await llamadas.escalar(actorDe(req), id(req), validar(llamadaEscalado, req.body)));
  }));
  r.post("/call-center/calls/:id/follow-up", exigirPermiso("ss.callcenter.edit"), ruta(async (req, res) => {
    res.json(await llamadas.seguimiento(actorDe(req), id(req), validar(llamadaSeguimiento, req.body)));
  }));
  r.post("/call-center/calls/:id/finish", exigirPermiso("ss.callcenter.edit"), ruta(async (req, res) => {
    res.json(await llamadas.finalizar(actorDe(req), id(req)));
  }));
  r.post("/call-center/calls/:id/close", exigirPermiso("ss.callcenter.edit"), ruta(async (req, res) => {
    res.json(await llamadas.cerrar(actorDe(req), id(req)));
  }));
  /** Incidencia desde la llamada: queda enlazada a la llamada, su cliente y su contrato. */
  r.post("/call-center/calls/:id/incident", exigirPermiso("ss.incidents.create"), ruta(async (req, res) => {
    const d = validar(incidenciaAlta.omit({ callId: true }), req.body);
    res.status(201).json(await crearIncidencia(actorDe(req), { ...d, callId: id(req) }, "call"));
  }));

  return r;
}
