/**
 * API de subcontratación a plataformas externas, desde Assist.
 *
 * Dos puertas con guardas distintos a propósito:
 *
 *  · Las rutas de gestión van con `requireSupervisorRole`, el mismo guarda que
 *    el resto del panel de Assist.
 *  · La de recepción de avisos (`/webhook`) NO lleva sesión: la llama Central,
 *    que no tiene usuario aquí. Se autentica con la firma HMAC del propio
 *    aviso, que es lo que ya hace el emisor.
 */

import crypto from "node:crypto";

import { Router, json, type RequestHandler, type Response } from "express";

import db from "../db.ts";
import {
  ErrorDespacho,
  aplicarAvisoDeCentral,
  intentarEnvio,
  listarDespachosDeAsistencia,
  subcontratarEnCentral,
} from "./servicio.ts";
import {
  ErrorDestino,
  activarDestino,
  cargarDestinoDe,
  crearDestino,
  estadoDeDestino,
  listarDestinosConEstado,
  probarConexion,
} from "./destinosServicio.ts";
import { destinoParaApi } from "./destinos.ts";

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorDespacho || e instanceof ErrorDestino) {
    return res.status(e.estado).json({ error: e.message, code: e.codigo });
  }
  console.error("[Dispatch] error:", (e as any)?.message);
  return res.status(500).json({ error: "Error en la subcontratación externa" });
}

/**
 * El taller de Assist desde el que se opera. Es el `sourceTenantId` del envío:
 * sin él, dos talleres del mismo Assist compartirían destinos y despachos.
 */
async function tenantDe(req: any): Promise<string | null> {
  /*
   * En Assist el tenant es el taller; en Central, el centro de control. Los dos
   * salen del usuario autenticado, nunca del cuerpo de la petición: un tenant
   * que se pueda mandar es un tenant que se puede falsificar.
   *
   * `tallerId` por query se sigue admitiendo solo para Assist, donde ya venía
   * de antes y el guarda de supervisor ya limita quién llega.
   */
  const t = req.connectUser?.controlCenterId
    ?? req.assistPanelUser?.tallerId
    ?? req.query?.tallerId ?? req.body?.tallerId;
  return t == null || t === "" ? null : String(t);
}

/**
 * `system` dice quién subcontrata: Assist o una Central. Cambia de qué tabla
 * sale la asistencia y de quién son los destinos, nada más — la lógica del
 * envío es la misma para los dos, que es justo lo que se buscaba al
 * generalizarla.
 */
