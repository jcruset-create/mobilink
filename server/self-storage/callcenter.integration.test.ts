/**
 * Call Center (PR 1) contra PostgreSQL, por HTTP, como lo usa el panel.
 *
 * Cubre: alta y fin de llamada, identificación por teléfono (cliente,
 * persona autorizada, interesado), resultado y estados, escalado,
 * seguimiento, incidencias (urgentes por tipo), filtros, informes y CSV,
 * permisos por rol (call_center con mínimo privilegio), multiempresa,
 * empresa elegida por el superadministrador, interruptor global y por
 * empresa, catálogo idempotente y transcripciones desactivadas por defecto.
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

vi.mock("../core/auth.ts", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.authCtx = {
      userId: String(req.headers["x-test-user"] ?? ""),
      username: "prueba",
      nombre: String(req.headers["x-test-nombre"] ?? "Prueba"),
      empresaId: String(req.headers["x-test-empresa"] ?? ""),
      esSuperadmin: req.headers["x-test-super"] === "1",
    };
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../supabase.ts", () => ({ supabase: { auth: { getUser: async () => ({ data: { user: null }, error: new Error("x") }) } } }));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;

const EA = "00000000-0000-4000-a000-0000005544a1";
const EB = "00000000-0000-4000-a000-0000005544b1";
const ES = "00000000-0000-4000-a000-0000005544c1"; // la del superadministrador
type Quien = { usuario: string; empresa: string; nombre: string; super?: boolean };
const adminA: Quien = { usuario: "00000000-0000-4000-a000-000000554401", empresa: EA, nombre: "Admin A" };
const empleadoA: Quien = { usuario: "00000000-0000-4000-a000-000000554402", empresa: EA, nombre: "Empleado A" };
const operadoraA: Quien = { usuario: "00000000-0000-4000-a000-000000554403", empresa: EA, nombre: "Operadora A" };
const mantA: Quien = { usuario: "00000000-0000-4000-a000-000000554404", empresa: EA, nombre: "Mantenimiento A" };
const sinRolA: Quien = { usuario: "00000000-0000-4000-a000-000000554405", empresa: EA, nombre: "Sin rol" };
const adminB: Quien = { usuario: "00000000-0000-4000-a000-000000554411", empresa: EB, nombre: "Admin B" };
const superU: Quien = { usuario: "00000000-0000-4000-a000-000000554421", empresa: ES, nombre: "Súper", super: true };

type Respuesta = { status: number; body: any; text?: string };
function api(ruta: string, q: Quien, init?: { method?: string; body?: unknown; empresa?: string }): Promise<Respuesta> {
  return fetch(`${base}/api/self-storage/admin${ruta}`, {
    method: init?.method ?? "GET",
    headers: {
      "x-test-user": q.usuario,
      "x-test-empresa": q.empresa,
      "x-test-nombre": q.nombre,
      ...(q.super ? { "x-test-super": "1" } : {}),
      ...(init?.empresa ? { "X-SS-Empresa": init.empresa } : {}),
      "Content-Type": "application/json",
    },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => {
    const text = await r.text();
    let body: any;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }
    return { status: r.status, body, text };
  });
}
async function ok(p: Promise<Respuesta>, estado = 200) {
  const r = await p;
  expect(r.status, JSON.stringify(r.body)).toBe(estado);
  return r.body;
}
const activar = (q: Quien, on = true) => ok(api("/settings/call_center.enabled", q, { method: "PUT", body: { value: on } }));

const GUARDAS = [
  ["self_storage_audit_logs", "self_storage_audit_logs_immutable"],
  ["self_storage_call_events", "self_storage_call_events_guard"],
  ["self_storage_contract_documents", "self_storage_contract_documents_guard"],
  ["self_storage_invoices", "self_storage_invoices_guard"],
  ["self_storage_invoice_items", "self_storage_invoice_items_guard"],
];
async function limpiar() {
  for (const [t, g] of GUARDAS) await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${g}`);
  for (const e of [EA, EB, ES]) {
    await db.query(`DELETE FROM self_storage_invoice_items WHERE invoice_id IN (SELECT id FROM self_storage_invoices WHERE empresa_id = $1)`, [e]);
    for (const t of [
      "self_storage_incidents",
      "self_storage_call_events",
      "self_storage_calls",
      "self_storage_call_catalog",
      "self_storage_audit_logs",
      "self_storage_contract_members",
      "self_storage_payments",
      "self_storage_invoices",
      "self_storage_contract_documents",
      "self_storage_contract_items",
      "self_storage_contracts",
      "self_storage_billing_items",
      "self_storage_sequences",
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
  // Lo mínimo de la plataforma que usa el módulo (en producción ya existe).
  await db.query(`CREATE TABLE IF NOT EXISTS app_usuario_modulos (user_id UUID NOT NULL, modulo TEXT NOT NULL, rol TEXT NOT NULL, pantallas TEXT[], empresa_id UUID, centro_id UUID, UNIQUE (user_id, modulo))`);
  await db.query(`CREATE TABLE IF NOT EXISTS app_empresas (id uuid PRIMARY KEY, nombre text)`);
  await db.query(`CREATE TABLE IF NOT EXISTS app_usuarios (id uuid PRIMARY KEY, username text NOT NULL, nombre text NOT NULL, activo boolean NOT NULL DEFAULT true, es_superadmin boolean NOT NULL DEFAULT false, empresa_id uuid)`);
  await db.query(`DO $$ BEGIN
    IF to_regprocedure('app_licencia_activa(uuid,text)') IS NULL THEN
      EXECUTE 'CREATE FUNCTION app_licencia_activa(p_empresa uuid, p_modulo text) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT true $f$';
    END IF; END $$`);
  for (const [id, nombre] of [[EA, "Empresa A (Trasteros)"], [EB, "Empresa B"], [ES, "Mobilink"]]) {
    await db.query(`INSERT INTO app_empresas (id, nombre) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`, [id, nombre]);
  }
  for (const [q, rol] of [[adminA, "admin"], [empleadoA, "employee"], [operadoraA, "call_center"], [mantA, "maintenance"], [adminB, "admin"]] as [Quien, string][]) {
    await db.query(`INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'self-storage',$2) ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`, [q.usuario, rol]);
    await db.query(`INSERT INTO app_usuarios (id, username, nombre, empresa_id) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`, [q.usuario, q.usuario.slice(-6), q.nombre, q.empresa]);
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

let centro: any, centroB: any;
let ana: any;

describe.skipIf(!RUN)("Self Storage · Call Center contra PostgreSQL", () => {
  beforeEach(async () => {
    delete process.env.SELF_STORAGE_CALL_CENTER_ENABLED;
    await limpiar();
    centro = await ok(api("/centers", adminA, { method: "POST", body: { code: "REUS", name: "Reus", city: "Reus", address: "Avinguda Jaume I, 105" } }), 201);
    centroB = await ok(api("/centers", adminB, { method: "POST", body: { code: "TGN", name: "Tarragona", city: "Tarragona" } }), 201);
    ana = await ok(
      api("/customers", adminA, {
        method: "POST",
        body: { customerType: "individual", firstName: "Ana", lastName: "Prueba", taxId: "12345678Z", phone: "600111222", email: "ana@example.com", address: "Calle 1", city: "Reus", postalCode: "43201" },
      }),
      201
    );
    await activar(adminA);
  });

  it("interruptores: global por entorno (kill switch) y activación por empresa", async () => {
    // B no lo ha activado: estado visible, operación no.
    expect((await ok(api("/call-center/status", adminB))).enabled).toBe(false);
    expect((await api("/call-center/calls", adminB)).status).toBe(409);
    // A sí.
    expect((await ok(api("/call-center/status", adminA))).enabled).toBe(true);
    await ok(api("/call-center/calls", adminA));
    // Kill switch global: nadie opera, aunque la empresa lo tenga activado.
    process.env.SELF_STORAGE_CALL_CENTER_ENABLED = "0";
    const st = await ok(api("/call-center/status", adminA));
    expect(st).toMatchObject({ global: false, empresa: true, enabled: false });
    expect((await api("/call-center/calls", adminA)).status).toBe(503);
    expect((await api("/call-center/calls", adminA, { method: "POST", body: { phone: "600999888" } })).status).toBe(503);
    // Las incidencias son de Self Storage: no dependen del Call Center.
    await ok(api("/incidents", adminA));
  });

  it("⚑ alta, identificación por teléfono (cliente / interesado), resultado y fin; catálogo creado una sola vez", async () => {
    // Cliente existente: se identifica y se vincula solo.
    const id = await ok(api("/call-center/customer-by-phone?phone=600%20111%20222", operadoraA));
    expect(id.interested).toBe(false);
    expect(id.matches).toHaveLength(1);
    expect(id.matches[0]).toMatchObject({ customerId: ana.id, name: "Ana Prueba", match: "customer", accessBlocked: false, hasPendingPayments: false });
    // Ficha mínima: sin importes ni datos personales de más.
    expect(JSON.stringify(id.matches[0])).not.toMatch(/taxId|12345678Z|address|email|pendiente|total/);

    const l = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "600111222", reasonCode: "facturacion", language: "ca" } }), 201);
    expect(l).toMatchObject({ customerId: ana.id, centerId: centro.id, status: "in_progress", handledBy: "human", operatorUserId: operadoraA.usuario, language: "ca", phone: "+34600111222" });
    expect(l.events.map((e: any) => e.eventType)).toEqual(["created", "answered"]);

    // Interesado: nadie con ese número. NO se crea cliente.
    const antes = (await db.query(`SELECT count(*)::int AS n FROM self_storage_customers WHERE empresa_id = $1`, [EA])).rows[0].n;
    const i = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "+34 677 000 111", callerName: "Pere", reasonCode: "precio_disponibilidad" } }), 201);
    expect(i.customerId).toBeNull();
    expect((await db.query(`SELECT count(*)::int AS n FROM self_storage_customers WHERE empresa_id = $1`, [EA])).rows[0].n).toBe(antes);
    expect((await ok(api("/call-center/customer-by-phone?phone=677000111", operadoraA))).interested).toBe(true);

    // Resultado «enviado a la web»: cierra la llamada, con fin y duración.
    const r = await ok(api(`/call-center/calls/${i.id}/result`, operadoraA, { method: "POST", body: { resultCode: "enviado_web", summary: "Pregunta precio de 5 m². Se le envía a la web." } }));
    expect(r).toMatchObject({ status: "closed", resultCode: "enviado_web", summary: "Pregunta precio de 5 m². Se le envía a la web." });
    expect(r.endedAt).toBeTruthy();
    expect(r.durationSeconds).toBeGreaterThanOrEqual(0);
    // Cerrada no se reabre.
    expect((await api(`/call-center/calls/${i.id}`, operadoraA, { method: "PATCH", body: { notes: "x" } })).status).toBe(409);

    // Finalizar sin resultado: queda «finalizada».
    const f = await ok(api(`/call-center/calls/${l.id}/finish`, operadoraA, { method: "POST" }));
    expect(f.status).toBe("finished");

    // El catálogo de partida existe una vez, aunque se pida varias.
    await ok(api("/call-center/catalog", adminA));
    await ok(api("/call-center/catalog", adminA));
    const { rows } = await db.query(`SELECT kind, count(*)::int AS n FROM self_storage_call_catalog WHERE empresa_id = $1 GROUP BY kind ORDER BY kind`, [EA]);
    expect(rows).toEqual([{ kind: "reason", n: 15 }, { kind: "result", n: 10 }]);
    // La consulta por teléfono queda en la auditoría (con el número enmascarado).
    const aud = (await db.query(`SELECT after FROM self_storage_audit_logs WHERE empresa_id = $1 AND action = 'call_center.customer_lookup' ORDER BY occurred_at`, [EA])).rows;
    expect(aud.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(aud)).not.toContain("600111222");
  });

  it("persona autorizada: se identifica por su teléfono como «persona autorizada» de la clienta", async () => {
    await ok(api("/settings/billing.issuer", adminA, { method: "PUT", body: { value: { name: "Trasteros SL", taxId: "B12345674", address: "Av. Principal 1, Reus" } } }));
    const zona = await ok(api(`/centers/${centro.id}/zones`, adminA, { method: "POST", body: { code: "Z1", name: "Zona 1" } }), 201);
    const t = await ok(api("/units", adminA, { method: "POST", body: { centerId: centro.id, zoneId: zona.id, code: "A1", widthCm: 150, lengthCm: 200, heightCm: 250, monthlyPriceGross: 60, depositAmount: 0 } }), 201);
    const k = await ok(api("/contracts", empleadoA, { method: "POST", body: { customerId: ana.id, unitId: t.id, startDate: "2026-10-01", billingDay: 1, paymentMethod: "bank_transfer" } }), 201);
    await ok(api(`/contracts/${k.id}/issue`, empleadoA, { method: "POST", body: {} }));
    await ok(api(`/contracts/${k.id}/members`, adminA, { method: "POST", body: { fullName: "María Autorizada", phone: "699123123", allowPhone: true } }), 201);
    const r = await ok(api("/call-center/customer-by-phone?phone=699123123", operadoraA));
    expect(r.interested).toBe(false);
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ customerId: ana.id, match: "authorized_person", matchedPersonName: "María Autorizada" });
    // Sus contratos, de forma limitada: número, estado, trastero y centro. Sin importes.
    expect(Object.keys(r.matches[0].contracts[0]).sort()).toEqual(["centerId", "centerName", "contractNumber", "id", "startDate", "status", "unitCode", "zoneName"]);
  });

  it("resultados con seguimiento y escalado; seguimiento hecho cierra la llamada", async () => {
    const l = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "677000222", reasonCode: "visita_guiada" } }), 201);
    const v = await ok(api(`/call-center/calls/${l.id}/result`, operadoraA, { method: "POST", body: { resultCode: "visita_guiada_solicitada" } }));
    expect(v.status).toBe("follow_up");
    expect(new Date(v.followUpAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect((await ok(api("/call-center/calls?pendingFollowUp=1", operadoraA))).items.map((x: any) => x.id)).toContain(l.id);
    const hecho = await ok(api(`/call-center/calls/${l.id}/follow-up`, operadoraA, { method: "POST", body: { done: true, notes: "Visita confirmada por email" } }));
    expect(hecho).toMatchObject({ status: "closed" });
    expect(hecho.followUpDoneAt).toBeTruthy();

    // Escalar: pide humano, guarda motivo y resumen, sube la prioridad.
    const e = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "600111222", reasonCode: "reclamacion" } }), 201);
    expect(e.priority).toBe("high"); // la reclamación sube la prioridad por defecto
    const esc = await ok(api(`/call-center/calls/${e.id}/escalate`, operadoraA, { method: "POST", body: { reason: "Reclamación compleja sobre una factura", summary: "Cliente molesto por un cargo duplicado." } }));
    expect(esc).toMatchObject({ status: "escalated", requiresHuman: true, escalationReason: "Reclamación compleja sobre una factura", summary: "Cliente molesto por un cargo duplicado." });
    expect(esc.events.map((x: any) => x.eventType)).toContain("escalated");
    // El resultado «escalado» también escala.
    const e2 = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "677000333" } }), 201);
    expect((await ok(api(`/call-center/calls/${e2.id}/result`, operadoraA, { method: "POST", body: { resultCode: "escalado_tlc" } }))).status).toBe("escalated");
    // Un resultado desactivado no se puede usar.
    const cat = await ok(api("/call-center/catalog", adminA));
    const noRes = cat.find((x: any) => x.kind === "result" && x.code === "no_resuelto");
    await ok(api(`/call-center/catalog/${noRes.id}`, adminA, { method: "PATCH", body: { active: false } }));
    const e3 = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "677000444" } }), 201);
    expect((await api(`/call-center/calls/${e3.id}/result`, operadoraA, { method: "POST", body: { resultCode: "no_resuelto" } })).status).toBe(422);
    // Un motivo propio de la empresa.
    await ok(api("/call-center/catalog", adminA, { method: "POST", body: { kind: "reason", code: "mudanza", label: "Mudanza" } }), 201);
    expect((await api("/call-center/catalog", adminA, { method: "POST", body: { kind: "reason", code: "mudanza", label: "Otra" } })).status).toBe(409);
  });

  it("⚑ incidencia desde la llamada: enlazada a llamada, cliente y centro; las de acceso y seguridad son urgentes", async () => {
    const l = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "600111222", reasonCode: "acceso" } }), 201);
    const n = await ok(
      api(`/call-center/calls/${l.id}/incident`, operadoraA, { method: "POST", body: { centerId: centro.id, incidentType: "no_access", priority: "normal", title: "No puede entrar", description: "La app da error" } }),
      201
    );
    expect(n).toMatchObject({ callId: l.id, customerId: ana.id, centerId: centro.id, priority: "urgent", status: "open", source: "call", incidentType: "no_access" });
    const tras = await ok(api(`/call-center/calls/${l.id}`, operadoraA));
    expect(tras.priority).toBe("urgent");
    expect(tras.incidents.map((x: any) => x.id)).toEqual([n.id]);
    expect(tras.events.map((x: any) => x.eventType)).toContain("incident_created");
    // Ni la base deja bajarla.
    expect((await api(`/incidents/${n.id}`, adminA, { method: "PATCH", body: { priority: "normal" } })).status).toBe(422);
    await expect(db.query(`UPDATE self_storage_incidents SET priority = 'normal' WHERE id = $1`, [n.id])).rejects.toThrow();
    // Una de facturación es normal salvo que se pida otra cosa.
    const fact = await ok(api("/incidents", empleadoA, { method: "POST", body: { centerId: centro.id, incidentType: "billing", title: "Factura duplicada" } }), 201);
    expect(fact.priority).toBe("normal");
    // Resolver exige resolución; mantenimiento gestiona, la operadora no.
    expect((await api(`/incidents/${n.id}`, mantA, { method: "PATCH", body: { status: "resolved" } })).status).toBe(422);
    const res = await ok(api(`/incidents/${n.id}`, mantA, { method: "PATCH", body: { status: "resolved", resolution: "Lector reiniciado" } }));
    expect(res.resolvedAt).toBeTruthy();
    expect((await api(`/incidents/${fact.id}`, operadoraA, { method: "PATCH", body: { status: "closed" } })).status).toBe(403);
    // Auditoría de la incidencia.
    const aud = (await db.query(`SELECT action FROM self_storage_audit_logs WHERE entity_id = $1 ORDER BY occurred_at`, [n.id])).rows.map((r: any) => r.action);
    expect(aud).toEqual(["incident.created", "incident.updated"]);
  });

  it("⚑ permisos: la operadora (call_center) atiende, pero no ve precios, contratos ni configuración; sin rol, nada", async () => {
    const b = await ok(api("/bootstrap", operadoraA));
    expect(b.rol).toBe("call_center");
    expect(b.permisos).toEqual(expect.arrayContaining(["ss.callcenter.view", "ss.callcenter.create", "ss.incidents.create"]));
    expect(b.permisos).not.toContain("ss.view");
    for (const ruta of ["/units", "/customers", "/contracts", "/invoices", "/payments", "/settings", "/audit"]) {
      expect((await api(ruta, operadoraA)).status, ruta).toBe(403);
    }
    expect((await api(`/customers/${ana.id}`, operadoraA)).status).toBe(403);
    expect((await api("/settings/call_center.enabled", operadoraA, { method: "PUT", body: { value: false } })).status).toBe(403);
    expect((await api("/call-center/catalog", operadoraA, { method: "POST", body: { kind: "reason", code: "x_y", label: "X" } })).status).toBe(403);
    // Mantenimiento no atiende llamadas.
    expect((await api("/call-center/calls", mantA, { method: "POST", body: { phone: "600111222" } })).status).toBe(403);
    // Sin rol en el módulo: nada.
    expect((await api("/call-center/status", sinRolA)).status).toBe(403);
    expect((await api("/incidents", sinRolA)).status).toBe(403);
  });

  it("⚑ multiempresa: B no ve ni toca las llamadas e incidencias de A (404)", async () => {
    await activar(adminB);
    const l = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "600111222" } }), 201);
    const n = await ok(api("/incidents", adminA, { method: "POST", body: { centerId: centro.id, incidentType: "complaint", title: "Ruido" } }), 201);
    expect((await api(`/call-center/calls/${l.id}`, adminB)).status).toBe(404);
    expect((await api(`/call-center/calls/${l.id}/result`, adminB, { method: "POST", body: { resultCode: "resuelto" } })).status).toBe(404);
    expect((await api(`/incidents/${n.id}`, adminB)).status).toBe(404);
    expect((await ok(api("/call-center/calls", adminB))).total).toBe(0);
    // B no encuentra a la clienta de A por su teléfono.
    expect((await ok(api("/call-center/customer-by-phone?phone=600111222", adminB))).interested).toBe(true);
    // Ni puede colgar una llamada suya del centro de A.
    expect((await api("/call-center/calls", adminB, { method: "POST", body: { phone: "600000001", centerId: centro.id } })).status).toBeGreaterThanOrEqual(400);
    // Ni abrir una incidencia en el centro de A.
    expect((await api("/incidents", adminB, { method: "POST", body: { centerId: centro.id, incidentType: "other", title: "x" } })).status).toBeGreaterThanOrEqual(400);
    expect((await ok(api("/call-center/dashboard", adminB))).kpis.total).toBe(0);
  });

  it("⚑ superadministrador: elige empresa con X-SS-Empresa (validada); un empleado no puede", async () => {
    const b = await ok(api("/bootstrap", superU));
    expect(b.empresas.map((e: any) => e.id)).toEqual(expect.arrayContaining([EA, EB]));
    expect(b.empresa.id).toBe(ES);
    // Trabaja en A: ve el centro de A y opera allí; queda auditado con su nombre.
    const enA = await ok(api("/bootstrap", superU, { empresa: EA }));
    expect(enA.empresa).toMatchObject({ id: EA, nombre: "Empresa A (Trasteros)" });
    expect(enA.centros.map((c: any) => c.id)).toEqual([centro.id]);
    const l = await ok(api("/call-center/calls", superU, { method: "POST", body: { phone: "600111222" }, empresa: EA }), 201);
    expect(l.customerId).toBe(ana.id);
    const aud = (await db.query(`SELECT empresa_id, actor_name FROM self_storage_audit_logs WHERE entity_id = $1`, [l.id])).rows[0];
    expect(aud).toEqual({ empresa_id: EA, actor_name: "Súper" });
    // Una empresa que no existe: 404, nunca «cae» en la suya.
    expect((await api("/bootstrap", superU, { empresa: "00000000-0000-4000-a000-0000005544ff" })).status).toBe(404);
    expect((await api("/bootstrap", superU, { empresa: "no-es-un-uuid" })).status).toBe(404);
    // Un empleado que manda la cabecera sigue en la suya.
    await activar(adminB);
    const emp = await ok(api("/bootstrap", adminB, { empresa: EA }));
    expect(emp.empresa.id).toBe(EB);
    expect(emp.empresas).toBeNull();
    expect((await api(`/call-center/calls/${l.id}`, adminB, { empresa: EA })).status).toBe(404);
  });

  it("filtros, informes (dashboard, operadores) y exportación CSV", async () => {
    const a = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "600111222", reasonCode: "precio_disponibilidad", language: "es" } }), 201);
    const b = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "677000555", reasonCode: "tamano_trastero", language: "ca" } }), 201);
    const c = await ok(api("/call-center/calls", empleadoA, { method: "POST", body: { phone: "677000666", direction: "outgoing", reasonCode: "visita_virtual" } }), 201);
    await ok(api(`/call-center/calls/${a.id}/result`, operadoraA, { method: "POST", body: { resultCode: "enviado_contratacion" } }));
    await ok(api(`/call-center/calls/${b.id}/result`, operadoraA, { method: "POST", body: { resultCode: "enviado_calculadora" } }));
    await ok(api(`/call-center/calls/${c.id}/escalate`, empleadoA, { method: "POST", body: { reason: "Pide hablar con la empresa" } }));

    const lista = (q: string) => ok(api(`/call-center/calls?${q}`, operadoraA));
    expect((await lista("language=ca")).items.map((x: any) => x.id)).toEqual([b.id]);
    expect((await lista("direction=outgoing")).items.map((x: any) => x.id)).toEqual([c.id]);
    expect((await lista("status=escalated")).items.map((x: any) => x.id)).toEqual([c.id]);
    expect((await lista("interested=1")).total).toBe(2);
    expect((await lista(`customerId=${ana.id}`)).items.map((x: any) => x.id)).toEqual([a.id]);
    expect((await lista("phone=677000555")).items.map((x: any) => x.id)).toEqual([b.id]);
    expect((await lista(`operatorUserId=${empleadoA.usuario}`)).items.map((x: any) => x.id)).toEqual([c.id]);
    expect((await lista("reasonCode=tamano_trastero")).total).toBe(1);
    expect((await api("/call-center/calls?status=inventado", operadoraA)).status).toBe(422);

    const d = await ok(api("/call-center/dashboard", operadoraA));
    expect(d.kpis).toMatchObject({ total: 3, today: 3, incoming: 2, outgoing: 1, resolved: 2, escalated: 1, human: 3, existingCustomers: 1, newInterested: 2, priceQueries: 1, sizeQueries: 1, sentToCalculator: 1, sentToContracting: 1 });
    expect(d.kpis.resolvedPct).toBeCloseTo(66.7, 1);
    expect(d.series.porIdioma.find((x: any) => x.code === "ca").calls).toBe(1);
    expect(d.series.porMotivo.find((x: any) => x.code === "precio_disponibilidad").label).toBe("Precio y disponibilidad");
    expect(d.series.porCentro[0]).toMatchObject({ centerId: centro.id, calls: 3 });

    const ops = await ok(api("/call-center/operators", adminA));
    expect(ops.find((o: any) => o.operatorUserId === operadoraA.usuario)).toMatchObject({ operatorName: "Operadora A", calls: 2, closed: 2 });

    const csv = await api("/call-center/calls/export?language=es", operadoraA);
    expect(csv.status).toBe(200);
    expect(csv.text!.split("\r\n")).toHaveLength(2);
    expect(csv.text).toContain("Inicio;Fin;Duración (s)");
    expect(csv.text).toContain("+34600111222");

    // Logs: la cronología de las llamadas.
    const ev = await ok(api("/call-center/events?eventType=escalated", adminA));
    expect(ev.map((e: any) => e.callId)).toEqual([c.id]);
  });

  it("centro y disponibilidad: real, por tipo, sin precios", async () => {
    await ok(api("/settings/call_center.links", adminA, { method: "PUT", body: { value: { brandName: "TLC - Trasteros-Low Cost", web: "https://www.trasteros-lowcost.com", calculator: null, contracting: null, virtualVisit: null } } }));
    const info = await ok(api(`/call-center/center-info?centerId=${centro.id}`, operadoraA));
    expect(info).toMatchObject({ name: "Reus", address: "Avinguda Jaume I, 105", links: { web: "https://www.trasteros-lowcost.com" } });
    const tipo = (
      await db.query(
        `INSERT INTO self_storage_unit_types (empresa_id, center_id, code, name, width_cm, length_cm, height_cm, nominal_area_m2, nominal_volume_m3) VALUES ($1,$2,'M','Mediano',200,250,250,5,12.5) RETURNING id`,
        [EA, centro.id]
      )
    ).rows[0].id;
    const tipo2 = (
      await db.query(
        `INSERT INTO self_storage_unit_types (empresa_id, center_id, code, name, width_cm, length_cm, height_cm, nominal_area_m2, nominal_volume_m3) VALUES ($1,$2,'G','Grande',300,400,250,12,30) RETURNING id`,
        [EA, centro.id]
      )
    ).rows[0].id;
    const zona = await ok(api(`/centers/${centro.id}/zones`, adminA, { method: "POST", body: { code: "Z1", name: "Zona 1" } }), 201);
    const unidad = async (t: string, code: string, status: string) => {
      const u = await ok(api("/units", adminA, { method: "POST", body: { centerId: centro.id, zoneId: zona.id, unitTypeId: t, code, widthCm: 200, lengthCm: 250, heightCm: 250, monthlyPriceGross: 60.5, depositAmount: 0 } }), 201);
      await db.query(`UPDATE self_storage_units SET status = $2 WHERE id = $1`, [u.id, status]);
    };
    await unidad(tipo, "M1", "occupied");
    await unidad(tipo, "M2", "available");
    await unidad(tipo2, "G1", "occupied");
    const disp = await ok(api(`/call-center/availability?centerId=${centro.id}`, operadoraA));
    expect(disp.types.map((t: any) => [t.name, t.available])).toEqual([
      ["Mediano", true],
      ["Grande", false],
    ]);
    // Ningún dato de precio: ni campos ni importes.
    for (const t of disp.types) expect(Object.keys(t).sort()).toEqual(["areaM2", "available", "name", "unitTypeId", "volumeM3"]);
    expect(JSON.stringify(disp)).not.toMatch(/price|60\.5/i);
    expect(disp.notice).toMatch(/web/);
    // De otra empresa: no existe.
    expect((await api(`/call-center/availability?centerId=${centroB.id}`, operadoraA)).status).toBe(404);
  });

  it("transcripciones: desactivadas por defecto; activadas, se guardan y la purga por retención las borra", async () => {
    const l = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "677000777" } }), 201);
    expect((await api(`/call-center/calls/${l.id}`, operadoraA, { method: "PATCH", body: { transcript: "Hola, quería saber…" } })).status).toBe(409);
    await ok(api("/settings/call_center.store_transcripts", adminA, { method: "PUT", body: { value: true } }));
    const t = await ok(api(`/call-center/calls/${l.id}`, operadoraA, { method: "PATCH", body: { transcript: "Hola, quería saber…" } }));
    expect(t.transcript).toBe("Hola, quería saber…");
    // La auditoría no guarda el contenido.
    const aud = (await db.query(`SELECT after FROM self_storage_audit_logs WHERE entity_id = $1 AND action = 'call.updated'`, [l.id])).rows;
    expect(JSON.stringify(aud)).not.toContain("quería saber");
    // Audio: no se puede activar.
    expect((await api("/settings/call_center.store_audio", adminA, { method: "PUT", body: { value: true } })).status).toBe(422);
    // Retención: una llamada antigua pierde la transcripción; la de hoy no.
    await db.query(`UPDATE self_storage_calls SET started_at = now() - interval '200 days' WHERE id = $1`, [l.id]);
    const l2 = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "677000778" } }), 201);
    await ok(api(`/call-center/calls/${l2.id}`, operadoraA, { method: "PATCH", body: { transcript: "reciente" } }));
    const { purgarTranscripciones } = await import("./modules/callcenter/retencion.ts");
    await purgarTranscripciones();
    expect((await ok(api(`/call-center/calls/${l.id}`, operadoraA))).transcript).toBeNull();
    expect((await ok(api(`/call-center/calls/${l2.id}`, operadoraA))).transcript).toBe("reciente");
    // Si la empresa deja de guardarlas, se borran todas.
    await ok(api("/settings/call_center.store_transcripts", adminA, { method: "PUT", body: { value: false } }));
    await purgarTranscripciones();
    expect((await ok(api(`/call-center/calls/${l2.id}`, operadoraA))).transcript).toBeNull();
  });

  it("la cronología de la llamada es de sólo inserción", async () => {
    const l = await ok(api("/call-center/calls", operadoraA, { method: "POST", body: { phone: "677000999" } }), 201);
    await expect(db.query(`UPDATE self_storage_call_events SET event_type = 'otro' WHERE call_id = $1`, [l.id])).rejects.toThrow(/sólo inserción/);
    await expect(db.query(`DELETE FROM self_storage_call_events WHERE call_id = $1`, [l.id])).rejects.toThrow(/sólo inserción/);
  });
});
