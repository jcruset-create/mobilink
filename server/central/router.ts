/**
 * API de MC Central: `/api/central/*`.
 *
 * Toda ruta pasa por `authenticate`, `requireModule("central")` y
 * `cargarPermisosCentral`, en una sola línea, igual que hace Mobilink Cash. La
 * empresa sale SIEMPRE de la sesión y nunca del cliente.
 *
 * Central es de lectura salvo en un sitio: la organización de la red —qué
 * taller cuelga de qué zona—, que se administra aquí porque es información de
 * la red y no de una caja. La API ya existía desde la fase 1 y vivía en el
 * módulo de caja por no tener todavía dónde ponerla; ahora tiene sitio.
 */

import { Router, type Request, type Response } from "express";
import { authenticate, requireModule } from "../core/auth.ts";
import { cargarPermisosCentral, exigirPermiso } from "./permissions.ts";
import {
  cajasEnRed,
  cajasSinCambio,
  cambioEnRed,
  descuadresPorPieza,
  ingresosEnRed,
  jornadasEnRed,
  pendienteDeIngresar,
  posicionGlobal,
  resumenRed,
  transitosAbiertos,
} from "./queries.ts";
import * as jerarquia from "../cash/hierarchy.ts";
import * as reglas from "./rules/service.ts";
import { ErrorCaja } from "../cash/errors.ts";

/** Traduce `ErrorCaja` a su código HTTP, como hace el router de la caja. */
function ruta(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e instanceof ErrorCaja) {
        res.status(e.status).json({ error: e.message, code: e.codigo });
        return;
      }
      console.error("[MC Central] error:", e);
      res.status(500).json({ error: "Error interno de MC Central" });
    }
  };
}

