/**
 * API del correo del expediente.
 *
 * No es un cliente de correo: no hay bandeja de entrada general ni carpetas.
 * Lo que hay es el hilo de UNA asistencia y los botones para pedir lo que
 * falta. El correo es parte del expediente, no una aplicación aparte.
 */

import { Router, json, type RequestHandler, type Response } from "express";

import db from "../db.ts";
import {
  ErrorCorreo,
  enviarCorreo,
  enviarRecordatoriosPendientes,
  hiloDe,
  procesarEntrante,
  sinClasificar,
  type Sistema,
} from "./servicio.ts";
import { MOTIVOS } from "./plantillas.ts";

function fallo(res: Response, e: unknown) {
  if (e instanceof ErrorCorreo) {
    return res.status(e.estado).json({ error: e.message, code: e.codigo });
  }
  console.error("[Correo] error:", (e as any)?.message);
  return res.status(500).json({ error: "Error en el correo del expediente" });
}

export function createCorreoRouter(system: Sistema, guarda: RequestHandler): Router {
  const router = Router();
  router.use(json({ limit: "2mb" }));
  router.use(guarda);

  router.get("/motivos", (_req, res) => res.json({ data: MOTIVOS }));

  router.get("/asistencias/:id/hilo", async (req, res) => {
    try {
      res.json({ data: await hiloDe(system, req.params.id) });
    } catch (e) { fallo(res, e); }
  });

  router.post("/asistencias/:id/enviar", async (req: any, res) => {
    try {
      const datos = await datosDe(system, req.params.id);
      if (!datos) return res.status(404).json({ error: "Asistencia no encontrada" });
      const r = await enviarCorreo({
        system,
        tenantId: req.assistPanelUser?.tallerId ?? null,
        assistanceId: req.params.id,
        motivo: req.body?.motivo,
        para: req.body?.para,
        datos: { ...datos, remitente: req.authCtx?.nombre ?? null },
      });
      // 200 aunque el envío falle: el mensaje SÍ está en el expediente, y el
      // panel tiene que poder enseñar por qué no salió.
      res.json(r);
    } catch (e) { fallo(res, e); }
  });

  /** Los entrantes que no se han podido enganchar. Es una bandeja de trabajo. */
  router.get("/sin-clasificar", async (_req, res) => {
    try {
      res.json({ data: await sinClasificar() });
    } catch (e) { fallo(res, e); }
  });

  /**
   * Asigna a mano un entrante que el sistema no supo enganchar.
   *
   * Hace falta: siempre habrá quien conteste desde otra dirección y con el
   * asunto reescrito, y ese correo puede llevar el albarán que falta.
   */
  router.post("/sin-clasificar/:uuid/asignar", async (req, res) => {
    try {
      const assistanceId = String(req.body?.assistanceId ?? "").trim();
      if (!assistanceId) return res.status(422).json({ error: "Indica la asistencia" });
      const r = await db.query(
        `UPDATE assistance_messages
            SET "assistanceId" = $2, "sourceSystem" = $3
          WHERE uuid = $1 AND direccion = 'entrante' AND "assistanceId" IS NULL
          RETURNING uuid`,
        [req.params.uuid, assistanceId, system],
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Mensaje no encontrado o ya asignado" });
      res.json({ ok: true });
    } catch (e) { fallo(res, e); }
  });

  /** Fuerza una pasada del worker, para poder probarlo sin esperar. */
  router.post("/recordatorios/procesar", async (_req, res) => {
    try {
      res.json({ enviados: await enviarRecordatoriosPendientes() });
    } catch (e) { fallo(res, e); }
  });

  /**
   * Entrada de correo por webhook, para los proveedores de correo que empujan
   * en vez de esperar a que se lea el buzón (SendGrid, Mailgun…).
   *
   * Sin sesión a propósito, con un secreto compartido en la ruta: quien lo
   * llama es una máquina de fuera que no tiene usuario aquí.
   */
  router.post("/entrante/:secreto", async (req, res) => {
    try {
      const esperado = process.env.CORREO_ENTRANTE_SECRETO;
      if (!esperado || req.params.secreto !== esperado) {
        return res.status(401).json({ error: "No autorizado" });
      }
      res.json(await procesarEntrante(req.body ?? {}));
    } catch (e) { fallo(res, e); }
  });

  return router;
}

async function datosDe(system: Sistema, id: string) {
  if (system === "assist") {
    const r = await db.query(
      `SELECT id, plate, address, "finishedAtMs", "descripcionAveria"
         FROM roadside_assistances WHERE id = $1`, [Number(id)]);
    const a = r.rows[0];
    if (!a) return null;
    return {
      expediente: `AST-${a.id}`,
      matricula: a.plate || null,
      direccion: a.address || null,
      fechaServicio: a.finishedAtMs != null ? Number(a.finishedAtMs) : null,
      descripcion: a.descripcionAveria || null,
    };
  }
  const r = await db.query(
    `SELECT id, "expedientNumber", address, description FROM connect_assistances WHERE id = $1`,
    [Number(id)]);
  const a = r.rows[0];
  if (!a) return null;
  return {
    expediente: a.expedientNumber ?? `AS-${a.id}`,
    direccion: a.address || null,
    descripcion: a.description || null,
  };
}
