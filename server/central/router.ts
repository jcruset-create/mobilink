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
import { registrarAuditoria } from "../core/auditoria.ts";
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
import * as avisos from "./notifications/service.ts";
import * as clientes from "./api/clients.ts";
import * as webhooks from "./api/webhooks.ts";
import * as conciliacion from "./reconciliation/service.ts";
import { salud } from "./health.ts";
import * as kpis from "./reports/kpis.ts";
import { aCsv, importe } from "./reports/csv.ts";
import { ErrorCaja } from "../cash/errors.ts";

/** Traduce `ErrorCaja` a su código HTTP, como hace el router de la caja. */
function ruta(handler: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (e) {
      if (e instanceof ErrorCaja) {
        res.status(e.estado).json({ error: e.message, code: e.codigo });
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

  // ── A quién se avisa ─────────────────────────────────────────────────────

  r.get(
    "/channels",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const [canales, cola] = await Promise.all([
        avisos.listarCanales(empresaId),
        avisos.estadoCola(empresaId),
      ]);
      /*
       * `smtp` le dice a la pantalla si hay salida de correo. Sin ella los
       * avisos se acumulan esperando, que no es un error pero sí algo que hay
       * que poder ver: si no, alguien configura destinatarios y se queda
       * esperando correos que nunca van a salir.
       */
      res.json({ canales, cola, smtp: Boolean(process.env.SMTP_HOST) });
    })
  );

  r.post(
    "/channels",
    exigirPermiso("central.rules.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const canal = await avisos.guardarCanal(
        { empresaId: req.authCtx!.empresaId },
        {
          destino: String(b.destino ?? ""),
          ambito: typeof b.ambito === "string" ? b.ambito : "EMPRESA",
          ambitoId: typeof b.ambitoId === "string" && b.ambitoId ? b.ambitoId : null,
          tipos: Array.isArray(b.tipos) ? b.tipos.map(String) : [],
          activo: typeof b.activo === "boolean" ? b.activo : true,
        }
      );
      res.status(201).json({ canal });
    })
  );

  // ── Integraciones: clientes de API y webhooks ────────────────────────────

  r.get(
    "/integrations",
    exigirPermiso("central.rules.configure"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const [lista, hooks] = await Promise.all([
        clientes.listarClientes(empresaId),
        webhooks.listarWebhooks(empresaId),
      ]);
      res.json({ clientes: lista, webhooks: hooks, alcances: clientes.ALCANCES });
    })
  );

  /**
   * Crea un cliente de API.
   *
   * **La respuesta lleva el secreto, y es la única vez que se puede ver.** No
   * se guarda en claro: de él solo queda su huella.
   */
  r.post(
    "/api-clients",
    exigirPermiso("central.rules.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const creado = await clientes.crearCliente(
        req.authCtx!.empresaId,
        String(b.nombre ?? ""),
        Array.isArray(b.alcances) ? b.alcances.map(String) : []
      );
      res.status(201).json({
        ...creado,
        aviso: "Guarda el secreto ahora: no se puede volver a ver.",
      });
    })
  );

  r.delete(
    "/api-clients/:id",
    exigirPermiso("central.rules.configure"),
    ruta(async (req, res) => {
      await clientes.revocarCliente(req.authCtx!.empresaId, String(req.params.id));
      res.json({ ok: true });
    })
  );

  r.post(
    "/webhooks",
    exigirPermiso("central.rules.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const creado = await webhooks.crearWebhook(
        req.authCtx!.empresaId,
        String(b.url ?? ""),
        Array.isArray(b.eventos) ? b.eventos.map(String) : []
      );
      res.status(201).json({
        ...creado,
        aviso: "Guarda el secreto ahora: con él se comprueba la firma de cada envío.",
      });
    })
  );

  // ── Informes y KPIs ──────────────────────────────────────────────────────

  /** Rango por defecto: el mes corriente, que es lo que se mira el 90% de las veces. */
  function rango(req: Request): { desde: string; hasta: string } {
    const hoy = new Date().toISOString().slice(0, 10);
    const q = req.query;
    return {
      desde: typeof q.desde === "string" && q.desde ? q.desde : `${hoy.slice(0, 7)}-01`,
      hasta: typeof q.hasta === "string" && q.hasta ? q.hasta : hoy,
    };
  }

  r.get(
    "/kpis",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const { desde, hasta } = rango(req);
      const empresaId = req.authCtx!.empresaId;
      const [total, centros] = await Promise.all([
        kpis.kpis(empresaId, desde, hasta),
        kpis.porCentro(empresaId, desde, hasta),
      ]);
      res.json({ ...total, centros });
    })
  );

  /**
   * Exportación de jornadas en CSV.
   *
   * **Se recorta al ámbito de quien exporta**, igual que las pantallas: un
   * fichero descargado se reenvía, y sería la vía más fácil para que alguien
   * limitado a un taller acabara con los datos de toda la red.
   *
   * Y queda auditado: un informe con dinero que sale del sistema tiene que
   * dejar dicho quién se lo llevó y de qué periodo.
   */
  r.get(
    "/reports/sessions.csv",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      const { desde, hasta } = rango(req);
      const empresaId = req.authCtx!.empresaId;
      const ambito = req.centralCentroId ?? null;

      const filas = await kpis.jornadasParaExportar(empresaId, desde, hasta, ambito);

      const csv = aCsv(
        [
          "Fecha", "Jornada", "Caja", "Estado", "Fondo inicial",
          "Contado", "Descuadre", "Para el banco", "Conciliada",
        ],
        /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
        filas.map((f: any) => [
          String(f.fecha).slice(0, 10),
          f.session_id,
          f.caja,
          f.estado,
          importe(Number(f.fondo_inicial_centimos ?? 0)),
          importe(f.contado_centimos == null ? null : Number(f.contado_centimos)),
          importe(f.diferencia_centimos == null ? null : Number(f.diferencia_centimos)),
          importe(f.ingreso_bancario_centimos == null ? null : Number(f.ingreso_bancario_centimos)),
          f.conciliada ? "Sí" : "No",
        ])
      );

      await registrarAuditoria({
        empresaId,
        userId: req.authCtx!.userId,
        accion: "central.report.export",
        entidad: "central_sessions",
        detalle: { desde, hasta, filas: filas.length, ambitoCentroId: ambito },
        ip: req.ip,
      });

      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader(
        "content-disposition",
        `attachment; filename="jornadas-${desde}_${hasta}.csv"`
      );
      res.send(csv);
    })
  );

  // ── Estado del sistema ───────────────────────────────────────────────────

  /**
   * Qué está pasando ahora mismo.
   *
   * Con permiso de lectura, no de administración: quien atiende la bandeja de
   * incidencias tiene que poder ver si lo que falla es una caja o es que la
   * cola de eventos lleva dos días parada.
   */
  r.get(
    "/health",
    exigirPermiso("central.view"),
    ruta(async (_req, res) => {
      res.json(await salud());
    })
  );

  // ── Conciliación bancaria ────────────────────────────────────────────────

  r.get(
    "/statements",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      res.json({ extractos: await conciliacion.listarExtractos(req.authCtx!.empresaId) });
    })
  );

  /**
   * Importa un extracto en Norma 43.
   *
   * El fichero llega como texto en el cuerpo y no por `multipart`: son unos
   * pocos kilobytes de texto plano, y montar una subida de ficheros para eso
   * añadiría una pieza más que mantener sin ganar nada.
   */
  r.post(
    "/statements",
    exigirPermiso("central.incidents.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const contenido = String(b.contenido ?? "");
      if (!contenido.trim()) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", "No ha llegado ningún extracto.", 400);
      }
      const ctx = { empresaId: req.authCtx!.empresaId, userId: req.authCtx!.userId, ip: req.ip };
      const r2 = await conciliacion.importarExtracto(ctx, String(b.nombre ?? "extracto"), contenido);
      // 422 y no 400 cuando el fichero se lee pero no cuadra: la petición está
      // bien formada; lo que no vale es el contenido.
      res.status(r2.statementId ? 201 : 422).json(r2);
    })
  );

  r.get(
    "/statements/:id/matches",
    exigirPermiso("central.view"),
    ruta(async (req, res) => {
      res.json(await conciliacion.propuestas(req.authCtx!.empresaId, String(req.params.id)));
    })
  );

  r.post(
    "/statements/lines/:id/reconcile",
    exigirPermiso("central.incidents.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const ctx = { empresaId: req.authCtx!.empresaId, userId: req.authCtx!.userId, ip: req.ip };
      await conciliacion.conciliar(ctx, String(req.params.id), Number(b.depositId));
      res.json({ ok: true });
    })
  );

  r.post(
    "/statements/lines/:id/discard",
    exigirPermiso("central.incidents.manage"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const ctx = { empresaId: req.authCtx!.empresaId, userId: req.authCtx!.userId, ip: req.ip };
      await conciliacion.descartar(ctx, String(req.params.id), String(b.motivo ?? ""));
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
