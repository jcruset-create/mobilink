/**
 * API del Asistente IA: `/api/self-storage/admin/ai-assistant/*`.
 *
 * Independiente del Call Center: apagado el asistente, el Call Center sigue.
 * Con el interruptor global (SELF_STORAGE_AI_ASSISTANT_ENABLED) apagado sólo
 * responde `/status`; sin activar en la empresa se puede preparar (conocimiento,
 * herramientas, proveedores) pero no conversar.
 *
 * Las herramientas NO tienen endpoint: sólo las ejecuta el motor, en el
 * servidor, con sus comprobaciones.
 */

import { Router, type Request } from "express";
import { exigirPermiso } from "../../auth/permissions.ts";
import { actorDe, esUuid, idDe, ruta, validar } from "../../http.ts";
import { ErrorSelfStorage } from "../../errors.ts";
import { pool } from "../../shared/db.ts";
import { guardarAjuste, leerAjuste } from "../../shared/settings.ts";
import { REGLAS_OBLIGATORIAS } from "../../domain/asistente.ts";
import { estadoProveedoresIA, PROVEEDORES_IA } from "../../integrations/ai/index.ts";
import { PROVEEDORES_VOZ, proveedorVoz } from "../../integrations/voice/index.ts";
import { PROVEEDORES_TELEFONIA } from "../../integrations/telephony/index.ts";
import {
  conocimientoAlta,
  conocimientoCambio,
  conocimientoInicial,
  filtroSesiones,
  herramientaCambio,
  sesionAlta,
  sesionEscalado,
  sesionMensaje,
  sesionRevision,
} from "../../schemas.ts";
import * as conocimiento from "./conocimiento.ts";
import { CATALOGO, catalogoEfectivo } from "./herramientas.ts";
import * as motor from "./motor.ts";
import { dashboardIA, logsHerramientas } from "./informes.ts";

const fecha = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const texto = (v: unknown, re: RegExp) => (typeof v === "string" && re.test(v) ? v : undefined);

