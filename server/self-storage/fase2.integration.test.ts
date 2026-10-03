/**
 * Self Storage · fase 2 (contratos + facturación + pagos + Stripe), por HTTP y
 * contra PostgreSQL de verdad.
 *
 * Stripe se sustituye por una pasarela en memoria (`fijarPasarela`), pero los
 * webhooks se FIRMAN con el SDK real y pasan por la verificación real: lo que
 * se prueba es el endpoint tal y como lo llamará Stripe.
 *
 * Pruebas obligatorias del encargo (marcadas con ⚑):
 *   ⚑ doble factura por mismo periodo          ⚑ numeración concurrente
 *   ⚑ webhook repetido                         ⚑ pago repetido
 *   ⚑ cliente A no ve factura de cliente B     ⚑ factura no cambia si cambia el cliente
 *   ⚑ cambio de precio del trastero no toca el contrato
 *   ⚑ SEPA processing no se trata como failed  ⚑ primer SEPA no activa por defecto
 *   ⚑ el pago reactiva sólo el bloqueo de impago
 *   ⚑ una suscripción cancelada en Stripe no termina el contrato
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
/** Los ids de evento de Stripe son únicos para siempre: cada ejecución usa los suyos. */
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

// Portal: el token ES el id del usuario de Supabase Auth (sólo en la prueba).
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

const EMPRESA = "00000000-0000-4000-a000-0000005522a1";
const admin = { usuario: "00000000-0000-4000-a000-000000552201", empresa: EMPRESA, nombre: "Admin" };
const empleado = { usuario: "00000000-0000-4000-a000-000000552202", empresa: EMPRESA, nombre: "Empleado" };
const AUTH_A = "00000000-0000-4000-a000-0000005522f1";
const AUTH_B = "00000000-0000-4000-a000-0000005522f2";

type Quien = { usuario: string; empresa: string; nombre: string };
type Respuesta = { status: number; body: any };

