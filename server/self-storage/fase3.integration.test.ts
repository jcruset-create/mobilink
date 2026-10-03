/**
 * Self Storage · fase 3 (accesos físicos), por HTTP y contra PostgreSQL de
 * verdad, con el dispositivo SIMULADO (MockAccessDeviceAdapter): online,
 * offline, apertura correcta, timeout, salida fallida, sincronización correcta
 * y fallida. Stripe, como en la fase 2: pasarela en memoria y webhooks
 * firmados con el SDK real.
 *
 * Pruebas obligatorias del encargo (⚑):
 *   ⚑ contrato activo abre sus puertas          ⚑ no abre una zona que no es la suya
 *   ⚑ contrato suspendido no abre               ⚑ cobrar levanta SÓLO el bloqueo de impago
 *   ⚑ un bloqueo de seguridad sigue bloqueando  ⚑ la persona autorizada se identifica
 *   ⚑ acceso temporal caducado falla            ⚑ un solo uso no sirve dos veces
 *   ⚑ un teléfono no se quita si otro contrato aún lo necesita
 *   ⚑ dispositivo offline: sin falsos positivos
 *   ⚑ webhook financiero que suspende → resincronización
 *   ⚑ aperturas administrativas auditadas       ⚑ límite de frecuencia
 *   (⚑ RLS de los eventos: en rls.integration.test.ts)
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const SECRETO = "whsec_prueba_self_storage";
const RONDA = Date.now().toString(36);
process.env.SELF_STORAGE_STRIPE_WEBHOOK_SECRET = SECRETO;
process.env.SELF_STORAGE_STORAGE_LOCAL = "1";
process.env.SELF_STORAGE_JOBS = "0";

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
vi.mock("../supabase.ts", () => ({
  supabase: {
    auth: {
      getUser: async (token: string) => (/^[0-9a-f-]{36}$/.test(token) ? { data: { user: { id: token } }, error: null } : { data: { user: null }, error: new Error("x") }),
      admin: { inviteUserByEmail: async () => ({ data: null, error: new Error("no en pruebas") }) },
    },
  },
}));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;
let simulador: typeof import("./integrations/access-devices/mock.ts").simulador;
let trabajoAccesos: typeof import("./modules/accesos/sincronizacion.ts").trabajoAccesos;

const EMPRESA = "00000000-0000-4000-a000-0000005533a1";
const admin = { usuario: "00000000-0000-4000-a000-000000553301", empresa: EMPRESA, nombre: "Admin Accesos" };
const empleado = { usuario: "00000000-0000-4000-a000-000000553302", empresa: EMPRESA, nombre: "Empleado Accesos" };
const mant = { usuario: "00000000-0000-4000-a000-000000553303", empresa: EMPRESA, nombre: "Mantenimiento" };
const AUTH_ANA = "00000000-0000-4000-a000-0000005533f1";
const AUTH_BEA = "00000000-0000-4000-a000-0000005533f2";
const AUTH_MARIA = "00000000-0000-4000-a000-0000005533f3";
const TEL_ANA = "+34600111222";

type Quien = { usuario: string; empresa: string; nombre: string };
type Respuesta = { status: number; body: any };

function api(ruta: string, quien: Quien, init?: { method?: string; body?: unknown }): Promise<Respuesta> {
  return fetch(`${base}/api/self-storage/admin${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "x-test-user": quien.usuario, "x-test-empresa": quien.empresa, "x-test-nombre": quien.nombre, "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}
function portal(ruta: string, authUser: string | null, init?: { method?: string; body?: unknown }): Promise<Respuesta> {
  return fetch(`${base}/api/self-storage/portal${ruta}`, {
    method: init?.method ?? "GET",
    headers: { ...(authUser ? { Authorization: `Bearer ${authUser}` } : {}), "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}
async function ok(p: Promise<Respuesta>, estado = 200) {
  const r = await p;
  expect(r.status, JSON.stringify(r.body)).toBe(estado);
  return r.body;
}
const abrir = (auth: string, doorId: string) => portal("/access/open", auth, { method: "POST", body: { doorId } });

// ── Stripe en memoria + webhooks firmados ───────────────────────────────────
const llamadas: { tipo: string; datos: any }[] = [];
let n = 0;
const pasarelaFalsa = {
  crearCliente: async () => ({ id: `cus_${++n}` }),
  crearProducto: async (d: any) => (llamadas.push({ tipo: "producto", datos: d }), { id: `prod_${RONDA}_${++n}` }),
  crearCheckoutSuscripcion: async (d: any) => (llamadas.push({ tipo: "checkout_sub", datos: d }), { id: `cs_${++n}`, url: `https://checkout.test/${n}` }),
  crearCheckoutPago: async () => ({ id: `cs_${++n}`, url: `https://checkout.test/${n}` }),
  crearCheckoutMetodo: async () => ({ id: `cs_${++n}`, url: `https://checkout.test/${n}` }),
  listarMetodosPago: async () => [],
  fijarMetodoPorDefecto: async () => {},
  cancelarSuscripcion: async () => {},
};
let eventoN = 0;
async function webhook(tipo: string, objeto: Record<string, unknown>) {
  const payload = JSON.stringify({ id: `evt_f3_${RONDA}_${++eventoN}`, object: "event", type: tipo, livemode: false, created: Math.floor(Date.now() / 1000), api_version: "2026-04-22.dahlia", data: { object: objeto } });
  const cabecera = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRETO });
  const r = await fetch(`${base}/api/self-storage/webhooks/stripe`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": cabecera }, body: payload });
  expect(r.status).toBe(200);
}
function facturaStripe(d: { id: string; sub: string; contractId: string; lineas: { product: string; amount: number; start?: number; end?: number }[]; pagada?: boolean }) {
  const total = d.lineas.reduce((s, l) => s + l.amount, 0);
  const ahora = Math.floor(Date.now() / 1000);
  return {
    id: d.id,
    object: "invoice",
    customer: "cus_x",
    total,
    amount_due: total,
    amount_paid: d.pagada ? total : 0,
    hosted_invoice_url: `https://invoice.stripe.test/${d.id}`,
    created: ahora,
    status_transitions: { finalized_at: ahora, paid_at: d.pagada ? ahora : null },
    parent: { type: "subscription_details", subscription_details: { subscription: d.sub, metadata: { ss_contract_id: d.contractId } } },
    lines: { data: d.lineas.map((l, i) => ({ id: `il_${d.id}_${i}`, amount: l.amount, quantity: 1, description: `L${i}`, pricing: { price_details: { product: l.product } }, period: { start: l.start ?? ahora, end: l.end ?? ahora + 30 * 86400 } })) },
  };
}

// ── Datos ───────────────────────────────────────────────────────────────────
let centro: any, zonas: Record<string, any>, puertas: Record<string, any>, dispositivo: any;
let ana: any, bea: any;

async function cliente(nombre: string, taxId: string, auth: string | null) {
  const c = await ok(api("/customers", admin, { method: "POST", body: { customerType: "individual", firstName: nombre, lastName: "Prueba", taxId, phone: "600000000", email: `${nombre.toLowerCase()}@example.com`, address: "Calle 1", city: "Reus", postalCode: "43201" } }), 201);
  if (auth) await db.query(`UPDATE self_storage_customers SET auth_user_id = $2 WHERE id = $1`, [c.id, auth]);
  return c;
}
let u = 0;
async function trastero(zona: string) {
  return ok(api("/units", admin, { method: "POST", body: { centerId: centro.id, zoneId: zonas[zona].id, code: `T${++u}`, widthCm: 150, lengthCm: 200, heightCm: 250, monthlyPriceGross: 60, depositAmount: 0 } }), 201);
}
/** Contrato por transferencia firmado y cobrado: activo. */
async function contratoActivo(customerId: string, zona = "Z2") {
  const t = await trastero(zona);
  const k = await ok(api("/contracts", empleado, { method: "POST", body: { customerId, unitId: t.id, startDate: "2026-10-01", billingDay: 1, paymentMethod: "bank_transfer" } }), 201);
  await ok(api(`/contracts/${k.id}/issue`, empleado, { method: "POST", body: {} }));
  const firmado = await ok(api(`/contracts/${k.id}/sign`, empleado, { method: "POST", body: { signerName: "Cliente", accepted: true } }));
  await ok(api("/payments/manual", empleado, { method: "POST", body: { invoiceId: firmado.invoices[0].id, paymentMethod: "bank_transfer" } }), 201);
  const activo = await ok(api(`/contracts/${k.id}`, admin));
  expect(activo.status).toBe("active");
  return activo;
}
const simulacion = (s: Record<string, unknown>) => ok(api(`/devices/${dispositivo.id}`, admin, { method: "PATCH", body: { simulation: s } }));
const eventosDe = async (where: string, p: unknown[]) => (await db.query(`SELECT * FROM self_storage_access_events WHERE ${where} ORDER BY requested_at`, p)).rows;