export function routerAsistente(): Router {
  const r = Router();
  const sid = (req: Request) => idDe(req, "id", "La sesión");
  const global = async (req: Request) => {
    const e = await motor.estadoAsistente(actorDe(req).empresaId);
    if (!e.global) throw new ErrorSelfStorage("ASISTENTE_APAGADO", "El Asistente IA está desactivado en este servidor.", 503);
    return e;
  };

  r.get("/ai-assistant/status", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    res.json(await motor.estadoAsistente(actorDe(req).empresaId));
  }));

  r.get("/ai-assistant/dashboard", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    await global(req);
    res.json(await dashboardIA(actorDe(req).empresaId, { from: fecha(req.query.from), to: fecha(req.query.to) }));
  }));

  // ── Proveedores (sin secretos: sólo si hay clave, no cuál) ──
  r.get("/ai-assistant/providers", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    const empresaId = actorDe(req).empresaId;
    res.json({
      ai: estadoProveedoresIA(),
      voice: PROVEEDORES_VOZ.map((n) => ({ nombre: n, disponible: Boolean(proveedorVoz(n)?.disponible()) })),
      telephony: PROVEEDORES_TELEFONIA.map((n) => ({ nombre: n, conectado: false })),
      selected: {
        provider: await leerAjuste(pool, empresaId, null, "ai_assistant.provider"),
        fallbackProvider: await leerAjuste(pool, empresaId, null, "ai_assistant.fallback_provider"),
        voiceProvider: await leerAjuste(pool, empresaId, null, "ai_assistant.voice_provider"),
        telephonyProvider: await leerAjuste(pool, empresaId, null, "ai_assistant.telephony_provider"),
      },
      available: { ai: PROVEEDORES_IA, voice: PROVEEDORES_VOZ, telephony: PROVEEDORES_TELEFONIA },
    });
  }));

  // ── Reglas: las obligatorias (fijas) y las de la empresa ──
  r.get("/ai-assistant/rules", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    res.json({ mandatory: REGLAS_OBLIGATORIAS, extra: await leerAjuste(pool, actorDe(req).empresaId, null, "ai_assistant.extra_rules") });
  }));

  // ── Herramientas ──
  r.get("/ai-assistant/tools", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    res.json(await catalogoEfectivo(actorDe(req).empresaId));
  }));
  r.patch("/ai-assistant/tools/:name", exigirPermiso("ss.ai.tools.manage"), ruta(async (req, res) => {
    const actor = actorDe(req);
    const nombre = String(req.params.name);
    const d = CATALOGO.find((x) => x.nombre === nombre);
    if (!d) throw new ErrorSelfStorage("NO_EXISTE", "La herramienta no existe.", 404);
    if (d.riesgo === "SENSITIVE") throw new ErrorSelfStorage("HERRAMIENTA_SENSIBLE", "Las herramientas sensibles están bloqueadas en esta versión.", 422);
    const cambio = validar(herramientaCambio, req.body);
    const actual = await leerAjuste(pool, actor.empresaId, null, "ai_assistant.tools");
    const efectiva = (await catalogoEfectivo(actor.empresaId)).find((x) => x.nombre === nombre)!;
    const nueva = { ...actual, [nombre]: { active: cambio.active ?? efectiva.active, requiresConfirmation: cambio.requiresConfirmation ?? efectiva.requiresConfirmation } };
    await guardarAjuste(pool, actor.empresaId, null, "ai_assistant.tools", nueva, actor.userId || null);
    const { auditar } = await import("../../shared/audit.ts");
    await auditar(pool, actor, { action: "ai_tool.updated", entityType: "ai_tool", entityId: null, before: { [nombre]: actual[nombre] ?? null }, after: { [nombre]: nueva[nombre] } });
    res.json((await catalogoEfectivo(actor.empresaId)).find((x) => x.nombre === nombre));
  }));

  // ── Base de conocimiento ──
  r.get("/ai-assistant/knowledge", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    res.json(
      await conocimiento.listar(actorDe(req).empresaId, {
        language: texto(req.query.language, /^[a-z]{2}$/),
        category: texto(req.query.category, /^[a-z][a-z0-9_]{1,39}$/),
        centerId: esUuid(req.query.centerId) ? req.query.centerId : undefined,
        q: typeof req.query.q === "string" ? req.query.q.slice(0, 100) : undefined,
      })
    );
  }));
  r.post("/ai-assistant/knowledge", exigirPermiso("ss.ai.knowledge.manage"), ruta(async (req, res) => {
    res.status(201).json(await conocimiento.crear(actorDe(req), validar(conocimientoAlta, req.body)));
  }));
  r.patch("/ai-assistant/knowledge/:id", exigirPermiso("ss.ai.knowledge.manage"), ruta(async (req, res) => {
    res.json(await conocimiento.actualizar(actorDe(req), idDe(req, "id", "La entrada de conocimiento"), validar(conocimientoCambio, req.body)));
  }));
  r.delete("/ai-assistant/knowledge/:id", exigirPermiso("ss.ai.knowledge.manage"), ruta(async (req, res) => {
    await conocimiento.borrar(actorDe(req), idDe(req, "id", "La entrada de conocimiento"));
    res.json({ ok: true });
  }));
  r.post("/ai-assistant/knowledge/seed", exigirPermiso("ss.ai.knowledge.manage"), ruta(async (req, res) => {
    res.json(await conocimiento.cargarInicial(actorDe(req), validar(conocimientoInicial, req.body)));
  }));

  // ── Sesiones (consola de prueba y llamadas) ──
  r.get("/ai-assistant/sessions", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    res.json(await motor.listarSesiones(actorDe(req).empresaId, validar(filtroSesiones, req.query)));
  }));
  r.get("/ai-assistant/sessions/:id", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    res.json(await motor.obtenerSesion(actorDe(req).empresaId, sid(req)));
  }));
  r.post("/ai-assistant/sessions", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    res.status(201).json(await motor.iniciarSesion(actorDe(req), validar(sesionAlta, req.body)));
  }));
  r.post("/ai-assistant/sessions/:id/message", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    const d = validar(sesionMensaje, req.body);
    res.json(await motor.mensaje(actorDe(req), req.ssPermisos ?? [], sid(req), d.text));
  }));
  r.post("/ai-assistant/sessions/:id/finish", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    res.json(await motor.finalizarSesion(actorDe(req), sid(req)));
  }));
  r.post("/ai-assistant/sessions/:id/escalate", exigirPermiso("ss.ai.view"), ruta(async (req, res) => {
    const d = validar(sesionEscalado, req.body);
    await motor.escalarSesion(actorDe(req), sid(req), d.reason);
    res.json(await motor.obtenerSesion(actorDe(req).empresaId, sid(req)));
  }));
  r.post("/ai-assistant/sessions/:id/review", exigirPermiso("ss.ai.review"), ruta(async (req, res) => {
    res.json(await motor.revisarSesion(actorDe(req), sid(req), validar(sesionRevision, req.body)));
  }));

  // ── Logs ──
  r.get("/ai-assistant/tool-calls", exigirPermiso("ss.ai.logs.view"), ruta(async (req, res) => {
    res.json(
      await logsHerramientas(actorDe(req).empresaId, {
        outcome: texto(req.query.outcome, /^(success|error|blocked)$/),
        tool: texto(req.query.tool, /^[a-z][a-z0-9_]{1,59}$/),
        sessionId: esUuid(req.query.sessionId) ? req.query.sessionId : undefined,
        limit: Math.min(500, Math.max(1, Number(req.query.limit) || 200)),
      })
    );
  }));

  return r;
}