export function createDispatchRouter(
  guardas: RequestHandler | RequestHandler[],
  system: "assist" | "central" = "assist",
): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  /* ── Recepción de avisos del destino ───────────────────────────────────── */
  /*
   * Va la primera y sin sesión: la llama Central. La firma se comprueba con el
   * secreto compartido del endpoint, con comparación en tiempo constante, y
   * con ventana de tiempo para que un aviso capturado no valga eternamente.
   */
  router.post("/webhook", async (req, res) => {
    try {
      const secreto = process.env.DISPATCH_WEBHOOK_SECRET;
      if (!secreto) {
        console.error("[Dispatch] DISPATCH_WEBHOOK_SECRET sin configurar: aviso rechazado");
        return res.status(503).json({ error: "Recepción de avisos no configurada" });
      }
      const firma = String(req.headers["x-mobilink-signature"] ?? "");
      const ts = Number(req.headers["x-mobilink-timestamp"] ?? 0);
      const cuerpo = JSON.stringify(req.body ?? {});

      if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
        return res.status(401).json({ error: "Aviso caducado o sin marca de tiempo" });
      }
      const esperada = crypto.createHmac("sha256", secreto).update(`${ts}.${cuerpo}`).digest("hex");
      const a = Buffer.from(firma, "utf8");
      const b = Buffer.from(esperada, "utf8");
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: "Firma inválida" });
      }

      const datos = (req.body?.data ?? {}) as Record<string, unknown>;
      const correlationId = String(
        (datos.correlation_id as string) ?? (datos.metadata as any)?.correlation_id ?? "",
      );
      if (!correlationId) return res.status(422).json({ error: "Falta correlation_id" });

      /*
       * Un aviso de facturación no es un cambio de estado: trae lo que la
       * plataforma nos va a cobrar. Se trata aparte porque lo que entra es un
       * importe, y porque lo que NO puede entrar —su coste interno, su
       * margen— se queda fuera al no leerse.
       */
      const tipo = String(req.body?.type ?? "");
      if (tipo === "assistance.billable" || tipo === "billing.ready") {
        const { registrarImporteDelDestino } = await import("../excepciones/servicio.ts");
        return res.json(await registrarImporteDelDestino(correlationId, {
          importe: (datos as any).amount ?? (datos as any).importe,
          concepto: (datos as any).concept ?? (datos as any).concepto,
          impuestos: (datos as any).taxes ?? (datos as any).impuestos,
          moneda: (datos as any).currency ?? (datos as any).moneda,
        }));
      }

      /*
       * Una oferta tampoco es un cambio de estado: el destino dice por cuánto
       * lo haría, no que vaya a hacerlo. Se guarda como presupuesto y espera a
       * que alguien la acepte; hasta entonces el envío sigue sin aceptar.
       */
      if (tipo === "assistance.quoted" || tipo === "quote.provided") {
        const { registrarOferta } = await import("../acuerdos/servicio.ts");
        return res.json(await registrarOferta(correlationId, {
          importe: (datos as any).amount ?? (datos as any).importe,
          moneda: (datos as any).currency ?? (datos as any).moneda,
          impuestos: (datos as any).taxes ?? (datos as any).impuestos,
          concepto: (datos as any).concept ?? (datos as any).concepto,
          etaMin: (datos as any).eta_minutes ?? (datos as any).etaMin,
          validoHastaMs: (datos as any).valid_until_ms ?? (datos as any).validoHastaMs,
        }));
      }

      const r = await aplicarAvisoDeCentral(correlationId, tipo, datos);
      // 200 aunque no se aplique: el emisor reintenta ante cualquier no-2xx, y
      // un aviso que aquí no significa nada no se arregla reintentándolo.
      res.json({ ok: true, ...r });
    } catch (e) {
      fallo(res, e);
    }
  });

  // El webhook va ANTES de los guardas: lo llama el destino, que no tiene
  // usuario aquí y se autentica con la firma del propio aviso.
  for (const g of Array.isArray(guardas) ? guardas : [guardas]) router.use(g);

  /* ── Destinos disponibles ──────────────────────────────────────────────── */
  /*
   * Devuelve además el estado GLOBAL, que es lo que decide el mensaje de la
   * pantalla. «Cero destinos» y «un destino sin credencial» llevan a sitios
   * distintos —dar de alta uno, o crear una variable en Render— y confundirlos
   * hace perder media hora buscando donde no es.
   */
  router.get("/destinos", async (req, res) => {
    try {
      res.json(await listarDestinosConEstado(await tenantDe(req), system));
    } catch (e) {
      fallo(res, e);
    }
  });

  /** Prueba de conexión real: variable de entorno → endpoint → autenticación. */
  router.post("/destinos/:id/probar", async (req: any, res) => {
    try {
      const quien = req.assistPanelUser?.nombre ?? req.authCtx?.username ?? null;
      res.json(await probarConexion(Number(req.params.id), await tenantDe(req), quien, system));
    } catch (e) {
      fallo(res, e);
    }
  });

  router.patch("/destinos/:id", async (req, res) => {
    try {
      if (typeof req.body?.active !== "boolean") {
        return res.status(422).json({ error: "Solo se puede activar o desactivar desde aquí" });
      }
      res.json(await activarDestino(Number(req.params.id), await tenantDe(req), req.body.active, system));
    } catch (e) {
      fallo(res, e);
    }
  });

  /** Historial de pruebas: distingue «está roto» de «hubo un corte». */
  router.get("/destinos/:id/comprobaciones", async (req, res) => {
    try {
      const d = await cargarDestinoDe(Number(req.params.id), await tenantDe(req), system);
      if (!d) return res.status(404).json({ error: "Destino no encontrado" });
      const r = await db.query(
        `SELECT estado, "durationMs", detail, "byUser", "checkedAtMs"
           FROM external_destination_checks WHERE "destinationId" = $1
          ORDER BY id DESC LIMIT 20`,
        [d.id],
      );
      res.json({ data: r.rows });
    } catch (e) {
      fallo(res, e);
    }
  });

  /* ── Alta de destino ───────────────────────────────────────────────────── */
  /*
   * No recibe ninguna clave: solo el NOMBRE de la variable de entorno donde
   * vive. Si alguien manda una credencial en el cuerpo se rechaza con una
   * explicación, en vez de guardarla «por comodidad».
   */
  router.post("/destinos", async (req, res) => {
    try {
      const creado = await crearDestino({
        ...req.body, ownerTenantId: await tenantDe(req), ownerSystem: system,
      });
      res.status(201).json(creado);
    } catch (e) {
      fallo(res, e);
    }
  });

  router.get("/destinos/:id", async (req, res) => {
    try {
      const d = await cargarDestinoDe(Number(req.params.id), await tenantDe(req), system);
      if (!d) return res.status(404).json({ error: "Destino no encontrado" });
      const { estado, motivos } = await estadoDeDestino(d);
      res.json(destinoParaApi(d, estado, motivos));
    } catch (e) {
      fallo(res, e);
    }
  });

  /* ── Subcontratar una asistencia ───────────────────────────────────────── */
  router.post("/asistencias/:id/subcontratar", async (req, res) => {
    try {
      const destinationId = Number(req.body?.destinationId);
      if (!Number.isInteger(destinationId) || destinationId <= 0) {
        return res.status(422).json({ error: "Indica la plataforma de destino" });
      }
      const despacho = await subcontratarEnCentral({
        system,
        assistanceId: Number(req.params.id),
        destinationId,
        tenantId: await tenantDe(req),
        referenciaCliente: req.body?.referenciaCliente ?? null,
        limiteAutorizado: req.body?.limiteAutorizado ?? null,
        incluirObservaciones: Boolean(req.body?.incluirObservaciones),
      });
      res.status(201).json(despacho);
    } catch (e) {
      fallo(res, e);
    }
  });

  /* ── Pedir precio en vez de encargar ───────────────────────────────────── */
  /*
   * Manda la petición al destino Y abre el presupuesto, con la MISMA
   * correlación. Las dos cosas juntas y no en dos llamadas del panel porque a
   * medias no significan nada: un presupuesto sin petición nadie lo va a
   * contestar, y una petición sin presupuesto no tiene dónde caer la respuesta.
   */
  router.post("/asistencias/:id/presupuesto", async (req: any, res) => {
    try {
      const destinationId = Number(req.body?.destinationId);
      if (!Number.isInteger(destinationId) || destinationId <= 0) {
        return res.status(422).json({ error: "Indica la plataforma a la que pedir precio" });
      }
      const despacho = await subcontratarEnCentral({
        system,
        assistanceId: Number(req.params.id),
        destinationId,
        tenantId: await tenantDe(req),
        referenciaCliente: req.body?.referenciaCliente ?? null,
        limiteAutorizado: req.body?.limiteAutorizado ?? null,
        soloPresupuesto: true,
      });

      /*
       * El presupuesto solo lo lleva Central: en Assist no hay cartera de
       * acuerdos donde colgarlo, y el envío ya queda registrado igual.
       */
      let presupuesto = null;
      if (system === "central") {
        const centro = await tenantDe(req);
        const { pedirPresupuesto } = await import("../acuerdos/servicio.ts");
        presupuesto = await pedirPresupuesto({
          centro: Number(centro),
          assistanceId: Number(req.params.id),
          authorizationId: req.body?.authorizationId == null ? null : Number(req.body.authorizationId),
          dispatchId: Number(despacho.id),
          correlationId: despacho.correlationId,
        });
      }
      res.status(201).json({ despacho, presupuesto });
    } catch (e) {
      fallo(res, e);
    }
  });

  router.get("/asistencias/:id/despachos", async (req, res) => {
    try {
      res.json({ data: await listarDespachosDeAsistencia(
        Number(req.params.id), system, await tenantDe(req)) });
    } catch (e) {
      fallo(res, e);
    }
  });

  /* ── Reintento manual ──────────────────────────────────────────────────── */
  router.post("/despachos/:id/reintentar", async (req, res) => {
    try {
      const d = await intentarEnvio(Number(req.params.id), {
        tenantId: await tenantDe(req), system,
      });
      res.json({
        id: Number(d.id),
        status: d.status,
        lastError: d.lastError ?? null,
        retryCount: Number(d.retryCount ?? 0),
      });
    } catch (e) {
      fallo(res, e);
    }
  });

  return router;
}
