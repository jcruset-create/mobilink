/**
 * Asistente IA (PR 2) contra PostgreSQL, por HTTP, como lo usa el panel.
 *
 * Cubre: iniciar y finalizar sesión, conocimiento (y su carga inicial
 * idempotente por empresa y centro), herramienta permitida, WRITE_SAFE sólo
 * si se activa, SENSITIVE bloqueada siempre, registro de herramientas con
 * parámetros saneados, escalado IA → humano con resumen en la llamada,
 * proveedor no disponible y respaldo, guarda de precios, idioma catalán,
 * transcripciones no guardadas por defecto, interruptores, permisos,
 * multiempresa, revisión de calidad y enrutado de telefonía simulada.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
process.env.SELF_STORAGE_STORAGE_LOCAL = "1";
process.env.SELF_STORAGE_JOBS = "0";
delete process.env.OPENAI_API_KEY; // sin clave: OpenAI «no disponible»

vi.mock("../core/auth.ts", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.authCtx = {
      userId: String(req.headers["x-test-user"] ?? ""),
      username: "prueba",
      nombre: String(req.headers["x-test-nombre"] ?? "Prueba"),
      empresaId: String(req.headers["x-test-empresa"] ?? ""),
      esSuperadmin: false,
    };
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../supabase.ts", () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null }, error: new Error("x") }) } } }));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;
let ia: typeof import("./integrations/ai/index.ts");

const EA = "00000000-0000-4000-a000-0000006644a1";
const EB = "00000000-0000-4000-a000-0000006644b1";
type Quien = { usuario: string; empresa: string; nombre: string };
const adminA: Quien = { usuario: "00000000-0000-4000-a000-000000664401", empresa: EA, nombre: "Admin A" };
const operadoraA: Quien = { usuario: "00000000-0000-4000-a000-000000664403", empresa: EA, nombre: "Operadora A" };
const mantA: Quien = { usuario: "00000000-0000-4000-a000-000000664404", empresa: EA, nombre: "Mant A" };
const adminB: Quien = { usuario: "00000000-0000-4000-a000-000000664411", empresa: EB, nombre: "Admin B" };

type Respuesta = { status: number; body: any };
function api(ruta: string, q: Quien, init?: { method?: string; body?: unknown }): Promise<Respuesta> {
  return fetch(`${base}/api/self-storage/admin${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "x-test-user": q.usuario, "x-test-empresa": q.empresa, "x-test-nombre": q.nombre, "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}
async function ok(p: Promise<Respuesta>, estado = 200) {
  const r = await p;
  expect(r.status, JSON.stringify(r.body)).toBe(estado);
  return r.body;
}
const ajuste = (q: Quien, k: string, v: unknown) => ok(api(`/settings/${k}`, q, { method: "PUT", body: { value: v } }));
const decir = (q: Quien, sid: string, text: string) => ok(api(`/ai-assistant/sessions/${sid}/message`, q, { method: "POST", body: { text } }));

const GUARDAS = [
  ["self_storage_audit_logs", "self_storage_audit_logs_immutable"],
  ["self_storage_call_events", "self_storage_call_events_guard"],
  ["self_storage_ai_tool_calls", "self_storage_ai_tool_calls_guard"],
];
async function limpiar() {
  for (const [t, g] of GUARDAS) await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${g}`);
  for (const e of [EA, EB]) {
    for (const t of [
      "self_storage_ai_tool_calls",
      "self_storage_ai_messages",
      "self_storage_ai_sessions",
      "self_storage_ai_knowledge",
      "self_storage_incidents",
      "self_storage_call_events",
      "self_storage_calls",
      "self_storage_call_catalog",
      "self_storage_audit_logs",
      "self_storage_customer_phones",
      "self_storage_customers",
      "self_storage_units",
      "self_storage_unit_types",
      "self_storage_zones",
      "self_storage_settings",
      "self_storage_centers",
    ]) {
      await db.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [e]);
    }
  }
  for (const [t, g] of GUARDAS) await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${g}`);
  (await import("./modules/callcenter/catalogo.ts")).olvidarCatalogos();
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  ia = await import("./integrations/ai/index.ts");
  await db.query(`CREATE TABLE IF NOT EXISTS app_usuario_modulos (user_id UUID NOT NULL, modulo TEXT NOT NULL, rol TEXT NOT NULL, pantallas TEXT[], empresa_id UUID, centro_id UUID, UNIQUE (user_id, modulo))`);
  await db.query(`CREATE TABLE IF NOT EXISTS app_empresas (id uuid PRIMARY KEY, nombre text)`);
  await db.query(`CREATE TABLE IF NOT EXISTS app_usuarios (
    id uuid PRIMARY KEY, username text NOT NULL, nombre text NOT NULL, email_recuperacion text, telefono text,
    activo boolean NOT NULL DEFAULT true, es_superadmin boolean NOT NULL DEFAULT false, employee_id uuid, empresa_id uuid,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now())`);
  for (const [q, rol] of [[adminA, "admin"], [operadoraA, "call_center"], [mantA, "maintenance"], [adminB, "admin"]] as [Quien, string][]) {
    await db.query(`INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'self-storage',$2) ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`, [q.usuario, rol]);
  }
  const { mountSelfStorage } = await import("./index.ts");
  const app = express();
  app.use(express.json());
  mountSelfStorage(app);
  await new Promise<void>((listo) => {
    servidor = app.listen(0, () => {
      base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
      listo();
    });
  });
}, 60_000);

afterAll(async () => {
  if (!RUN) return;
  await limpiar().catch(() => {});
  await new Promise<void>((r) => servidor?.close(() => r()));
  await db?.end().catch(() => {});
});

let centro: any;

describe.skipIf(!RUN)("Self Storage · Asistente IA contra PostgreSQL", () => {
  beforeEach(async () => {
    delete process.env.SELF_STORAGE_AI_ASSISTANT_ENABLED;
    delete process.env.SELF_STORAGE_CALL_CENTER_ENABLED;
    ia.fijarProveedorIA("openai", new (await import("./integrations/ai/openai.ts")).OpenAIAdapter());
    await limpiar();
    centro = await ok(api("/centers", adminA, { method: "POST", body: { code: "REUS", name: "Reus", city: "Reus", address: "Avinguda Jaume I, 105" } }), 201);
    await ok(api("/centers", adminB, { method: "POST", body: { code: "TGN", name: "Tarragona", city: "Tarragona" } }), 201);
    await ajuste(adminA, "call_center.enabled", true);
    await ajuste(adminA, "call_center.links", { brandName: "TLC - Trasteros-Low Cost", web: "https://www.trasteros-lowcost.com", calculator: "https://www.trasteros-lowcost.com/calculadora", contracting: null, virtualVisit: null });
    await ajuste(adminA, "ai_assistant.enabled", true);
  });

  it("interruptores: el asistente se apaga sin afectar al Call Center", async () => {
    await ajuste(adminA, "ai_assistant.enabled", false);
    expect((await api("/ai-assistant/sessions", adminA, { method: "POST", body: {} })).status).toBe(409);
    // El Call Center sigue funcionando sin IA.
    await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "600111222" } }), 201);
    await ajuste(adminA, "ai_assistant.enabled", true);
    process.env.SELF_STORAGE_AI_ASSISTANT_ENABLED = "0";
    expect(await ok(api("/ai-assistant/status", adminA))).toMatchObject({ global: false, enabled: false });
    expect((await api("/ai-assistant/sessions", adminA, { method: "POST", body: {} })).status).toBe(503);
    await ok(api("/call-center/calls", operadoraA));
  });

  it("⚑ conocimiento inicial TLC: ES y CA, idempotente por empresa y por centro; editable", async () => {
    const r1 = await ok(api("/ai-assistant/knowledge/seed", adminA, { method: "POST", body: { pack: "tlc" } }));
    expect(r1).toMatchObject({ nuevas: 16, yaExistian: 0 });
    const r2 = await ok(api("/ai-assistant/knowledge/seed", adminA, { method: "POST", body: { pack: "tlc" } }));
    expect(r2).toMatchObject({ nuevas: 0, yaExistian: 16 });
    // Por centro: se cargan aparte, también una sola vez.
    expect((await ok(api("/ai-assistant/knowledge/seed", adminA, { method: "POST", body: { pack: "tlc", centerId: centro.id } }))).nuevas).toBe(16);
    expect((await ok(api("/ai-assistant/knowledge/seed", adminA, { method: "POST", body: { pack: "tlc", centerId: centro.id } }))).nuevas).toBe(0);
    const ca = await ok(api("/ai-assistant/knowledge?language=ca", adminA));
    expect(ca.length).toBe(16);
    const personal = (await ok(api("/ai-assistant/knowledge?language=es&q=personal", adminA)))[0];
    expect(personal.answer).toContain("TLC - Trasteros-Low Cost funciona con un modelo digital y no dispone de personal de atención permanente");
    // Ni precios ni disponibilidad en el conocimiento.
    const todo = JSON.stringify(await ok(api("/ai-assistant/knowledge", adminA)));
    expect(todo).not.toMatch(/\d+\s?€/);
    // Editable; y otra carga no pisa lo editado.
    await ok(api(`/ai-assistant/knowledge/${personal.id}`, adminA, { method: "PATCH", body: { answer: "Texto editado por la empresa." } }));
    await ok(api("/ai-assistant/knowledge/seed", adminA, { method: "POST", body: { pack: "tlc" } }));
    expect((await ok(api("/ai-assistant/knowledge?language=es&q=editado", adminA)))[0].answer).toBe("Texto editado por la empresa.");
    // Sin marca configurada, no se carga.
    await ajuste(adminB, "call_center.links", { brandName: null, web: null, calculator: null, contracting: null, virtualVisit: null });
    expect((await api("/ai-assistant/knowledge/seed", adminB, { method: "POST", body: { pack: "tlc" } })).status).toBe(422);
  });

  it("⚑ sesión: iniciar, consultar conocimiento (READ_ONLY), responder en catalán y finalizar sin guardar la conversación", async () => {
    await ok(api("/ai-assistant/knowledge/seed", adminA, { method: "POST", body: { pack: "tlc" } }));
    const s = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: { simulateCall: { phone: "677000111" } } }), 201);
    expect(s).toMatchObject({ provider: "mock", model: "simulado", status: "active", mode: "call" });
    expect(s.callId).toBeTruthy();
    const llamada = await ok(api(`/call-center/calls/${s.callId}`, adminA));
    expect(llamada.handledBy).toBe("ai");

    const r = await decir(adminA, s.id, "Quant costa un traster?");
    expect(r.language).toBe("ca");
    expect(r.reply).toContain("Els preus depenen de la mida");
    expect(r.reply).toContain("https://www.trasteros-lowcost.com");
    expect(r.tools).toEqual([{ tool: "obtener_base_conocimiento", outcome: "success" }]);
    const r2 = await decir(adminA, s.id, "Hi ha algú a les instal·lacions?");
    expect(r2.reply).toContain("model digital");

    // Disponibilidad: de Mobilink, en tiempo real, sin precios.
    const d = await decir(adminA, s.id, "Hi ha trasters disponibles?");
    expect(d.tools[0]).toMatchObject({ tool: "consultar_disponibilidad", outcome: "success" });
    expect(d.reply).toMatch(/no mostra disponibilitat|mostra disponibilitat/);

    const fin = await ok(api(`/ai-assistant/sessions/${s.id}/finish`, adminA, { method: "POST" }));
    expect(fin.status).toBe("finished");
    expect(fin.messages).toEqual([]); // sin «guardar transcripciones», no queda la conversación
    expect(fin.summary).toBeTruthy();
    expect(fin.turns).toBe(3);
    const ev = (await ok(api(`/call-center/calls/${s.callId}`, adminA))).events.map((e: any) => e.eventType);
    expect(ev).toEqual(expect.arrayContaining(["ai_session_started", "ai_session_finished"]));
    // Las herramientas quedan registradas.
    const logs = await ok(api(`/ai-assistant/tool-calls?sessionId=${s.id}`, adminA));
    expect(logs.map((l: any) => l.tool).sort()).toEqual(["consultar_disponibilidad", "obtener_base_conocimiento", "obtener_base_conocimiento"]);
    expect(logs.every((l: any) => l.outcome === "success" && l.risk === "READ_ONLY")).toBe(true);
    // La sesión terminada no admite más mensajes.
    expect((await api(`/ai-assistant/sessions/${s.id}/message`, adminA, { method: "POST", body: { text: "hola" } })).status).toBe(409);
  });

  it("⚑ WRITE_SAFE sólo si está activada; SENSITIVE bloqueada siempre; todo queda registrado y saneado", async () => {
    const s = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: { simulateCall: { phone: "600555444" } } }), 201);
    // crear_incidencia (WRITE_SAFE) desactivada por defecto → bloqueada y escalada.
    const r = await decir(adminA, s.id, "No puedo entrar, la puerta no abre");
    expect(r.tools).toEqual([{ tool: "crear_incidencia", outcome: "blocked", error: "Herramienta desactivada para esta empresa." }]);
    expect(r.action).toBe("escalar");
    expect((await ok(api(`/incidents?callId=${s.callId}`, adminA))).total).toBe(0);

    // Se activa (sólo un admin con ss.ai.tools.manage) y en otra sesión funciona.
    expect((await api("/ai-assistant/tools/crear_incidencia", operadoraA, { method: "PATCH", body: { active: true } })).status).toBe(403);
    expect(await ok(api("/ai-assistant/tools/crear_incidencia", adminA, { method: "PATCH", body: { active: true } }))).toMatchObject({ active: true, riesgo: "WRITE_SAFE" });
    const s2 = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: { simulateCall: { phone: "600555444" } } }), 201);
    const r2 = await decir(adminA, s2.id, "No puedo entrar, la puerta no abre");
    expect(r2.tools[0]).toMatchObject({ tool: "crear_incidencia", outcome: "success" });
    const inc = await ok(api(`/incidents?callId=${s2.callId}`, adminA));
    expect(inc.items[0]).toMatchObject({ incidentType: "no_access", priority: "urgent", source: "call" });

    // SENSITIVE: ni activándola.
    expect((await api("/ai-assistant/tools/cancelar_contrato", adminA, { method: "PATCH", body: { active: true } })).status).toBe(422);
    const r3 = await decir(adminA, s2.id, "Quiero cancelar mi contrato");
    expect(r3.tools).toEqual([{ tool: "cancelar_contrato", outcome: "blocked", error: "Operación sensible: prohibida al asistente." }]);
    expect(r3.action).toBe("escalar");

    const logs = await ok(api("/ai-assistant/tool-calls?outcome=blocked", adminA));
    expect(logs.map((l: any) => [l.tool, l.risk])).toEqual(expect.arrayContaining([["cancelar_contrato", "SENSITIVE"], ["crear_incidencia", "WRITE_SAFE"]]));
    // Parámetros saneados: sin teléfonos completos.
    const { rows } = await db.query(`SELECT params::text AS p FROM self_storage_ai_tool_calls WHERE empresa_id = $1`, [EA]);
    expect(rows.map((x: any) => x.p).join(" ")).not.toContain("600555444");
    // Y el registro no se puede tocar.
    await expect(db.query(`DELETE FROM self_storage_ai_tool_calls WHERE empresa_id = $1`, [EA])).rejects.toThrow(/sólo inserción/);
  });

  it("⚑ escalado IA → humano: la llamada queda escalada, híbrida, con el resumen; y pendiente de revisión", async () => {
    const s = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: { simulateCall: { phone: "677000222" } } }), 201);
    const r = await decir(adminA, s.id, "Quiero hablar con una persona, por favor");
    expect(r.action).toBe("escalar");
    expect(r.reply).toMatch(/persona del equipo/);
    expect(r.session).toMatchObject({ status: "escalated", escalationReason: "Quien llama pide hablar con una persona", flaggedForReview: true });
    const l = await ok(api(`/call-center/calls/${s.callId}`, operadoraA));
    expect(l).toMatchObject({ status: "escalated", requiresHuman: true, handledBy: "hybrid" });
    expect(l.escalationReason).toContain("Asistente IA");
    expect(l.summary).toBeTruthy();
    expect(l.events.find((e: any) => e.eventType === "escalated").actorType).toBe("ai");
    // Revisión de calidad por un supervisor.
    expect((await api(`/ai-assistant/sessions/${s.id}/review`, operadoraA, { method: "POST", body: { reviewStatus: "correct" } })).status).toBe(403);
    const rv = await ok(api(`/ai-assistant/sessions/${s.id}/review`, adminA, { method: "POST", body: { reviewStatus: "partial", notes: "Bien escalado, saludo mejorable" } }));
    expect(rv).toMatchObject({ reviewStatus: "partial", reviewNotes: "Bien escalado, saludo mejorable" });
    expect((await ok(api("/ai-assistant/sessions?reviewStatus=partial", adminA))).total).toBe(1);
  });

  it("⚑ proveedor no disponible: sin respaldo no arranca; con respaldo usa el respaldo; caído a mitad, respaldo o escalado", async () => {
    await ajuste(adminA, "ai_assistant.provider", "openai"); // sin OPENAI_API_KEY
    expect((await ok(api("/ai-assistant/status", adminA))).providerAvailable).toBe(false);
    const sin = await api("/ai-assistant/sessions", adminA, { method: "POST", body: {} });
    expect(sin.status).toBe(409);
    expect(sin.body.code).toBe("PROVEEDOR_NO_DISPONIBLE");
    await ajuste(adminA, "ai_assistant.fallback_provider", "mock");
    expect((await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: {} }), 201)).provider).toBe("mock");

    // Un proveedor «disponible» que falla al contestar: entra el respaldo.
    const caido = { nombre: "openai", disponible: () => true, modelo: () => "caido", decidir: async () => ({ ok: false, error: "503", modelo: "caido", duracionMs: 1 }) };
    ia.fijarProveedorIA("openai", caido as any);
    const s = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: {} }), 201);
    expect(s.provider).toBe("openai");
    const r = await decir(adminA, s.id, "Hola, ¿dónde estáis?");
    expect(r.action).toBe("responder");
    expect(r.reply).toContain("Avinguda Jaume I, 105");
    expect(r.session.flagReason).toContain("respaldo_proveedor");
    // Sin respaldo: se escala (y queda el error).
    await ajuste(adminA, "ai_assistant.fallback_provider", null);
    const s2 = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: {} }), 201);
    const r2 = await decir(adminA, s2.id, "Hola");
    expect(r2.action).toBe("escalar");
    expect(r2.session.error).toContain("503");
    expect(r2.session.flagReason).toContain("error_proveedor");
  });

  it("guarda: un precio inventado por el modelo no llega a quien llama", async () => {
    const charlatan = {
      nombre: "openai",
      disponible: () => true,
      modelo: () => "charlatan",
      decidir: async () => ({
        ok: true,
        modelo: "charlatan",
        duracionMs: 1,
        tokensEntrada: 100,
        tokensSalida: 20,
        decision: { idioma: "es", accion: "responder", respuesta: "El pequeño cuesta 45 € al mes.", herramienta: "", parametros_json: "{}", motivo_escalado: "", resumen: "Pregunta precio" },
      }),
    };
    ia.fijarProveedorIA("openai", charlatan as any);
    await ajuste(adminA, "ai_assistant.provider", "openai");
    process.env.SELF_STORAGE_AI_PRICE_INPUT_PER_MTOK = "1";
    process.env.SELF_STORAGE_AI_PRICE_OUTPUT_PER_MTOK = "4";
    const s = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: {} }), 201);
    const r = await decir(adminA, s.id, "¿Cuánto cuesta?");
    expect(r.reply).not.toMatch(/45/);
    expect(r.reply).toContain("https://www.trasteros-lowcost.com");
    expect(r.session.flagReason).toContain("posible_precio_inventado");
    expect(r.session).toMatchObject({ inputTokens: 100, outputTokens: 20, costEstimate: 0.0002 });
    delete process.env.SELF_STORAGE_AI_PRICE_INPUT_PER_MTOK;
    delete process.env.SELF_STORAGE_AI_PRICE_OUTPUT_PER_MTOK;
  });

  it("⚑ acceso no autorizado y multiempresa: permisos por rol; B no ve nada de A", async () => {
    const s = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: {} }), 201);
    // Mantenimiento no tiene el asistente.
    expect((await api("/ai-assistant/sessions", mantA)).status).toBe(403);
    // La operadora usa la consola y ve sesiones, pero no configura ni carga conocimiento ni ve logs.
    await ok(api("/ai-assistant/sessions", operadoraA));
    expect((await api("/ai-assistant/knowledge/seed", operadoraA, { method: "POST", body: { pack: "tlc" } })).status).toBe(403);
    expect((await api("/ai-assistant/knowledge", operadoraA, { method: "POST", body: { category: "x_y", question: "q", answer: "a" } })).status).toBe(403);
    expect((await api("/ai-assistant/tool-calls", operadoraA)).status).toBe(403);
    expect((await api("/settings/ai_assistant.provider", operadoraA, { method: "PUT", body: { value: "openai" } })).status).toBe(403);
    // Otra empresa: 404.
    await ajuste(adminB, "ai_assistant.enabled", true);
    expect((await api(`/ai-assistant/sessions/${s.id}`, adminB)).status).toBe(404);
    expect((await api(`/ai-assistant/sessions/${s.id}/message`, adminB, { method: "POST", body: { text: "hola" } })).status).toBe(404);
    expect((await ok(api("/ai-assistant/sessions", adminB))).total).toBe(0);
    // Ni puede colgar su sesión de una llamada de A.
    const l = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "600000003" } }), 201);
    await ajuste(adminB, "call_center.enabled", true);
    expect((await api("/ai-assistant/sessions", adminB, { method: "POST", body: { callId: l.id } })).status).toBe(404);
  });

  it("dashboard IA y conversación guardada cuando la empresa lo activa", async () => {
    await ajuste(adminA, "ai_assistant.store_transcripts", true);
    await ok(api("/ai-assistant/knowledge/seed", adminA, { method: "POST", body: { pack: "tlc" } }));
    const s = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: {} }), 201);
    await decir(adminA, s.id, "No sé qué tamaño necesito");
    const fin = await ok(api(`/ai-assistant/sessions/${s.id}/finish`, adminA, { method: "POST" }));
    expect(fin.messages.map((m: any) => m.role)).toEqual(["user", "tool", "assistant"]);
    const s2 = await ok(api("/ai-assistant/sessions", adminA, { method: "POST", body: {} }), 201);
    await decir(adminA, s2.id, "Necesito hablar con una persona");
    const d = await ok(api("/ai-assistant/dashboard", adminA));
    expect(d.kpis).toMatchObject({ sessions: 2, finished: 1, escalated: 1, resolutionPct: 50 });
    expect(d.herramientas.find((h: any) => h.tool === "obtener_base_conocimiento").calls).toBe(1);
    expect(d.porProveedor[0]).toMatchObject({ provider: "mock", model: "simulado", sessions: 2 });
  });

  it("telefonía simulada → Call Center → IA o humano según el modo; un webhook repetido no duplica", async () => {
    const { llamadaEntrante } = await import("./modules/callcenter/enrutado.ts");
    const { proveedorTelefonia } = await import("./integrations/telephony/index.ts");
    const tel = proveedorTelefonia("mock")!;
    expect(tel.verificarFirma({ "x-mock-signature": "x" }, "", "")).toBe(false); // sin secreto, nada vale
    const r = await llamadaEntrante(EA, tel, { callId: "CA-1", from: "+34677000999", to: "+34977000000" });
    expect(r).toMatchObject({ handledBy: "hybrid", nueva: true });
    expect(r.sessionId).toBeTruthy();
    const otra = await llamadaEntrante(EA, tel, { callId: "CA-1", from: "+34677000999", to: "+34977000000" });
    expect(otra).toMatchObject({ callId: r.callId, nueva: false });
    // Con la IA apagada, la atiende una persona.
    await ajuste(adminA, "ai_assistant.enabled", false);
    const h = await llamadaEntrante(EA, tel, { callId: "CA-2", from: "+34677000998", to: "+34977000000" });
    expect(h).toMatchObject({ handledBy: "human", sessionId: null });
    const l = await ok(api(`/call-center/calls/${h.callId}`, adminA));
    expect(l).toMatchObject({ telephonyProvider: "mock", externalCallId: "CA-2" });
  });
});