async function limpiar() {
  for (const [t, trg] of [
    ["self_storage_audit_logs", "self_storage_audit_logs_immutable"],
    ["self_storage_contract_documents", "self_storage_contract_documents_guard"],
    ["self_storage_invoices", "self_storage_invoices_guard"],
    ["self_storage_invoice_items", "self_storage_invoice_items_guard"],
    ["self_storage_access_events", "self_storage_access_events_guard"],
  ]) {
    await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
  }
  for (const sql of [
    `DELETE FROM self_storage_access_events WHERE empresa_id = $1`,
    `DELETE FROM self_storage_temporary_accesses WHERE empresa_id = $1`,
    `DELETE FROM self_storage_access_permissions WHERE empresa_id = $1`,
    `DELETE FROM self_storage_doors WHERE empresa_id = $1`,
    `DELETE FROM self_storage_device_outputs WHERE empresa_id = $1`,
    `DELETE FROM self_storage_devices WHERE empresa_id = $1`,
    `DELETE FROM self_storage_contract_members WHERE empresa_id = $1`,
    `DELETE FROM self_storage_audit_logs WHERE empresa_id = $1`,
    `DELETE FROM self_storage_notifications WHERE empresa_id = $1`,
    `DELETE FROM self_storage_access_blocks WHERE empresa_id = $1`,
    `DELETE FROM self_storage_dunning_cases WHERE empresa_id = $1`,
    `DELETE FROM self_storage_payments WHERE empresa_id = $1`,
    `DELETE FROM self_storage_invoices WHERE empresa_id = $1 AND kind = 'rectifying'`,
    `DELETE FROM self_storage_invoices WHERE empresa_id = $1`,
    `DELETE FROM self_storage_contract_documents WHERE empresa_id = $1`,
    `DELETE FROM self_storage_contract_items WHERE empresa_id = $1`,
    `DELETE FROM self_storage_contracts WHERE empresa_id = $1`,
  ]) {
    await db.query(sql, [EMPRESA]);
  }
  for (const t of ["self_storage_billing_items", "self_storage_sequences", "self_storage_customer_phones", "self_storage_customers", "self_storage_units", "self_storage_unit_types", "self_storage_zones", "self_storage_settings", "self_storage_centers"]) {
    await db.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [EMPRESA]);
  }
  for (const [t, trg] of [
    ["self_storage_audit_logs", "self_storage_audit_logs_immutable"],
    ["self_storage_contract_documents", "self_storage_contract_documents_guard"],
    ["self_storage_invoices", "self_storage_invoices_guard"],
    ["self_storage_invoice_items", "self_storage_invoice_items_guard"],
    ["self_storage_access_events", "self_storage_access_events_guard"],
  ]) {
    await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
  }
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await db.query(`CREATE TABLE IF NOT EXISTS app_usuario_modulos (user_id UUID NOT NULL, modulo TEXT NOT NULL, rol TEXT NOT NULL, pantallas TEXT[], empresa_id UUID, centro_id UUID, UNIQUE (user_id, modulo))`);
  for (const [usr, rol] of [[admin.usuario, "admin"], [empleado.usuario, "employee"], [mant.usuario, "maintenance"]]) {
    await db.query(`INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'self-storage',$2) ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`, [usr, rol]);
  }
  const { fijarPasarela } = await import("./integrations/stripe/pasarela.ts");
  fijarPasarela(pasarelaFalsa as any);
  simulador = (await import("./integrations/access-devices/mock.ts")).simulador;
  trabajoAccesos = (await import("./modules/accesos/sincronizacion.ts")).trabajoAccesos;
  const { mountSelfStorage, mountSelfStorageWebhooks } = await import("./index.ts");
  const app = express();
  app.set("trust proxy", false);
  mountSelfStorageWebhooks(app);
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