export function createCentralRouter(): Router {
  const r = Router();
  r.use(authenticate, requireModule("central"), cargarPermisosCentral);

  /** Todo lo que necesita la pantalla de red, en una llamada. */
  r.get(
    "/network",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const [resumen, cajas, zonas, centros] = await Promise.all([
        resumenRed(empresaId),
        cajasEnRed(empresaId),
        jerarquia.listarZonas(empresaId),
        jerarquia.listarCentros(empresaId),
      ]);
      res.json({ resumen, cajas, zonas, centros, permisos: req.centralPermisos });
    })
  );

  /**
   * La posición global de efectivo: cuánto hay en la red y dónde.
   *
   * Va junta con los tránsitos abiertos porque un total sin el desglose de qué
   * está fuera y con quién no se puede comprobar, y un número de dinero que no
   * se puede comprobar no lo usa nadie.
   */
  r.get(
    "/position",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const [posicion, transitos] = await Promise.all([
        posicionGlobal(empresaId),
        transitosAbiertos(empresaId),
      ]);
      res.json({ posicion, transitos });
    })
  );

  /**
   * El ciclo de ingresos: lo ingresado con su origen, y lo que falta por ir.
   *
   * Van juntos porque son las dos caras de lo mismo. Un listado de ingresos sin
   * lo pendiente deja fuera precisamente lo que hay que mirar: el dinero que
   * sigue en la tienda.
   */
  r.get(
    "/deposits",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const q = req.query;
      const [ingresos, pendiente] = await Promise.all([
        ingresosEnRed(empresaId, {
          centroId: typeof q.centroId === "string" ? q.centroId : null,
          registerId: typeof q.registerId === "string" ? Number(q.registerId) : null,
        }),
        pendienteDeIngresar(empresaId),
      ]);
      res.json({ ingresos, pendiente });
    })
  );

  /**
   * Cambio y arqueos de la red, pieza a pieza.
   *
   * Los tres cortes van juntos porque contestan a la misma pregunta desde
   * ángulos distintos: cuánto cambio hay, quién se está quedando sin él y en
   * qué piezas descuadra la red.
   */
  r.get(
    "/change",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const [piezas, cajas, descuadres] = await Promise.all([
        cambioEnRed(empresaId),
        cajasSinCambio(empresaId),
        descuadresPorPieza(empresaId),
      ]);
      res.json({ piezas, cajas, descuadres });
    })
  );

  r.get(
    "/sessions",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const q = req.query;
      res.json({
        jornadas: await jornadasEnRed(req.authCtx!.empresaId, {
          desde: typeof q.desde === "string" ? q.desde : undefined,
          hasta: typeof q.hasta === "string" ? q.hasta : undefined,
          centroId: typeof q.centroId === "string" ? q.centroId : null,
          soloDescuadres: q.descuadres === "1",
        }),
      });
    })
  );

  // ── Reglas e incidencias ─────────────────────────────────────────────────

  /** La bandeja y las reglas que la llenan, en una llamada. */
  r.get(
    "/alerts",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const [incidencias, lista] = await Promise.all([
        reglas.listarIncidencias(empresaId, req.query.todas !== "1"),
        reglas.listarReglas(empresaId),
      ]);
      res.json({ incidencias, reglas: lista, permisos: req.centralPermisos });
    })
  );

  /**
   * Evaluar ahora.
   *
   * Existe además del ciclo automático porque después de cambiar un umbral uno
   * quiere ver el efecto en el momento, no en el próximo cuarto de hora.
   */
  r.post(
    "/alerts/evaluate",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      res.json(await reglas.evaluar(req.authCtx!.empresaId));
    })
  );

  r.post(
    "/rules",
    exigirPermiso("central.rules.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const ctx = { empresaId: req.authCtx!.empresaId, userId: req.authCtx!.userId, ip: req.ip };
      const regla = await reglas.guardarRegla(ctx, {
        tipo: String(b.tipo ?? ""),
        ambito: String(b.ambito ?? "EMPRESA"),
        ambitoId: typeof b.ambitoId === "string" && b.ambitoId ? b.ambitoId : null,
        umbral: Number(b.umbral ?? 0),
        activa: typeof b.activa === "boolean" ? b.activa : true,
      });
      res.status(201).json({ regla });
    })
  );

  r.patch(
    "/incidents/:id",
    exigirPermiso("central.incidents.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const estado = b.estado === "RESUELTA" ? "RESUELTA" : "RECONOCIDA";
      const ctx = { empresaId: req.authCtx!.empresaId, userId: req.authCtx!.userId, ip: req.ip };
      await reglas.cambiarIncidencia(
        ctx,
        String(req.params.id),
        estado,
        typeof b.nota === "string" ? b.nota : undefined
      );
      res.json({ ok: true });
    })
  );

  // ── Organización de la red ───────────────────────────────────────────────

  r.post(
    "/zones",
    exigirPermiso("central.zones.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const ctx = { empresaId: req.authCtx!.empresaId, userId: req.authCtx!.userId, ip: req.ip };
      res.status(201).json({
        zona: await jerarquia.crearZona(ctx, typeof b.nombre === "string" ? b.nombre : ""),
      });
    })
  );

  r.patch(
    "/zones/:id",
    exigirPermiso("central.zones.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const ctx = { empresaId: req.authCtx!.empresaId, userId: req.authCtx!.userId, ip: req.ip };
      res.json({
        zona: await jerarquia.actualizarZona(ctx, String(req.params.id), {
          nombre: typeof b.nombre === "string" ? b.nombre : undefined,
          activa: typeof b.activa === "boolean" ? b.activa : undefined,
        }),
      });
    })
  );

  r.patch(
    "/centers/:id/zone",
    exigirPermiso("central.zones.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const ctx = { empresaId: req.authCtx!.empresaId, userId: req.authCtx!.userId, ip: req.ip };
      await jerarquia.asignarZonaACentro(
        ctx,
        String(req.params.id),
        typeof b.zonaId === "string" ? b.zonaId : null
      );
      res.json({ ok: true });
    })
  );

  return r;
}