function api(ruta: string, quien: Quien, init?: { method?: string; body?: unknown }): Promise<Respuesta> {
  return fetch(`${base}/api/self-storage/admin${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "x-test-user": quien.usuario, "x-test-empresa": quien.empresa, "x-test-nombre": quien.nombre, "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}
function portal(ruta: string, authUser: string, init?: { method?: string; body?: unknown }): Promise<Respuesta> {
  return fetch(`${base}/api/self-storage/portal${ruta}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${authUser}`, "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}
async function ok(p: Promise<Respuesta>, estado = 200) {
  const r = await p;
  expect(r.status, JSON.stringify(r.body)).toBe(estado);
  return r.body;
}

// ── Pasarela de Stripe en memoria ───────────────────────────────────────────
const llamadas: { tipo: string; datos: any }[] = [];
let n = 0;
const pasarelaFalsa = {
  crearCliente: async (d: any) => (llamadas.push({ tipo: "cliente", datos: d }), { id: `cus_${++n}` }),
  crearProducto: async (d: any) => (llamadas.push({ tipo: "producto", datos: d }), { id: `prod_${++n}` }),
  crearCheckoutSuscripcion: async (d: any) => (llamadas.push({ tipo: "checkout_sub", datos: d }), { id: `cs_${++n}`, url: `https://checkout.test/${n}` }),
  crearCheckoutPago: async (d: any) => (llamadas.push({ tipo: "checkout_pago", datos: d }), { id: `cs_${++n}`, url: `https://checkout.test/${n}` }),
  crearCheckoutMetodo: async (d: any) => (llamadas.push({ tipo: "checkout_setup", datos: d }), { id: `cs_${++n}`, url: `https://checkout.test/${n}` }),
  listarMetodosPago: async () => [{ id: "pm_1", type: "card", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, isDefault: true }],
  fijarMetodoPorDefecto: async (...a: any[]) => void llamadas.push({ tipo: "default_pm", datos: a }),
  cancelarSuscripcion: async (id: string) => void llamadas.push({ tipo: "cancelar_sub", datos: id }),
};

// ── Webhooks firmados con el SDK real ───────────────────────────────────────
let eventoN = 0;
async function webhook(tipo: string, objeto: Record<string, unknown>, id = `evt_${Date.now()}_${++eventoN}`, firma?: string): Promise<Respuesta> {
  const payload = JSON.stringify({ id, object: "event", type: tipo, livemode: false, created: Math.floor(Date.now() / 1000), api_version: "2026-04-22.dahlia", data: { object: objeto } });
  const cabecera = firma ?? Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRETO });
  const r = await fetch(`${base}/api/self-storage/webhooks/stripe`, { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": cabecera }, body: payload });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

/** Una factura de Stripe tal como llega en `invoice.*` (API dahlia). */
function facturaStripe(d: { id: string; sub: string; contractId: string; lineas: { product: string; amount: number; start?: number; end?: number }[]; pagada?: boolean }) {
  const total = d.lineas.reduce((s, l) => s + l.amount, 0);
  return {
    id: d.id,
    object: "invoice",
    customer: "cus_x",
    total,
    amount_due: total,
    amount_paid: d.pagada ? total : 0,
    hosted_invoice_url: `https://invoice.stripe.test/${d.id}`,
    created: Math.floor(Date.now() / 1000),
    status_transitions: { finalized_at: Math.floor(Date.now() / 1000), paid_at: d.pagada ? Math.floor(Date.now() / 1000) : null },
    parent: { type: "subscription_details", subscription_details: { subscription: d.sub, metadata: { ss_contract_id: d.contractId } } },
    lines: {
      data: d.lineas.map((l, i) => ({
        id: `il_${d.id}_${i}`,
        amount: l.amount,
        quantity: 1,
        description: `Línea ${i}`,
        pricing: { price_details: { product: l.product } },
        period: { start: l.start ?? Math.floor(Date.now() / 1000), end: l.end ?? Math.floor(Date.now() / 1000) + 30 * 86400 },
      })),
    },
  };
}

// ── Datos ───────────────────────────────────────────────────────────────────
let centro: any, zona: any;
async function trastero(code: string, extra: Record<string, unknown> = {}) {
  return ok(api("/units", admin, { method: "POST", body: { centerId: centro.id, zoneId: zona.id, code, widthCm: 150, lengthCm: 200, heightCm: 250, monthlyPriceGross: 60, taxRate: 21, depositAmount: 60, ...extra } }), 201);
}
async function cliente(taxId: string, auth: string | null, email: string) {
  const c = await ok(api("/customers", admin, { method: "POST", body: { customerType: "individual", firstName: "Ana", lastName: taxId, taxId, phone: "600112233", email, address: "Calle Mayor 1", city: "Reus", postalCode: "43201" } }), 201);
  if (auth) await db.query(`UPDATE self_storage_customers SET auth_user_id = $2 WHERE id = $1`, [c.id, auth]);
  return c;
}
async function contrato(customerId: string, unitId: string, extra: Record<string, unknown> = {}) {
  return ok(api("/contracts", empleado, { method: "POST", body: { customerId, unitId, startDate: "2026-10-01", billingDay: 1, paymentMethod: "bank_transfer", ...extra } }), 201);
}
async function firmado(customerId: string, unitId: string, extra: Record<string, unknown> = {}) {
  const k = await contrato(customerId, unitId, extra);
  await ok(api(`/contracts/${k.id}/issue`, empleado, { method: "POST", body: {} }));
  return ok(api(`/contracts/${k.id}/sign`, empleado, { method: "POST", body: { signerName: "Ana Cliente", accepted: true } }));
}

async function limpiar() {
  for (const [t, trg] of [
    ["self_storage_audit_logs", "self_storage_audit_logs_immutable"],
    ["self_storage_floor_plans", "self_storage_floor_plans_immutable"],
    ["self_storage_contract_documents", "self_storage_contract_documents_guard"],
    ["self_storage_invoices", "self_storage_invoices_guard"],
    ["self_storage_invoice_items", "self_storage_invoice_items_guard"],
  ]) {
    await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
  }
  await db.query(`DELETE FROM self_storage_audit_logs WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_notifications WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_access_blocks WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_dunning_cases WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_payments WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_invoices WHERE empresa_id = $1 AND kind = 'rectifying'`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_invoices WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_contract_documents WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_contract_items WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_contracts WHERE empresa_id = $1`, [EMPRESA]);
  for (const t of ["self_storage_billing_items", "self_storage_sequences", "self_storage_customer_phones", "self_storage_customers", "self_storage_units", "self_storage_unit_types", "self_storage_zones", "self_storage_settings", "self_storage_centers"]) {
    await db.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [EMPRESA]);
  }
  for (const [t, trg] of [
    ["self_storage_audit_logs", "self_storage_audit_logs_immutable"],
    ["self_storage_floor_plans", "self_storage_floor_plans_immutable"],
    ["self_storage_contract_documents", "self_storage_contract_documents_guard"],
    ["self_storage_invoices", "self_storage_invoices_guard"],
    ["self_storage_invoice_items", "self_storage_invoice_items_guard"],
  ]) {
    await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
  }
  await db.query(`DELETE FROM self_storage_stripe_events WHERE payload::text LIKE '%' || $1 || '%'`, [EMPRESA]).catch(() => {});
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await db.query(`CREATE TABLE IF NOT EXISTS app_usuario_modulos (user_id UUID NOT NULL, modulo TEXT NOT NULL, rol TEXT NOT NULL, pantallas TEXT[], empresa_id UUID, centro_id UUID, UNIQUE (user_id, modulo))`);
  for (const [u, rol] of [[admin.usuario, "admin"], [empleado.usuario, "employee"]]) {
    await db.query(`INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'self-storage',$2) ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`, [u, rol]);
  }
  const { fijarPasarela } = await import("./integrations/stripe/pasarela.ts");
  fijarPasarela(pasarelaFalsa as any);
  const { mountSelfStorage, mountSelfStorageWebhooks } = await import("./index.ts");
  const app = express();
  mountSelfStorageWebhooks(app);
  app.use(express.json({ limit: "10mb" }));
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

describe.skipIf(!RUN)("Self Storage · fase 2 contra PostgreSQL", () => {
  let ana: any, bea: any;

  beforeEach(async () => {
    await limpiar();
    llamadas.length = 0;
    centro = await ok(api("/centers", admin, { method: "POST", body: { code: "REUS", name: "Reus", address: "Polígono 1", city: "Reus" } }), 201);
    zona = await ok(api(`/centers/${centro.id}/zones`, admin, { method: "POST", body: { code: "Z1", name: "Zona 1" } }), 201);
    await ok(api("/settings/billing.issuer", admin, { method: "PUT", body: { value: { name: "Mobilink Storage SL", taxId: "B12345674", address: "Av. Principal 1, 43201 Reus", email: "admin@mobilink.test" } } }));
    ana = await cliente("12345678Z", AUTH_A, "ana@example.com");
    bea = await cliente("87654321X", AUTH_B, "bea@example.com");
  });

  describe("contratos", () => {
    it("sin emisor configurado no se emite nada", async () => {
      await db.query(`DELETE FROM self_storage_settings WHERE empresa_id = $1 AND key = 'billing.issuer'`, [EMPRESA]);
      const u = await trastero("1");
      const k = await contrato(ana.id, u.id);
      const r = await api(`/contracts/${k.id}/issue`, empleado, { method: "POST", body: {} });
      expect(r.body.code).toBe("EMISOR_NO_CONFIGURADO");
    });

    it("ciclo manual completo: borrador → firma → primera factura → pago → activo, con historial", async () => {
      const u = await trastero("1");
      const k = await contrato(ana.id, u.id, { startDate: "2026-10-01", extras: [] });
      expect(k).toMatchObject({ status: "draft", listMonthlyPrice: 49.59, monthlyPrice: 49.59, monthlyPriceGross: 60, depositAmount: 60, collectionMethod: "manual" });
      expect(k.contractNumber).toMatch(/^C-\d{4}-000001$/);
      // Precio comercial distinto mientras es borrador.
      const editado = await ok(api(`/contracts/${k.id}`, empleado, { method: "PATCH", body: { monthlyPriceGross: 50 } }));
      expect(editado).toMatchObject({ monthlyPriceGross: 50, listMonthlyPrice: 49.59 });

      const emitido = await ok(api(`/contracts/${k.id}/issue`, empleado, { method: "POST", body: {} }));
      expect(emitido.status).toBe("pending_signature");
      expect(emitido.documents).toHaveLength(1);
      expect((await ok(api(`/units/${u.id}`, admin))).status).toBe("reserved");
      // Emitido, ya no se edita.
      expect((await api(`/contracts/${k.id}`, empleado, { method: "PATCH", body: { notes: "x" } })).body.code).toBe("CONTRATO_NO_EDITABLE");
      // El PDF se descarga.
      const pdf = await fetch(`${base}/api/self-storage/admin/contracts/${k.id}/documents/${emitido.documents[0].id}/pdf`, { headers: { "x-test-user": admin.usuario, "x-test-empresa": EMPRESA } });
      expect(pdf.status).toBe(200);
      expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");

      // Aceptar sin marcar la casilla no vale.
      expect((await api(`/contracts/${k.id}/sign`, empleado, { method: "POST", body: { signerName: "Ana" } })).status).toBe(422);
      const firmadoK = await ok(api(`/contracts/${k.id}/sign`, empleado, { method: "POST", body: { signerName: "Ana Cliente", accepted: true } }));
      expect(firmadoK.status).toBe("pending_payment");
      expect(firmadoK.documents[0]).toMatchObject({ status: "final", acceptedName: "Ana Cliente", acceptedByType: "staff" });
      // El documento firmado ya no se puede tocar.
      const e = await db.query(`UPDATE self_storage_contract_documents SET accepted_name = 'otro' WHERE id = $1`, [firmadoK.documents[0].id]).catch((x) => x);
      expect(e.code).toBe("42501");

      // Primera factura: alquiler del mes + fianza.
      const { items: fs } = await ok(api(`/invoices?contractId=${k.id}`, admin));
      expect(fs).toHaveLength(1);
      const f = await ok(api(`/invoices/${fs[0].id}`, admin));
      expect(f.invoiceNumber).toMatch(/^F-\d{4}-000001$/);
      expect(f.lines.map((l: any) => l.itemType)).toEqual(["rental", "deposit"]);
      expect(f).toMatchObject({ status: "pending", subtotal: 101.32, total: 110.0, customerName: "Ana 12345678Z", issuerTaxId: "B12345674" });

      await ok(api("/payments/manual", empleado, { method: "POST", body: { invoiceId: f.id, paymentMethod: "bank_transfer" } }), 201);
      const activo = await ok(api(`/contracts/${k.id}`, admin));
      expect(activo.status).toBe("active");
      expect((await ok(api(`/units/${u.id}`, admin))).status).toBe("occupied");

      // ⚑ pago repetido: la misma factura no se cobra dos veces.
      const otra = await api("/payments/manual", empleado, { method: "POST", body: { invoiceId: f.id, paymentMethod: "cash" } });
      expect(otra.body.code).toBe("FACTURA_YA_PAGADA");
      expect(await ok(api(`/payments?invoiceId=${f.id}`, admin))).toHaveLength(1);

      const historia = await ok(api(`/contracts/${k.id}/history`, admin));
      expect(historia.map((h: any) => h.action)).toEqual(
        expect.arrayContaining(["contract.created", "contract.price_changed", "contract.issued", "contract.signed", "invoice.issued", "invoice.paid", "contract.activated"])
      );
    });

    it("⚑ cambiar el precio del trastero no modifica un contrato existente", async () => {
      const u = await trastero("1");
      const k = await firmado(ana.id, u.id);
      await ok(api(`/units/${u.id}`, admin, { method: "PATCH", body: { monthlyPriceGross: 99 } }));
      const despues = await ok(api(`/contracts/${k.id}`, admin));
      expect(despues).toMatchObject({ monthlyPrice: 49.59, monthlyPriceGross: 60, listMonthlyPrice: 49.59 });
    });

    it("no hay dos contratos vivos sobre el mismo trastero, ni un contrato sobre un trastero en mantenimiento", async () => {
      const u = await trastero("1");
      await firmado(ana.id, u.id);
      const k2 = await contrato(bea.id, u.id);
      expect((await api(`/contracts/${k2.id}/issue`, empleado, { method: "POST", body: {} })).body.code).toBe("TRASTERO_NO_DISPONIBLE");
      const u2 = await trastero("2");
      await ok(api(`/units/${u2.id}/status`, admin, { method: "POST", body: { status: "maintenance", reason: "x" } }));
      const k3 = await contrato(bea.id, u2.id);
      expect((await api(`/contracts/${k3.id}/issue`, empleado, { method: "POST", body: {} })).body.code).toBe("TRASTERO_NO_DISPONIBLE");
    });

    it("cancelar antes de activar libera el trastero y anula la factura sin cobrar", async () => {
      const u = await trastero("1");
      const k = await firmado(ana.id, u.id);
      const c = await ok(api(`/contracts/${k.id}/cancel`, empleado, { method: "POST", body: { reason: "Ha cambiado de idea" } }));
      expect(c.status).toBe("cancelled");
      expect((await ok(api(`/units/${u.id}`, admin))).status).toBe("available");
      const { items } = await ok(api(`/invoices?customerId=${ana.id}`, admin));
      expect(items.map((i: any) => [i.kind, i.status]).sort()).toEqual([["rectifying", "paid"], ["rent", "cancelled"]]);
      // Un activo no se cancela: se finaliza.
      const u2 = await trastero("2");
      const k2 = await firmado(ana.id, u2.id);
      await ok(api(`/contracts/${k2.id}/activate`, admin, { method: "POST", body: { reason: "Pago confirmado por teléfono" } }));
      expect((await api(`/contracts/${k2.id}/cancel`, empleado, { method: "POST", body: { reason: "x" } })).body.code).toBe("TRANSICION_CONTRATO_NO_PERMITIDA");
    });

    it("la activación por excepción es de administrador y queda con su motivo", async () => {
      const u = await trastero("1");
      const k = await firmado(ana.id, u.id);
      expect((await api(`/contracts/${k.id}/activate`, empleado, { method: "POST", body: { reason: "x" } })).status).toBe(403);
      const a = await ok(api(`/contracts/${k.id}/activate`, admin, { method: "POST", body: { reason: "Cliente de confianza" } }));
      expect(a).toMatchObject({ status: "active", activationOverrideReason: "Cliente de confianza" });
    });
  });

  describe("facturación", () => {
    it("⚑ doble factura por mismo periodo: el trabajo y la base lo impiden", async () => {
      const u = await trastero("1");
      const k = await firmado(ana.id, u.id, { startDate: "2026-08-01" });
      await ok(api(`/contracts/${k.id}/activate`, admin, { method: "POST", body: { reason: "prueba" } }));
      const { facturarPeriodosManuales } = await import("./modules/facturas/service.ts");
      await facturarPeriodosManuales("2026-10-15");
      await facturarPeriodosManuales("2026-10-15"); // segunda pasada: nada nuevo
      const { items } = await ok(api(`/invoices?contractId=${k.id}`, admin));
      const periodos = items.map((i: any) => i.periodStart).sort();
      expect(periodos).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
      // Y aunque alguien lo intentara a mano en la base:
      const e = await db
        .query(
          `INSERT INTO self_storage_invoices (empresa_id, customer_id, contract_id, kind, collection_method, billing_period_start, billing_period_end) VALUES ($1,$2,$3,'rent','manual','2026-09-01','2026-09-30')`,
          [EMPRESA, ana.id, k.id]
        )
        .catch((x) => x);
      expect(e.constraint).toBe("self_storage_invoices_rent_period_uq");
    });

    it("⚑ numeración concurrente: 20 emisiones a la vez, 20 números seguidos sin repetir", async () => {
      const { items: conceptos } = { items: await ok(api("/billing-items", admin)) };
      const candado = conceptos.find((c: any) => c.code === "LOCK");
      const borradores = [];
      for (let i = 0; i < 20; i++) {
        borradores.push(await ok(api("/invoices", empleado, { method: "POST", body: { customerId: ana.id, lines: [{ billingItemId: candado.id, quantity: 1, unitPrice: 10 }] } }), 201));
      }
      const emitidas = await Promise.all(borradores.map((b) => api(`/invoices/${b.id}/issue`, empleado, { method: "POST", body: {} })));
      expect(emitidas.every((r) => r.status === 200)).toBe(true);
      const numeros = emitidas.map((r) => Number(r.body.invoiceNumber.split("-")[2])).sort((a, b) => a - b);
      expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it("⚑ la factura emitida no cambia aunque cambie el cliente (ni se puede tocar ni borrar)", async () => {
      const u = await trastero("1");
      const k = await firmado(ana.id, u.id);
      const { items } = await ok(api(`/invoices?contractId=${k.id}`, admin));
      const antes = await ok(api(`/invoices/${items[0].id}`, admin));
      await ok(api(`/customers/${ana.id}`, admin, { method: "PATCH", body: { firstName: "Anastasia", address: "Otra calle 99", city: "Tarragona" } }));
      const despues = await ok(api(`/invoices/${items[0].id}`, admin));
      expect(despues.customerName).toBe(antes.customerName);
      expect(despues.customerAddress).toBe(antes.customerAddress);
      expect(despues.customerAddress).toContain("Calle Mayor 1");
      // El PDF sale con los datos congelados.
      const r = await fetch(`${base}/api/self-storage/admin/invoices/${items[0].id}/pdf`, { headers: { "x-test-user": admin.usuario, "x-test-empresa": EMPRESA } });
      expect(r.status).toBe(200);
      // Ni el importe ni el número cambian, ni la factura se borra.
      expect((await db.query(`UPDATE self_storage_invoices SET total = 1, subtotal = 1, tax = 0 WHERE id = $1`, [items[0].id]).catch((x) => x)).code).toBe("42501");
      expect((await db.query(`DELETE FROM self_storage_invoices WHERE id = $1`, [items[0].id]).catch((x) => x)).code).toBe("42501");
      expect((await db.query(`UPDATE self_storage_invoice_items SET total = 0 WHERE invoice_id = $1`, [items[0].id]).catch((x) => x)).code).toBe("42501");
    });

    it("el IVA de una línea manual sale del catálogo, no del panel", async () => {
      const conceptos = await ok(api("/billing-items", admin));
      const fianza = conceptos.find((c: any) => c.itemType === "deposit");
      await ok(api(`/billing-items/${fianza.id}`, admin, { method: "PATCH", body: { taxRate: 21, taxExemptionReason: null } }));
      const b = await ok(api("/invoices", empleado, { method: "POST", body: { customerId: ana.id, lines: [{ billingItemId: fianza.id, quantity: 1, unitPrice: 100 }] } }), 201);
      expect(b.lines[0].taxRate).toBe(21);
      // El panel no puede colar un tipo impositivo.
      expect((await api("/invoices", empleado, { method: "POST", body: { customerId: ana.id, lines: [{ billingItemId: fianza.id, quantity: 1, taxRate: 0 }] } })).status).toBe(422);
    });

    it("una factura pendiente se anula con rectificativa; un borrador se borra", async () => {
      const conceptos = await ok(api("/billing-items", admin));
      const pen = conceptos.find((c: any) => c.code === "PENALTY");
      const b = await ok(api("/invoices", empleado, { method: "POST", body: { customerId: ana.id, lines: [{ billingItemId: pen.id, quantity: 1, unitPrice: 30 }] } }), 201);
      const emitida = await ok(api(`/invoices/${b.id}/issue`, empleado, { method: "POST", body: {} }));
      expect((await api(`/invoices/${b.id}`, empleado, { method: "DELETE" })).body.code).toBe("NO_ES_BORRADOR");
      expect((await api(`/invoices/${b.id}/rectify`, empleado, { method: "POST", body: { reason: "Error" } })).status).toBe(403);
      await ok(api(`/invoices/${b.id}/rectify`, admin, { method: "POST", body: { reason: "Penalización indebida" } }));
      const { items } = await ok(api(`/invoices?customerId=${ana.id}`, admin));
      const rect = items.find((i: any) => i.kind === "rectifying");
      expect(rect.invoiceNumber).toMatch(/^R-/);
      expect(rect.total).toBe(-emitida.total);
      expect(items.find((i: any) => i.id === b.id).status).toBe("cancelled");
      const b2 = await ok(api("/invoices", empleado, { method: "POST", body: { customerId: ana.id, lines: [{ billingItemId: pen.id, quantity: 1, unitPrice: 30 }] } }), 201);
      expect((await api(`/invoices/${b2.id}`, empleado, { method: "DELETE" })).status).toBe(204);
    });
  });

  describe("Stripe", () => {
    async function contratoStripe(metodo: "card" | "sepa", politica?: string) {
      if (politica) await ok(api("/settings/billing.first_sepa_payment_access_policy", admin, { method: "PUT", body: { value: politica } }));
      const u = await trastero(`S${++n}`);
      const k = await firmado(ana.id, u.id, { paymentMethod: metodo });
      const co = await ok(api(`/contracts/${k.id}/checkout`, empleado, { method: "POST", body: {} }));
      expect(co.url).toMatch(/^https:\/\/checkout\.test\//);
      const sub = llamadas.filter((l) => l.tipo === "checkout_sub").at(-1)!.datos;
      expect(sub.metodos).toEqual([metodo === "sepa" ? "sepa_debit" : "card"]);
      const productos = llamadas.filter((l) => l.tipo === "producto");
      const prodAlquiler = productos.find((p) => p.datos.metadata.ss_item_type === "rental")!;
      const prodFianza = productos.find((p) => p.datos.metadata.ss_item_type === "deposit")!;
      const ids = sub.lineas.map((l: any) => l.productId);
      return { k, u, sub: `sub_${k.id.slice(0, 8)}`, prodAlquiler: ids[0], prodFianza: ids[1], _p: [prodAlquiler, prodFianza] };
    }

    it("webhook sin firma válida: 400 y nada procesado", async () => {
      const r = await webhook("invoice.paid", { id: "in_x" }, "evt_malo", "t=1,v1=firma_falsa");
      expect(r.status).toBe(400);
      expect((await db.query(`SELECT 1 FROM self_storage_stripe_events WHERE event_id = 'evt_malo'`)).rows).toHaveLength(0);
    });

    it("tarjeta: invoice.paid activa el contrato; ⚑ webhook repetido no duplica nada; ⚑ otro aviso del mismo cobro tampoco", async () => {
      const s = await contratoStripe("card");
      await ok(Promise.resolve(await webhook("checkout.session.completed", { id: "cs_1", object: "checkout.session", mode: "subscription", payment_status: "paid", subscription: s.sub, invoice: "in_1", metadata: { ss_kind: "contract_subscription", ss_contract_id: s.k.id, ss_empresa_id: EMPRESA } })));
      const inv = facturaStripe({ id: `in_${s.k.id.slice(0, 6)}`, sub: s.sub, contractId: s.k.id, pagada: true, lineas: [{ product: s.prodAlquiler, amount: 6000 }, { product: s.prodFianza, amount: 6000 }] });
      const r1 = await webhook("invoice.paid", inv, `evt_pagada_1_${RONDA}`);
      expect(r1.status).toBe(200);
      const r2 = await webhook("invoice.paid", inv, `evt_pagada_1_${RONDA}`); // Stripe lo reenvía
      expect(r2.body.duplicate).toBe(true);
      const r3 = await webhook("invoice.paid", inv, `evt_pagada_2_${RONDA}`); // otro evento, mismo cobro
      expect(r3.status).toBe(200);

      const k = await ok(api(`/contracts/${s.k.id}`, admin));
      expect(k.status).toBe("active");
      const { items } = await ok(api(`/invoices?contractId=${s.k.id}`, admin));
      const deStripe = items.filter((i: any) => i.collectionMethod === "stripe");
      expect(deStripe).toHaveLength(1);
      expect(deStripe[0]).toMatchObject({ status: "paid", total: 120 });
      const f = await ok(api(`/invoices/${deStripe[0].id}`, admin));
      // Base + IVA cuadran al céntimo con lo cobrado por Stripe; la fianza con su IVA del catálogo (0).
      expect(f.lines.map((l: any) => [l.itemType, l.subtotal, l.taxAmount, l.total])).toEqual([["rental", 49.59, 10.41, 60], ["deposit", 60, 0, 60]]);
      expect(await ok(api(`/payments?contractId=${s.k.id}`, admin))).toHaveLength(1);
      expect((await db.query(`SELECT processing_status FROM self_storage_stripe_events WHERE event_id = ANY($1) ORDER BY event_id`, [[`evt_pagada_1_${RONDA}`, `evt_pagada_2_${RONDA}`]])).rows.map((r) => r.processing_status)).toEqual(["processed", "processed"]);
    });

    it("⚑ primer SEPA en processing NO activa el contrato por defecto; se activa al confirmarse", async () => {
      const s = await contratoStripe("sepa");
      await ok(Promise.resolve(await webhook("checkout.session.completed", { id: "cs_2", mode: "subscription", payment_status: "unpaid", amount_total: 12000, subscription: s.sub, invoice: "in_sepa1", metadata: { ss_kind: "contract_subscription", ss_contract_id: s.k.id, ss_empresa_id: EMPRESA } })));
      let k = await ok(api(`/contracts/${s.k.id}`, admin));
      expect(k).toMatchObject({ status: "pending_payment", firstPaymentStatus: "processing", firstSepaPaymentAccessPolicy: "wait_for_success" });
      const pagos = await ok(api(`/payments?contractId=${s.k.id}`, admin));
      expect(pagos[0]).toMatchObject({ status: "processing", paymentMethod: "sepa" });
      await webhook("invoice.paid", facturaStripe({ id: "in_sepa1", sub: s.sub, contractId: s.k.id, pagada: true, lineas: [{ product: s.prodAlquiler, amount: 6000 }, { product: s.prodFianza, amount: 6000 }] }));
      k = await ok(api(`/contracts/${s.k.id}`, admin));
      expect(k.status).toBe("active");
      expect(await ok(api(`/payments?contractId=${s.k.id}`, admin))).toHaveLength(1);
    });

    it("primer SEPA con política allow_while_processing: se activa en processing", async () => {
      const s = await contratoStripe("sepa", "allow_while_processing");
      await webhook("checkout.session.completed", { id: "cs_3", mode: "subscription", payment_status: "unpaid", amount_total: 12000, subscription: s.sub, invoice: "in_sepa2", metadata: { ss_kind: "contract_subscription", ss_contract_id: s.k.id, ss_empresa_id: EMPRESA } });
      expect((await ok(api(`/contracts/${s.k.id}`, admin))).status).toBe("active");
    });

    it("⚑ una mensualidad SEPA en processing no es un impago; ⚑ un fallo real sí, y ⚑ el pago levanta SÓLO el bloqueo de impago", async () => {
      const s = await contratoStripe("sepa", "allow_while_processing");
      await webhook("checkout.session.completed", { id: "cs_4", mode: "subscription", payment_status: "unpaid", amount_total: 12000, subscription: s.sub, invoice: "in_p1", metadata: { ss_kind: "contract_subscription", ss_contract_id: s.k.id, ss_empresa_id: EMPRESA } });
      await webhook("invoice.paid", facturaStripe({ id: "in_p1", sub: s.sub, contractId: s.k.id, pagada: true, lineas: [{ product: s.prodAlquiler, amount: 6000 }, { product: s.prodFianza, amount: 6000 }] }));

      // Mensualidad: Stripe la emite y el SEPA queda en proceso varios días.
      const mes = facturaStripe({ id: "in_p2", sub: s.sub, contractId: s.k.id, lineas: [{ product: s.prodAlquiler, amount: 6000, start: 1793491200, end: 1796083200 }] });
      await webhook("invoice.finalized", mes);
      await webhook("payment_intent.processing", { id: "pi_mes", object: "payment_intent", amount: 6000, metadata: {} });
      const { marcarVencidas, ejecutarImpagos } = await import("./modules/impagos/service.ts");
      await marcarVencidas("2027-12-31"); // muy pasada la fecha: aun así no vence por fecha
      await ejecutarImpagos(new Date(Date.now() + 60 * 86_400_000));
      expect((await ok(api(`/contracts/${s.k.id}`, admin))).status).toBe("active");
      expect(await ok(api("/dunning?status=open", admin))).toHaveLength(0);
      const fMes = (await ok(api(`/invoices?contractId=${s.k.id}`, admin))).items.find((i: any) => i.periodStart === "2026-11-01");
      expect(fMes.status).toBe("pending");

      // El recibo vuelve devuelto: ahora sí, impago.
      await webhook("invoice.payment_failed", mes);
      expect((await ok(api(`/invoices/${fMes.id}`, admin))).status).toBe("overdue");
      expect(await ok(api("/dunning?status=open", admin))).toHaveLength(1);
      // Pasan los días: avisos y suspensión.
      const r = await ejecutarImpagos(new Date(Date.now() + 11 * 86_400_000));
      expect(r).toMatchObject({ avisos: 2, suspensiones: 1 });
      expect(await ejecutarImpagos(new Date(Date.now() + 12 * 86_400_000))).toMatchObject({ avisos: 0, suspensiones: 0 }); // reentrante
      let k = await ok(api(`/contracts/${s.k.id}`, admin));
      expect(k.status).toBe("suspended");
      // Además, un bloqueo de seguridad.
      await ok(api(`/contracts/${s.k.id}/suspend`, empleado, { method: "POST", body: { reason: "security", notes: "Incidente en el centro" } }));
      k = await ok(api(`/contracts/${s.k.id}`, admin));
      expect(k.blocks.filter((b: any) => !b.liftedAt).map((b: any) => b.reason).sort()).toEqual(["payment", "security"]);
      // El de impago no se levanta a mano.
      const bPago = k.blocks.find((b: any) => b.reason === "payment");
      expect((await api(`/contracts/${s.k.id}/blocks/${bPago.id}/lift`, admin, { method: "POST", body: { reason: "x" } })).body.code).toBe("BLOQUEO_DE_IMPAGO");

      // Se cobra: sólo cae el bloqueo de impago; el contrato sigue suspendido.
      await webhook("invoice.paid", { ...mes, amount_paid: 6000, status_transitions: { finalized_at: mes.status_transitions.finalized_at, paid_at: Math.floor(Date.now() / 1000) } });
      k = await ok(api(`/contracts/${s.k.id}`, admin));
      expect(k.blocks.filter((b: any) => !b.liftedAt).map((b: any) => b.reason)).toEqual(["security"]);
      expect(k.status).toBe("suspended");
      expect(await ok(api("/dunning?status=open", admin))).toHaveLength(0);
      // Seguridad: sólo un administrador lo levanta; entonces vuelve a activo.
      const bSeg = k.blocks.find((b: any) => b.reason === "security" && !b.liftedAt);
      expect((await api(`/contracts/${s.k.id}/blocks/${bSeg.id}/lift`, empleado, { method: "POST", body: { reason: "Resuelto" } })).status).toBe(403);
      k = await ok(api(`/contracts/${s.k.id}/blocks/${bSeg.id}/lift`, admin, { method: "POST", body: { reason: "Resuelto" } }));
      expect(k.status).toBe("active");
    });

    it("⚑ una suscripción cancelada en Stripe no termina el contrato", async () => {
      const s = await contratoStripe("card");
      await webhook("checkout.session.completed", { id: "cs_5", mode: "subscription", payment_status: "paid", subscription: s.sub, metadata: { ss_kind: "contract_subscription", ss_contract_id: s.k.id, ss_empresa_id: EMPRESA } });
      await webhook("invoice.paid", facturaStripe({ id: "in_c1", sub: s.sub, contractId: s.k.id, pagada: true, lineas: [{ product: s.prodAlquiler, amount: 6000 }] }));
      await webhook("customer.subscription.updated", { id: s.sub, object: "subscription", status: "past_due", metadata: { ss_contract_id: s.k.id } });
      expect((await ok(api(`/contracts/${s.k.id}`, admin))).status).toBe("active");
      await webhook("customer.subscription.deleted", { id: s.sub, object: "subscription", status: "canceled", metadata: { ss_contract_id: s.k.id } });
      const k = await ok(api(`/contracts/${s.k.id}`, admin));
      expect(k).toMatchObject({ status: "active", stripeSubscriptionStatus: "canceled" });
      const hist = await ok(api(`/contracts/${s.k.id}/history`, admin));
      expect(hist.map((h: any) => h.action)).toContain("contract.subscription_cancelled_externally");
      const { rows } = await db.query(`SELECT template FROM self_storage_notifications WHERE contract_id = $1`, [s.k.id]);
      expect(rows.map((r) => r.template)).toContain("staff.subscription_cancelled");
    });

    it("finalizar pide la cancelación de la suscripción y libera el trastero", async () => {
      const s = await contratoStripe("card");
      await webhook("checkout.session.completed", { id: "cs_6", mode: "subscription", payment_status: "paid", subscription: s.sub, metadata: { ss_kind: "contract_subscription", ss_contract_id: s.k.id, ss_empresa_id: EMPRESA } });
      await webhook("invoice.paid", facturaStripe({ id: "in_t1", sub: s.sub, contractId: s.k.id, pagada: true, lineas: [{ product: s.prodAlquiler, amount: 6000 }] }));
      const f = await ok(api(`/contracts/${s.k.id}/terminate`, admin, { method: "POST", body: { reason: "Baja del cliente" } }));
      expect(f.status).toBe("terminated");
      expect(llamadas.some((l) => l.tipo === "cancelar_sub" && l.datos === s.sub)).toBe(true);
      expect((await ok(api(`/units/${s.u.id}`, admin))).status).toBe("available");
      await webhook("customer.subscription.deleted", { id: s.sub, object: "subscription", status: "canceled", metadata: { ss_contract_id: s.k.id } });
      const hist = await ok(api(`/contracts/${s.k.id}/history`, admin));
      expect(hist.map((h: any) => h.action)).not.toContain("contract.subscription_cancelled_externally");
    });

    it("reembolso total: pago reembolsado, factura reembolsada y rectificativa", async () => {
      const s = await contratoStripe("card");
      await webhook("checkout.session.completed", { id: "cs_7", mode: "subscription", payment_status: "paid", subscription: s.sub, metadata: { ss_kind: "contract_subscription", ss_contract_id: s.k.id, ss_empresa_id: EMPRESA } });
      const inv = facturaStripe({ id: "in_r1", sub: s.sub, contractId: s.k.id, pagada: true, lineas: [{ product: s.prodAlquiler, amount: 6000 }] });
      await webhook("invoice.paid", { ...inv, payments: { data: [{ payment: { payment_intent: "pi_r1" } }] } });
      const r = await webhook("charge.refunded", { id: "ch_r1", object: "charge", payment_intent: "pi_r1", amount: 6000, amount_refunded: 6000 });
      expect(r.status).toBe(200);
      const pagos = await ok(api(`/payments?contractId=${s.k.id}`, admin));
      expect(pagos[0]).toMatchObject({ status: "refunded", refundedAmount: 60 });
      const { items } = await ok(api(`/invoices?contractId=${s.k.id}`, admin));
      expect(items.find((i: any) => i.kind === "rent").status).toBe("refunded");
      expect(items.find((i: any) => i.kind === "rectifying").total).toBe(-60);
    });
  });

  describe("portal del cliente", () => {
    it("⚑ el cliente A no ve (ni descarga, ni paga) facturas del cliente B", async () => {
      const u1 = await trastero("1");
      const u2 = await trastero("2");
      await firmado(ana.id, u1.id);
      const kB = await firmado(bea.id, u2.id);
      const { items } = await ok(api(`/invoices?customerId=${bea.id}`, admin));
      const facturaB = items[0].id;

      const propias = await ok(portal("/invoices", AUTH_A));
      expect(propias).toHaveLength(1);
      expect(propias.map((f: any) => f.id)).not.toContain(facturaB);
      expect((await portal(`/invoices/${facturaB}/pdf`, AUTH_A)).status).toBe(404);
      expect((await portal(`/invoices/${facturaB}/pay`, AUTH_A, { method: "POST", body: {} })).status).toBe(404);
      expect((await portal(`/contracts/${kB.id}`, AUTH_A)).status).toBe(404);
      const pdfB = await fetch(`${base}/api/self-storage/portal/invoices/${facturaB}/pdf`, { headers: { Authorization: `Bearer ${AUTH_B}` } });
      expect(pdfB.status).toBe(200);
      // Un usuario sin ficha de cliente no entra; sin sesión, tampoco.
      expect((await portal("/me", "00000000-0000-4000-a000-0000005522ff")).status).toBe(403);
      expect((await fetch(`${base}/api/self-storage/portal/me`)).status).toBe(401);
      // Y el portal no es el panel.
      expect((await fetch(`${base}/api/self-storage/admin/contracts`, { headers: { Authorization: `Bearer ${AUTH_A}` } })).status).not.toBe(200);
    });

    it("el cliente no ve borradores ni contratos cancelados antes de emitírselos", async () => {
      const u1 = await trastero("1");
      const u2 = await trastero("2");
      const borrador = await contrato(ana.id, u1.id);
      const cancelado = await contrato(ana.id, u2.id);
      await ok(api(`/contracts/${cancelado.id}/cancel`, empleado, { method: "POST", body: { reason: "Se equivocó de trastero" } }));
      expect(await ok(portal("/contracts", AUTH_A))).toEqual([]);
      expect((await portal(`/contracts/${borrador.id}`, AUTH_A)).status).toBe(404);
      expect((await portal(`/contracts/${cancelado.id}`, AUTH_A)).status).toBe(404);
      // Emitido sí lo ve, y sigue viéndolo si luego se cancela.
      await ok(api(`/contracts/${borrador.id}/issue`, empleado, { method: "POST", body: {} }));
      await ok(api(`/contracts/${borrador.id}/cancel`, empleado, { method: "POST", body: { reason: "No lo quiere" } }));
      expect((await ok(portal("/contracts", AUTH_A))).map((k: any) => k.status)).toEqual(["cancelled"]);
    });

    it("el cliente acepta su contrato desde el portal y ve su deuda; sin notas internas", async () => {
      const u = await trastero("1");
      const k = await contrato(ana.id, u.id, { notes: "Cliente difícil (interno)" });
      await ok(api(`/contracts/${k.id}/issue`, empleado, { method: "POST", body: {} }));
      const aceptado = await ok(portal(`/contracts/${k.id}/accept`, AUTH_A, { method: "POST", body: { signerName: "Ana", accepted: true } }));
      expect(aceptado.status).toBe("pending_payment");
      expect(JSON.stringify(aceptado)).not.toContain("difícil");
      expect(aceptado).not.toHaveProperty("notes");
      expect(aceptado).not.toHaveProperty("stripeSubscriptionId");
      // Por transferencia: el primer pago no se hace online.
      expect(aceptado.canPayFirstOnline).toBe(false);
      const k2 = await ok(api(`/contracts/${k.id}`, admin));
      expect(k2.documents[0]).toMatchObject({ acceptedByType: "customer", status: "final" });
      const me = await ok(portal("/me", AUTH_A));
      expect(me.debt).toMatchObject({ pendiente: 120, facturas: 1 });
      const pago = await ok(portal(`/invoices/${aceptado.invoices[0].id}/pay`, AUTH_A, { method: "POST", body: {} }));
      expect(pago.url).toMatch(/^https:\/\/checkout\.test\//);
      // Pagar desde el portal NO marca nada: hasta que llega el webhook, sigue pendiente.
      expect((await ok(portal("/invoices", AUTH_A)))[0].status).toBe("pending");
      const meta = llamadas.filter((l) => l.tipo === "checkout_pago").at(-1)!.datos.metadata;
      await webhook("payment_intent.succeeded", { id: "pi_portal", object: "payment_intent", amount: 12000, amount_received: 12000, latest_charge: "ch_portal", payment_method_types: ["card"], metadata: meta });
      expect((await ok(portal("/invoices", AUTH_A)))[0].status).toBe("paid");
      expect((await ok(api(`/contracts/${k.id}`, admin))).status).toBe("active");
    });
  });
});