describe.skipIf(!RUN)("Self Storage · fase 3 (accesos) contra PostgreSQL", () => {
  beforeEach(async () => {
    await limpiar();
    simulador.reiniciar();
    centro = await ok(api("/centers", admin, { method: "POST", body: { code: "REUS", name: "Reus", city: "Reus" } }), 201);
    zonas = {};
    for (const z of ["Z1", "Z2", "Z3"]) zonas[z] = await ok(api(`/centers/${centro.id}/zones`, admin, { method: "POST", body: { code: z, name: `Zona ${z.slice(1)}` } }), 201);
    await ok(api("/settings/billing.issuer", admin, { method: "PUT", body: { value: { name: "Mobilink Storage SL", taxId: "B12345674", address: "Av. Principal 1, Reus" } } }));
    // Un dispositivo simulado con cuatro salidas: principal + una por zona.
    dispositivo = await ok(
      api("/devices", admin, {
        method: "POST",
        body: {
          centerId: centro.id,
          name: "RUT241 simulado",
          connectionType: "mock",
          simulation: { online: true },
          outputs: [1, 2, 3, 4].map((o) => ({ outputNumber: o, name: `Salida ${o}` })),
        },
      }),
      201
    );
    const salida = (k: number) => dispositivo.outputs.find((o: any) => o.outputNumber === k).id;
    puertas = {
      main: await ok(api("/doors", admin, { method: "POST", body: { centerId: centro.id, name: "Puerta principal", doorType: "main", deviceOutputId: salida(1) } }), 201),
      Z1: await ok(api("/doors", admin, { method: "POST", body: { centerId: centro.id, zoneId: zonas.Z1.id, name: "Puerta Zona 1", doorType: "zone", deviceOutputId: salida(2) } }), 201),
      Z2: await ok(api("/doors", admin, { method: "POST", body: { centerId: centro.id, zoneId: zonas.Z2.id, name: "Puerta Zona 2", doorType: "zone", deviceOutputId: salida(3) } }), 201),
      Z3: await ok(api("/doors", admin, { method: "POST", body: { centerId: centro.id, zoneId: zonas.Z3.id, name: "Puerta Zona 3", doorType: "zone", deviceOutputId: salida(4) } }), 201),
    };
    ana = await cliente("Ana", "12345678Z", AUTH_ANA);
    bea = await cliente("Bea", "87654321X", AUTH_BEA);
  });

  it("⚑ contrato activo en Zona 2 abre la principal y la de Zona 2; ⚑ NO la Zona 1 ni la 3", async () => {
    const k = await contratoActivo(ana.id, "Z2");
    // Permisos generados a partir del contrato.
    const acc = await ok(api(`/contracts/${k.id}/access`, admin));
    expect(acc.permisos.filter((p: any) => p.status === "active").map((p: any) => p.doorName).sort()).toEqual(["Puerta Zona 2", "Puerta principal"]);
    // El portal sólo enseña las suyas.
    const lista = await ok(portal("/access/doors", AUTH_ANA));
    expect(lista.map((p: any) => [p.name, p.canOpen]).sort()).toEqual([["Puerta Zona 2", true], ["Puerta principal", true]]);

    for (const p of [puertas.main, puertas.Z2]) expect(await ok(abrir(AUTH_ANA, p.id))).toMatchObject({ opened: true, decision: "granted", reason: "GRANTED", executionStatus: "succeeded" });
    for (const p of [puertas.Z1, puertas.Z3]) expect(await ok(abrir(AUTH_ANA, p.id))).toMatchObject({ opened: false, decision: "denied", reason: "DOOR_NOT_ALLOWED", executionStatus: "not_attempted" });
    expect(simulador.aperturas(dispositivo.id)).toEqual([1, 3]);

    const ev = await eventosDe(`customer_id = $1`, [ana.id]);
    expect(ev.map((e) => [e.decision, e.execution_status, e.method])).toEqual([
      ["granted", "succeeded", "app"],
      ["granted", "succeeded", "app"],
      ["denied", "not_attempted", "app"],
      ["denied", "not_attempted", "app"],
    ]);
    expect(ev[0]).toMatchObject({ actor_type: "customer", actor_name: "Ana Prueba", contract_id: k.id, device_id: dispositivo.id });
    // Una puerta de otra empresa «no existe».
    expect((await abrir(AUTH_BEA, "00000000-0000-4000-a000-000000000000")).status).toBe(404);
    // Los eventos son de sólo inserción.
    await expect(db.query(`UPDATE self_storage_access_events SET reason = 'X' WHERE id = $1`, [ev[0].id])).rejects.toThrow(/sólo inserción/);
    await expect(db.query(`DELETE FROM self_storage_access_events WHERE id = $1`, [ev[0].id])).rejects.toThrow(/sólo inserción/);
  });

  it("⚑ contrato suspendido no abre; ⚑ cobrar el impago levanta SÓLO el bloqueo de pago; ⚑ seguridad sigue bloqueando", async () => {
    const k = await contratoActivo(ana.id, "Z2");
    // Una factura manual pendiente que vence y llega a impago con suspensión.
    const cat = await ok(api("/billing-items", admin));
    const candado = cat.find((c: any) => c.code === "LOCK");
    const b = await ok(api("/invoices", empleado, { method: "POST", body: { customerId: ana.id, contractId: k.id, dueDate: "2026-10-05", lines: [{ billingItemId: candado.id, quantity: 1, unitPrice: 10 }] } }), 201);
    await ok(api(`/invoices/${b.id}/issue`, empleado, { method: "POST", body: {} }));
    const { marcarVencidas, ejecutarImpagos } = await import("./modules/impagos/service.ts");
    await marcarVencidas("2026-12-31");
    await ejecutarImpagos(new Date(Date.now() + 30 * 86_400_000));
    expect((await ok(api(`/contracts/${k.id}`, admin))).status).toBe("suspended");
    expect(await ok(abrir(AUTH_ANA, puertas.main.id))).toMatchObject({ opened: false, reason: "PAYMENT_BLOCK" });

    // Además, seguridad.
    await ok(api(`/contracts/${k.id}/suspend`, empleado, { method: "POST", body: { reason: "security", notes: "Revisión" } }));
    expect(await ok(abrir(AUTH_ANA, puertas.main.id))).toMatchObject({ opened: false, reason: "SECURITY_BLOCK" });

    // Cobra: cae el de impago, sigue el de seguridad → sigue sin abrir.
    await ok(api("/payments/manual", empleado, { method: "POST", body: { invoiceId: b.id, paymentMethod: "cash" } }), 201);
    const tras = await ok(api(`/contracts/${k.id}`, admin));
    expect(tras.blocks.filter((x: any) => !x.liftedAt).map((x: any) => x.reason)).toEqual(["security"]);
    expect(await ok(abrir(AUTH_ANA, puertas.main.id))).toMatchObject({ opened: false, reason: "SECURITY_BLOCK" });

    // El administrador levanta seguridad: vuelve a abrir.
    const seg = tras.blocks.find((x: any) => x.reason === "security" && !x.liftedAt);
    await ok(api(`/contracts/${k.id}/blocks/${seg.id}/lift`, admin, { method: "POST", body: { reason: "Resuelto" } }));
    expect(await ok(abrir(AUTH_ANA, puertas.main.id))).toMatchObject({ opened: true });
  });

  it("⚑ la persona autorizada abre con su identidad: «María abrió», no «el contrato abrió»", async () => {
    const k = await contratoActivo(ana.id, "Z2");
    const [maria] = await ok(api(`/contracts/${k.id}/members`, empleado, { method: "POST", body: { fullName: "María López", email: "maria@example.com", phone: "611222333", allowApp: true, allowPhone: true } }), 201);
    await db.query(`UPDATE self_storage_contract_members SET auth_user_id = $2 WHERE id = $1`, [maria.id, AUTH_MARIA]);

    expect(await ok(abrir(AUTH_MARIA, puertas.Z2.id))).toMatchObject({ opened: true });
    expect(await ok(abrir(AUTH_ANA, puertas.Z2.id))).toMatchObject({ opened: true });
    const ev = await ok(api(`/access-events?contractId=${k.id}`, admin));
    expect(ev.map((e: any) => e.actorName).sort()).toEqual(["Ana Prueba", "María López"]);
    const deMaria = ev.find((e: any) => e.actorName === "María López");
    expect(deMaria).toMatchObject({ actorType: "member", contractMemberId: maria.id });
    // María no ve lo financiero del titular.
    expect((await portal("/invoices", AUTH_MARIA)).status).toBe(403);
    expect((await ok(portal("/me", AUTH_MARIA))).kind).toBe("member");
    // Suspendida su autorización, no abre (y el titular sí).
    await ok(api(`/contracts/${k.id}/members/${maria.id}`, empleado, { method: "PATCH", body: { status: "suspended" } }));
    expect(await ok(abrir(AUTH_MARIA, puertas.Z2.id))).toMatchObject({ opened: false, reason: "MEMBER_NOT_ACTIVE" });
  });

  it("⚑ acceso temporal caducado falla; ⚑ uno de un solo uso no sirve dos veces (y un fallo físico no gasta el uso)", async () => {
    const k = await contratoActivo(ana.id, "Z2");
    const hora = 3_600_000;
    const caducado = await ok(api("/temporary-accesses", empleado, { method: "POST", body: { contractId: k.id, fullName: "Mudanzas Pérez", startsAt: new Date(Date.now() - 3 * hora).toISOString(), endsAt: new Date(Date.now() - hora).toISOString(), doorIds: [puertas.main.id], withLink: true } }), 201);
    expect(await ok(portal("/access/temporary/open", null, { method: "POST", body: { token: caducado.token, doorId: puertas.main.id } }))).toMatchObject({ opened: false, reason: "TEMPORARY_ACCESS_EXPIRED" });

    const unUso = await ok(api("/temporary-accesses", empleado, { method: "POST", body: { contractId: k.id, fullName: "Técnico", startsAt: new Date(Date.now() - hora).toISOString(), endsAt: new Date(Date.now() + hora).toISOString(), maxUses: 1, doorIds: [puertas.main.id, puertas.Z2.id], withLink: true } }), 201);
    expect(unUso.token).toBeTruthy();
    // El token no se guarda: sólo su huella.
    expect((await db.query(`SELECT token_hash FROM self_storage_temporary_accesses WHERE id = $1`, [unUso.id])).rows[0].token_hash).not.toBe(unUso.token);
    // Un fallo de la salida no consume el uso…
    await simulacion({ online: true, open: "output_failed" });
    expect(await ok(portal("/access/temporary/open", null, { method: "POST", body: { token: unUso.token, doorId: puertas.main.id } }))).toMatchObject({ opened: false, executionStatus: "failed" });
    await simulacion({ online: true, open: "ok" });
    // …el primero bueno sí, y el segundo ya no abre.
    expect(await ok(portal("/access/temporary/open", null, { method: "POST", body: { token: unUso.token, doorId: puertas.main.id } }))).toMatchObject({ opened: true });
    expect(await ok(portal("/access/temporary/open", null, { method: "POST", body: { token: unUso.token, doorId: puertas.Z2.id } }))).toMatchObject({ opened: false, reason: "TEMPORARY_ACCESS_EXHAUSTED" });
    const ev = await eventosDe(`temporary_access_id = $1`, [unUso.id]);
    expect(ev.map((e) => [e.actor_type, e.actor_name, e.method])).toContainEqual(["guest", "Técnico", "temporary_link"]);
    // Si el contrato del que depende se bloquea, el temporal también.
    const otro = await ok(api("/temporary-accesses", empleado, { method: "POST", body: { contractId: k.id, fullName: "Cuñado", startsAt: new Date(Date.now() - hora).toISOString(), endsAt: new Date(Date.now() + hora).toISOString(), doorIds: [puertas.main.id], withLink: true } }), 201);
    await ok(api(`/contracts/${k.id}/suspend`, empleado, { method: "POST", body: { reason: "manual", notes: "Prueba" } }));
    expect(await ok(portal("/access/temporary/open", null, { method: "POST", body: { token: otro.token, doorId: puertas.main.id } }))).toMatchObject({ opened: false, reason: "MANUAL_BLOCK" });
    // Un token inventado «no existe».
    expect((await portal("/access/temporary/open", null, { method: "POST", body: { token: "x".repeat(32), doorId: puertas.main.id } })).status).toBe(404);
  });

  it("⚑ un teléfono no se quita del RUT241 si otro contrato aún lo necesita (estado deseado, no bajas sueltas)", async () => {
    const k1 = await contratoActivo(ana.id, "Z1");
    const k2 = await contratoActivo(ana.id, "Z2");
    await ok(api(`/customers/${ana.id}/phones`, empleado, { method: "POST", body: { phone: TEL_ANA, label: "móvil", allowDoorAccess: true } }), 201);
    // El mismo número, persona autorizada en el contrato de Bea.
    const kb = await contratoActivo(bea.id, "Z3");
    await ok(api(`/contracts/${kb.id}/members`, empleado, { method: "POST", body: { fullName: "Ana (en casa de Bea)", phone: TEL_ANA, allowPhone: true } }), 201);
    await trabajoAccesos();
    expect(simulador.telefonos(dispositivo.id)).toEqual([TEL_ANA]);

    // Termina uno de sus contratos: el número sigue (le queda otro).
    await ok(api(`/contracts/${k1.id}/terminate`, admin, { method: "POST", body: { reason: "Baja" } }));
    await trabajoAccesos();
    expect(simulador.telefonos(dispositivo.id)).toEqual([TEL_ANA]);
    // Termina el otro: sigue, porque es persona autorizada de Bea.
    await ok(api(`/contracts/${k2.id}/terminate`, admin, { method: "POST", body: { reason: "Baja" } }));
    await trabajoAccesos();
    expect(simulador.telefonos(dispositivo.id)).toEqual([TEL_ANA]);
    // Bea lo revoca: ahora sí desaparece.
    const [m] = await ok(api(`/contracts/${kb.id}/members`, admin));
    await ok(api(`/contracts/${kb.id}/members/${m.id}`, empleado, { method: "PATCH", body: { status: "revoked" } }));
    await trabajoAccesos();
    expect(simulador.telefonos(dispositivo.id)).toEqual([]);
    const sync = (await ok(api("/devices", admin)))[0];
    expect(sync).toMatchObject({ syncStatus: "synced", syncDesired: [], syncActual: [] });
  });

  it("sincronización fallida: queda `failed` con su error y se reintenta hasta `synced`", async () => {
    await contratoActivo(ana.id, "Z2");
    await simulacion({ online: true, sync: "fail" });
    await ok(api(`/customers/${ana.id}/phones`, empleado, { method: "POST", body: { phone: TEL_ANA, allowDoorAccess: true } }), 201);
    await trabajoAccesos();
    let d = (await ok(api("/devices", admin)))[0];
    expect(d).toMatchObject({ syncStatus: "failed", syncAttempts: 1, syncDesired: [TEL_ANA] });
    expect(d.syncError).toMatch(/SYNC_FAILED/);
    expect(simulador.telefonos(dispositivo.id)).toEqual([]);
    await simulacion({ online: true, sync: "ok" });
    await db.query(`UPDATE self_storage_device_syncs SET next_attempt_at = now() WHERE device_id = $1`, [dispositivo.id]);
    await trabajoAccesos();
    d = (await ok(api("/devices", admin)))[0];
    expect(d).toMatchObject({ syncStatus: "synced", syncActual: [TEL_ANA] });
    expect(simulador.telefonos(dispositivo.id)).toEqual([TEL_ANA]);
  });

  it("⚑ dispositivo offline o que no contesta: nunca un «abierto» falso", async () => {
    await contratoActivo(ana.id, "Z2");
    await simulacion({ online: false });
    await trabajoAccesos(); // el latido lo marca offline
    expect((await ok(api("/doors", mant))).find((p: any) => p.id === puertas.main.id)).toMatchObject({ deviceStatus: "offline" });
    expect(await ok(abrir(AUTH_ANA, puertas.main.id))).toMatchObject({ opened: false, reason: "DEVICE_OFFLINE", executionStatus: "not_attempted" });
    expect(simulador.aperturas(dispositivo.id)).toEqual([]);

    // Online pero la orden no responde: decisión «granted», ejecución «timeout», puerta NO abierta.
    await simulacion({ online: true, open: "timeout" });
    const r = await ok(abrir(AUTH_ANA, puertas.main.id));
    expect(r).toMatchObject({ opened: false, decision: "granted", executionStatus: "timeout" });
    const [ev] = (await eventosDe(`id = $1`, [r.eventId]));
    expect(ev).toMatchObject({ execution_status: "timeout" });
    expect(ev.device_response).toMatchObject({ ok: false, code: "TIMEOUT" });
    expect(JSON.stringify(ev.device_response)).not.toMatch(/password|token/i);
    expect((await ok(api("/doors", admin))).find((p: any) => p.id === puertas.main.id).lastError).toMatch(/TIMEOUT/);
  });

  it("⚑ webhook financiero que suspende el contrato → el teléfono sale del RUT241; al cobrar vuelve", async () => {
    await ok(api("/settings/billing.first_sepa_payment_access_policy", admin, { method: "PUT", body: { value: "allow_while_processing" } }));
    const t = await trastero("Z2");
    const k0 = await ok(api("/contracts", empleado, { method: "POST", body: { customerId: ana.id, unitId: t.id, startDate: "2026-10-01", billingDay: 1, paymentMethod: "sepa" } }), 201);
    await ok(api(`/contracts/${k0.id}/issue`, empleado, { method: "POST", body: {} }));
    await ok(api(`/contracts/${k0.id}/sign`, empleado, { method: "POST", body: { signerName: "Ana", accepted: true } }));
    llamadas.length = 0;
    await ok(api(`/contracts/${k0.id}/checkout`, empleado, { method: "POST", body: {} }));
    const prodAlquiler = llamadas.filter((l) => l.tipo === "checkout_sub").at(-1)!.datos.lineas[0].productId;
    const sub = `sub_${k0.id.slice(0, 8)}`;
    await webhook("checkout.session.completed", { id: `cs_${RONDA}`, mode: "subscription", payment_status: "unpaid", amount_total: 6000, subscription: sub, invoice: `in_a_${RONDA}`, metadata: { ss_kind: "contract_subscription", ss_contract_id: k0.id, ss_empresa_id: EMPRESA } });
    await webhook("invoice.paid", facturaStripe({ id: `in_a_${RONDA}`, sub, contractId: k0.id, pagada: true, lineas: [{ product: prodAlquiler, amount: 6000 }] }));
    expect((await ok(api(`/contracts/${k0.id}`, admin))).status).toBe("active");
    await ok(api(`/customers/${ana.id}/phones`, empleado, { method: "POST", body: { phone: TEL_ANA, allowDoorAccess: true } }), 201);
    await trabajoAccesos();
    expect(simulador.telefonos(dispositivo.id)).toEqual([TEL_ANA]);

    // Recibo devuelto (webhook) → impago → suspensión.
    const mes = facturaStripe({ id: `in_b_${RONDA}`, sub, contractId: k0.id, lineas: [{ product: prodAlquiler, amount: 6000, start: 1793491200, end: 1796083200 }] });
    await webhook("invoice.payment_failed", mes);
    const { ejecutarImpagos } = await import("./modules/impagos/service.ts");
    await ejecutarImpagos(new Date(Date.now() + 11 * 86_400_000));
    expect((await ok(api(`/contracts/${k0.id}`, admin))).status).toBe("suspended");
    // La lista deseada ya no lo lleva: pendiente de aplicar hasta que se sincroniza.
    let d = (await ok(api("/devices", admin)))[0];
    expect(d).toMatchObject({ syncStatus: "pending", syncDesired: [], syncActual: [TEL_ANA] });
    await trabajoAccesos();
    expect(simulador.telefonos(dispositivo.id)).toEqual([]);
    expect(await ok(abrir(AUTH_ANA, puertas.main.id))).toMatchObject({ opened: false, reason: "PAYMENT_BLOCK" });

    // Se cobra (webhook) → cae el bloqueo de impago → el teléfono vuelve.
    await webhook("invoice.paid", { ...mes, amount_paid: 6000, status_transitions: { finalized_at: mes.status_transitions.finalized_at, paid_at: Math.floor(Date.now() / 1000) } });
    expect((await ok(api(`/contracts/${k0.id}`, admin))).status).toBe("active");
    d = (await ok(api("/devices", admin)))[0];
    expect(d).toMatchObject({ syncStatus: "pending", syncDesired: [TEL_ANA] });
    await trabajoAccesos();
    expect(simulador.telefonos(dispositivo.id)).toEqual([TEL_ANA]);
    expect(await ok(abrir(AUTH_ANA, puertas.main.id))).toMatchObject({ opened: true });
  });

  it("⚑ apertura administrativa: queda en eventos (método admin) y en la auditoría, con su motivo", async () => {
    const r = await ok(api(`/doors/${puertas.Z1.id}/open`, empleado, { method: "POST", body: { reason: "Cliente sin batería en el móvil" } }));
    expect(r).toMatchObject({ opened: true, decision: "granted" });
    const [ev] = await eventosDe(`id = $1`, [r.eventId]);
    expect(ev).toMatchObject({ method: "admin", actor_type: "staff", actor_name: "Empleado Accesos", staff_user_id: empleado.usuario, admin_reason: "Cliente sin batería en el móvil", execution_status: "succeeded" });
    const audit = await ok(api(`/audit?entityType=door&entityId=${puertas.Z1.id}`, admin));
    expect(audit.find((a: any) => a.action === "door.opened_by_admin")).toMatchObject({ actorName: "Empleado Accesos", after: { reason: "Cliente sin batería en el móvil", eventId: r.eventId } });
    // Mantenimiento ve las puertas y prueba conexión, pero no abre.
    expect((await api(`/doors/${puertas.Z1.id}/open`, mant, { method: "POST", body: {} })).status).toBe(403);
    expect(await ok(api(`/devices/${dispositivo.id}/test`, mant, { method: "POST", body: {} }))).toMatchObject({ ok: true });
    // Y no ve los eventos con datos de clientes.
    expect((await api("/access-events", mant)).status).toBe(403);
  });

  it("⚑ límite de frecuencia: al pasarse, 429 y el intento también queda registrado", async () => {
    await contratoActivo(ana.id, "Z2");
    await ok(api("/settings/access.rate_limit_per_minute", admin, { method: "PUT", body: { value: 3 } }));
    for (let i = 0; i < 3; i++) expect((await abrir(AUTH_ANA, puertas.main.id)).status).toBe(200);
    const r = await abrir(AUTH_ANA, puertas.main.id);
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("RATE_LIMITED");
    expect(simulador.aperturas(dispositivo.id)).toHaveLength(3);
    const ev = await eventosDe(`customer_id = $1 AND reason = 'RATE_LIMITED'`, [ana.id]);
    expect(ev).toHaveLength(1);
    // Otra persona no se ve afectada.
    await contratoActivo(bea.id, "Z2");
    expect(await ok(abrir(AUTH_BEA, puertas.main.id))).toMatchObject({ opened: true });
  });

  it("horario de la puerta: fuera de horario no abre (salvo administración)", async () => {
    await contratoActivo(ana.id, "Z2");
    // Un horario que nunca incluye «ahora»: sólo el día que no es hoy.
    const hoy = ((new Date().getUTCDay() + 6) % 7) + 1;
    const otroDia = (hoy % 7) + 1;
    await ok(api(`/doors/${puertas.main.id}`, admin, { method: "PATCH", body: { accessSchedule: { timezone: "UTC", rules: [{ days: [otroDia], from: "00:00", to: "00:00" }] } } }));
    expect(await ok(abrir(AUTH_ANA, puertas.main.id))).toMatchObject({ opened: false, reason: "OUTSIDE_SCHEDULE" });
    expect(await ok(api(`/doors/${puertas.main.id}/open`, admin, { method: "POST", body: {} }))).toMatchObject({ opened: true });
  });
});
