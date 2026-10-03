/**
 * Self Storage · fase 1, por HTTP y contra PostgreSQL de verdad.
 *
 * Lo que sólo se puede probar con la base delante: el aislamiento entre
 * empresas vive en las consultas, la duplicidad en los UNIQUE, la jerarquía
 * en las FKs compuestas, los estados en un FOR UPDATE y la importación en una
 * transacción. Bloques:
 *
 *   1  aislamiento entre empresas (404, no 403)
 *   2  duplicidad de trastero (número + centro)
 *   3  restricciones FK (zona/tipo de otro centro, cliente de otra empresa…)
 *   4  estados del trastero (manual / sistema, con contrato o reserva)
 *   5  doble contratación imposible en la base (también en concurrencia)
 *   6  clientes (NIF normalizado, duplicados, bloqueo con motivo, teléfonos)
 *   7  importación: dry-run, confirmar, reimportar, duplicados, concurrencia
 *   8  plano: SVG saneado, vínculos, vista según rol
 *   9  permisos por rol, auditoría inmutable y vocabulario igual que la base
 *  10  aislamiento de módulo en la base: ninguna FK sale de self_storage_*
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_STATUSES, CUSTOMER_STATUSES, CUSTOMER_TYPES, UNIT_STATUSES } from "../../src/modules/self-storage/types/enums.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

vi.mock("../core/auth.ts", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.authCtx = {
      userId: String(req.headers["x-test-user"] ?? ""),
      username: "prueba",
      nombre: String(req.headers["x-test-nombre"] ?? "Prueba"),
      empresaId: String(req.headers["x-test-empresa"] ?? ""),
      esSuperadmin: req.headers["x-test-superadmin"] === "1",
    };
    next();
  },
  requireModule: () => (_req: any, _res: any, next: any) => next(),
}));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;

const EMPRESA_A = "00000000-0000-4000-a000-0000005500a1";
const EMPRESA_B = "00000000-0000-4000-a000-0000005500b1";
const EMPRESAS = [EMPRESA_A, EMPRESA_B];

type Quien = { usuario: string; empresa: string; nombre: string; superadmin?: boolean };
const adminA: Quien = { usuario: "00000000-0000-4000-a000-000000550001", empresa: EMPRESA_A, nombre: "Admin A" };
const empleadoA: Quien = { usuario: "00000000-0000-4000-a000-000000550002", empresa: EMPRESA_A, nombre: "Empleado A" };
const mantA: Quien = { usuario: "00000000-0000-4000-a000-000000550003", empresa: EMPRESA_A, nombre: "Mantenimiento A" };
const sinRolA: Quien = { usuario: "00000000-0000-4000-a000-000000550004", empresa: EMPRESA_A, nombre: "Sin rol" };
const adminB: Quien = { usuario: "00000000-0000-4000-a000-000000550005", empresa: EMPRESA_B, nombre: "Admin B" };
const superA: Quien = { usuario: "00000000-0000-4000-a000-000000550006", empresa: EMPRESA_A, nombre: "Super", superadmin: true };

type Respuesta = { status: number; body: any };

function api(ruta: string, quien: Quien, init?: { method?: string; body?: unknown }): Promise<Respuesta> {
  return fetch(`${base}/api/self-storage/admin${ruta}`, {
    method: init?.method ?? "GET",
    headers: {
      "x-test-user": quien.usuario,
      "x-test-empresa": quien.empresa,
      "x-test-nombre": quien.nombre,
      ...(quien.superadmin ? { "x-test-superadmin": "1" } : {}),
      "Content-Type": "application/json",
    },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
}

async function ok(p: Promise<Respuesta>, estado = 200): Promise<any> {
  const r = await p;
  expect(r.status, JSON.stringify(r.body)).toBe(estado);
  return r.body;
}

async function centro(quien: Quien, code: string) {
  return ok(api("/centers", quien, { method: "POST", body: { code, name: `Centro ${code}` } }), 201);
}
async function zona(quien: Quien, centerId: string, code: string) {
  return ok(api(`/centers/${centerId}/zones`, quien, { method: "POST", body: { code, name: `Zona ${code}` } }), 201);
}
const datosTrastero = (centerId: string, zoneId: string, code: string, extra: Record<string, unknown> = {}) => ({
  centerId,
  zoneId,
  code,
  widthCm: 150,
  lengthCm: 200,
  heightCm: 250,
  monthlyPriceGross: 60,
  ...extra,
});
async function trastero(quien: Quien, centerId: string, zoneId: string, code: string, extra: Record<string, unknown> = {}) {
  return ok(api("/units", quien, { method: "POST", body: datosTrastero(centerId, zoneId, code, extra) }), 201);
}
async function cliente(quien: Quien, taxId: string, extra: Record<string, unknown> = {}) {
  return ok(
    api("/customers", quien, {
      method: "POST",
      body: { customerType: "individual", firstName: "Juan", lastName: "Pérez", taxId, phone: "600112233", email: "juan@example.com", ...extra },
    }),
    201
  );
}

/** Contrato vivo insertado a mano: la lógica de contratos es de la fase 2. */
async function contratoVivo(empresaId: string, centerId: string, customerId: string, unitId: string, numero: string, status = "active") {
  const { rows } = await db.query(
    `INSERT INTO self_storage_contracts (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date,
       monthly_price, tax_rate, billing_day, status, signed_at, activated_at)
     VALUES ($1,$2,$3,$4,$5,current_date,49.59,21,1,$6::self_storage_contract_status,now(),
             CASE WHEN $6::text IN ('active','suspended') THEN now() END) RETURNING id`,
    [empresaId, centerId, numero, customerId, unitId, status]
  );
  return rows[0].id as string;
}

async function errorPg(sql: string, params: unknown[]): Promise<{ code?: string; constraint?: string } | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return e as { code?: string; constraint?: string };
  }
}

async function limpiar() {
  await db.query(`ALTER TABLE self_storage_audit_logs DISABLE TRIGGER self_storage_audit_logs_immutable`);
  await db.query(`DELETE FROM self_storage_audit_logs WHERE empresa_id = ANY($1)`, [EMPRESAS]);
  await db.query(`ALTER TABLE self_storage_audit_logs ENABLE TRIGGER self_storage_audit_logs_immutable`);
  await db.query(`ALTER TABLE self_storage_floor_plans DISABLE TRIGGER self_storage_floor_plans_immutable`);
  await db.query(`DELETE FROM self_storage_floor_plans WHERE empresa_id = ANY($1)`, [EMPRESAS]);
  await db.query(`ALTER TABLE self_storage_floor_plans ENABLE TRIGGER self_storage_floor_plans_immutable`);
  await db.query(`DELETE FROM self_storage_unit_import_rows WHERE import_id IN (SELECT id FROM self_storage_unit_imports WHERE empresa_id = ANY($1))`, [EMPRESAS]);
  for (const t of [
    "self_storage_unit_imports",
    "self_storage_contract_members",
    "self_storage_contracts",
    "self_storage_reservations",
    "self_storage_customer_phones",
    "self_storage_customers",
    "self_storage_units",
    "self_storage_unit_types",
    "self_storage_zones",
    "self_storage_settings",
    "self_storage_centers",
  ]) {
    await db.query(`DELETE FROM ${t} WHERE empresa_id = ANY($1)`, [EMPRESAS]);
  }
}

beforeAll(async () => {
  if (!RUN) return;
  db = (await import("../db.ts")).default;
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_usuario_modulos (
      user_id UUID NOT NULL, modulo TEXT NOT NULL, rol TEXT NOT NULL, pantallas TEXT[],
      empresa_id UUID, centro_id UUID, UNIQUE (user_id, modulo)
    )`);
  for (const [u, rol] of [
    [adminA.usuario, "admin"],
    [empleadoA.usuario, "employee"],
    [mantA.usuario, "maintenance"],
    [adminB.usuario, "admin"],
  ]) {
    await db.query(
      `INSERT INTO app_usuario_modulos (user_id, modulo, rol) VALUES ($1,'self-storage',$2)
       ON CONFLICT (user_id, modulo) DO UPDATE SET rol = EXCLUDED.rol`,
      [u, rol]
    );
  }
  const { createSelfStorageAdminRouter } = await import("./router.ts");
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/self-storage/admin", createSelfStorageAdminRouter());
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

describe.skipIf(!RUN)("Self Storage · fase 1 contra PostgreSQL", () => {
  beforeEach(limpiar);

  // ── 1 ──────────────────────────────────────────────────────────────────────
  describe("1 · aislamiento entre empresas", () => {
    it("la empresa B no ve ni toca nada de la A: 404, nunca 403", async () => {
      const cA = await centro(adminA, "REUS");
      const zA = await zona(adminA, cA.id, "Z1");
      const uA = await trastero(adminA, cA.id, zA.id, "1");
      const clA = await cliente(adminA, "12345678Z");

      expect((await ok(api("/centers", adminB))).map((c: any) => c.id)).not.toContain(cA.id);
      expect((await api(`/centers/${cA.id}`, adminB)).status).toBe(404);
      expect((await api(`/centers/${cA.id}/zones`, adminB)).status).toBe(404);
      expect((await api(`/units/${uA.id}`, adminB)).status).toBe(404);
      expect((await api(`/units/${uA.id}`, adminB, { method: "PATCH", body: { monthlyPriceGross: 1 } })).status).toBe(404);
      expect((await api(`/units/${uA.id}/status`, adminB, { method: "POST", body: { status: "blocked", reason: "x" } })).status).toBe(404);
      expect((await api(`/customers/${clA.id}`, adminB)).status).toBe(404);
      expect((await api(`/customers/${clA.id}`, adminB, { method: "PATCH", body: { email: "robado@x.es" } })).status).toBe(404);
      expect((await ok(api("/customers", adminB))).total).toBe(0);
      expect((await ok(api(`/units?centerId=${cA.id}`, adminB))).length).toBe(0);
      // Crear en un centro ajeno, con una zona ajena:
      expect((await api("/units", adminB, { method: "POST", body: datosTrastero(cA.id, zA.id, "X") })).status).toBe(404);
      expect((await api(`/centers/${cA.id}/zones`, adminB, { method: "POST", body: { code: "ZX", name: "x" } })).status).toBe(404);

      // El cliente de A sigue intacto.
      expect((await ok(api(`/customers/${clA.id}`, adminA))).email).toBe("juan@example.com");
    });

    it("el mismo NIF y el mismo código de centro pueden existir en dos empresas", async () => {
      await centro(adminA, "REUS");
      await centro(adminB, "REUS");
      await cliente(adminA, "12345678Z");
      await cliente(adminB, "12345678Z");
    });

    it("un id con mala forma es «no existe», no un 500", async () => {
      expect((await api("/units/no-es-un-uuid", adminA)).status).toBe(404);
    });
  });

  // ── 2 ──────────────────────────────────────────────────────────────────────
  describe("2 · duplicidad de trastero", () => {
    it("número + centro es único; el mismo número en otro centro, no choca", async () => {
      const c1 = await centro(adminA, "REUS");
      const c2 = await centro(adminA, "TGN");
      const z1 = await zona(adminA, c1.id, "Z1");
      const z2 = await zona(adminA, c2.id, "Z1");
      await trastero(adminA, c1.id, z1.id, "2-014");
      const dup = await api("/units", adminA, { method: "POST", body: datosTrastero(c1.id, z1.id, "2-014") });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe("TRASTERO_DUPLICADO");
      // Mayúsculas/minúsculas y espacios: el mismo número.
      expect((await api("/units", adminA, { method: "POST", body: datosTrastero(c1.id, z1.id, " a-1 ") })).status).toBe(201);
      expect((await api("/units", adminA, { method: "POST", body: datosTrastero(c1.id, z1.id, "A-1") })).body.code).toBe("TRASTERO_DUPLICADO");
      await trastero(adminA, c2.id, z2.id, "2-014");
    });

    it("renombrar un trastero al número de otro también choca", async () => {
      const c = await centro(adminA, "REUS");
      const z = await zona(adminA, c.id, "Z1");
      await trastero(adminA, c.id, z.id, "1");
      const u2 = await trastero(adminA, c.id, z.id, "2");
      expect((await api(`/units/${u2.id}`, adminA, { method: "PATCH", body: { code: "1" } })).body.code).toBe("TRASTERO_DUPLICADO");
    });
  });

  // ── 3 ──────────────────────────────────────────────────────────────────────
  describe("3 · restricciones FK", () => {
    it("zona de otro centro: la FK compuesta lo impide", async () => {
      const c1 = await centro(adminA, "REUS");
      const c2 = await centro(adminA, "TGN");
      const zOtra = await zona(adminA, c2.id, "Z1");
      const r = await api("/units", adminA, { method: "POST", body: datosTrastero(c1.id, zOtra.id, "1") });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("ZONA_DE_OTRO_CENTRO");
      const z1 = await zona(adminA, c1.id, "Z1");
      const u = await trastero(adminA, c1.id, z1.id, "1");
      expect((await api(`/units/${u.id}`, adminA, { method: "PATCH", body: { zoneId: zOtra.id } })).body.code).toBe("ZONA_DE_OTRO_CENTRO");
    });

    it("tipo de otro centro no vale; un tipo común sí", async () => {
      const c1 = await centro(adminA, "REUS");
      const c2 = await centro(adminA, "TGN");
      const z1 = await zona(adminA, c1.id, "Z1");
      const tipoTgn = await ok(api("/unit-types", adminA, { method: "POST", body: { centerId: c2.id, code: "BOX-3", name: "3 m²", widthCm: 150, lengthCm: 200, heightCm: 250 } }), 201);
      const tipoComun = await ok(api("/unit-types", adminA, { method: "POST", body: { code: "BOX-3", name: "3 m²", widthCm: 150, lengthCm: 200, heightCm: 250 } }), 201);
      expect(tipoComun.nominalAreaM2).toBe(3);
      expect(tipoComun.nominalVolumeM3).toBe(7.5);
      const r = await api("/units", adminA, { method: "POST", body: datosTrastero(c1.id, z1.id, "1", { unitTypeId: tipoTgn.id }) });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("TIPO_DE_OTRO_CENTRO");
      const u = await trastero(adminA, c1.id, z1.id, "1", { unitTypeId: tipoComun.id });
      expect(u.unitType.id).toBe(tipoComun.id);
    });

    it("tipo de otra empresa: no existe", async () => {
      const cA = await centro(adminA, "REUS");
      const zA = await zona(adminA, cA.id, "Z1");
      const tipoB = await ok(api("/unit-types", adminB, { method: "POST", body: { code: "B", name: "B", widthCm: 100, lengthCm: 100, heightCm: 200 } }), 201);
      const r = await api("/units", adminA, { method: "POST", body: datosTrastero(cA.id, zA.id, "1", { unitTypeId: tipoB.id }) });
      expect(r.status).toBe(422);
    });

    it("un contrato no puede unir un cliente de una empresa con un trastero de otra", async () => {
      const cA = await centro(adminA, "REUS");
      const zA = await zona(adminA, cA.id, "Z1");
      const uA = await trastero(adminA, cA.id, zA.id, "1");
      const clB = await cliente(adminB, "12345678Z");
      const e = await errorPg(
        `INSERT INTO self_storage_contracts (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date, monthly_price, tax_rate, billing_day)
         VALUES ($1,$2,'X',$3,$4,current_date,1,21,1)`,
        [EMPRESA_A, cA.id, clB.id, uA.id]
      );
      expect(e?.code).toBe("23503");
      expect(e?.constraint).toBe("self_storage_contracts_customer_fk");
    });

    it("un trastero de un centro no puede contratarse «desde» otro centro", async () => {
      const c1 = await centro(adminA, "REUS");
      const c2 = await centro(adminA, "TGN");
      const z1 = await zona(adminA, c1.id, "Z1");
      const u = await trastero(adminA, c1.id, z1.id, "1");
      const cl = await cliente(adminA, "12345678Z");
      const e = await errorPg(
        `INSERT INTO self_storage_contracts (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date, monthly_price, tax_rate, billing_day)
         VALUES ($1,$2,'X',$3,$4,current_date,1,21,1)`,
        [EMPRESA_A, c2.id, cl.id, u.id]
      );
      expect(e?.constraint).toBe("self_storage_contracts_unit_fk");
    });

    it("no se borra un centro con zonas ni una zona con trasteros", async () => {
      const c = await centro(adminA, "REUS");
      const z = await zona(adminA, c.id, "Z1");
      expect((await errorPg(`DELETE FROM self_storage_centers WHERE id = $1`, [c.id]))?.code).toBe("23503");
      await trastero(adminA, c.id, z.id, "1");
      expect((await errorPg(`DELETE FROM self_storage_zones WHERE id = $1`, [z.id]))?.code).toBe("23503");
    });

    it("base + cuota de IVA y PVP que no cuadran no entran ni por SQL", async () => {
      const c = await centro(adminA, "REUS");
      const z = await zona(adminA, c.id, "Z1");
      const u = await trastero(adminA, c.id, z.id, "1");
      expect((await errorPg(`UPDATE self_storage_units SET monthly_price_gross = 99 WHERE id = $1`, [u.id]))?.constraint).toBe("self_storage_units_vat_amount_chk");
      expect((await api(`/units/${u.id}`, adminA, { method: "PATCH", body: { monthlyPrice: 40, vatAmount: 8.4, monthlyPriceGross: 60 } })).body.code).toBe("PVP_NO_CUADRA");
    });
  });

  // ── 4 ──────────────────────────────────────────────────────────────────────
  describe("4 · estados del trastero", () => {
    let c: any, z: any, u: any;
    beforeEach(async () => {
      c = await centro(adminA, "REUS");
      z = await zona(adminA, c.id, "Z1");
      u = await trastero(adminA, c.id, z.id, "1");
    });

    it("mantenimiento con motivo, auditado; sin motivo, 422", async () => {
      expect((await api(`/units/${u.id}/status`, mantA, { method: "POST", body: { status: "maintenance" } })).status).toBe(422);
      const r = await ok(api(`/units/${u.id}/status`, mantA, { method: "POST", body: { status: "maintenance", reason: "Puerta del box dañada" } }));
      expect(r.status).toBe("maintenance");
      expect(r.statusReason).toBe("Puerta del box dañada");
      const audit = await ok(api(`/audit?entityType=unit&entityId=${u.id}`, adminA));
      expect(audit.map((a: any) => a.action)).toContain("unit.status_changed");
      // Volver a disponible limpia el motivo.
      expect((await ok(api(`/units/${u.id}/status`, mantA, { method: "POST", body: { status: "available" } }))).statusReason).toBeNull();
    });

    it("«alquilado» y «reservado» no se ponen a mano", async () => {
      const r = await api(`/units/${u.id}/status`, adminA, { method: "POST", body: { status: "occupied" } });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe("ESTADO_SOLO_SISTEMA");
    });

    it("con contrato vivo o reserva activa no se retira ni se bloquea", async () => {
      const cl = await cliente(adminA, "12345678Z");
      await contratoVivo(EMPRESA_A, c.id, cl.id, u.id, "C-1", "pending_payment");
      const r = await api(`/units/${u.id}/status`, adminA, { method: "POST", body: { status: "blocked", reason: "x" } });
      expect(r.body.code).toBe("TRASTERO_COMPROMETIDO");

      const u2 = await trastero(adminA, c.id, z.id, "2");
      await db.query(
        `INSERT INTO self_storage_reservations (empresa_id, center_id, storage_unit_id, expires_at) VALUES ($1,$2,$3, now() + interval '10 minutes')`,
        [EMPRESA_A, c.id, u2.id]
      );
      expect((await api(`/units/${u2.id}/status`, adminA, { method: "POST", body: { status: "maintenance", reason: "x" } })).body.code).toBe("TRASTERO_COMPROMETIDO");
    });

    it("una reserva CADUCADA no compromete el trastero", async () => {
      await db.query(
        `INSERT INTO self_storage_reservations (empresa_id, center_id, storage_unit_id, expires_at, created_at)
         VALUES ($1,$2,$3, now() - interval '1 minute', now() - interval '20 minutes')`,
        [EMPRESA_A, c.id, u.id]
      );
      await ok(api(`/units/${u.id}/status`, adminA, { method: "POST", body: { status: "maintenance", reason: "revisión" } }));
    });

    it("un estado que no existe es 422 antes de llegar a la base", async () => {
      expect((await api(`/units/${u.id}/status`, adminA, { method: "POST", body: { status: "alquilado" } })).status).toBe(422);
    });
  });

  // ── 5 ──────────────────────────────────────────────────────────────────────
  describe("5 · doble contratación imposible en la base", () => {
    let c: any, u: any, cl1: any, cl2: any;
    beforeEach(async () => {
      c = await centro(adminA, "REUS");
      const z = await zona(adminA, c.id, "Z1");
      u = await trastero(adminA, c.id, z.id, "1");
      cl1 = await cliente(adminA, "12345678Z");
      cl2 = await cliente(adminA, "87654321X");
    });

    it("dos reservas activas sobre el mismo trastero: la segunda no entra", async () => {
      const sql = `INSERT INTO self_storage_reservations (empresa_id, center_id, storage_unit_id, customer_id, expires_at)
                   VALUES ($1,$2,$3,$4, now() + interval '15 minutes')`;
      await db.query(sql, [EMPRESA_A, c.id, u.id, cl1.id]);
      expect((await errorPg(sql, [EMPRESA_A, c.id, u.id, cl2.id]))?.constraint).toBe("self_storage_reservations_active_unit_uq");
      // Caducada la primera, la segunda sí.
      await db.query(`UPDATE self_storage_reservations SET status = 'expired' WHERE storage_unit_id = $1`, [u.id]);
      await db.query(sql, [EMPRESA_A, c.id, u.id, cl2.id]);
    });

    it("dos contratos vivos sobre el mismo trastero: el segundo no entra; uno terminado no estorba", async () => {
      await contratoVivo(EMPRESA_A, c.id, cl1.id, u.id, "C-1");
      const e = await errorPg(
        `INSERT INTO self_storage_contracts (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date, monthly_price, tax_rate, billing_day, status)
         VALUES ($1,$2,'C-2',$3,$4,current_date,1,21,1,'pending_signature')`,
        [EMPRESA_A, c.id, cl2.id, u.id]
      );
      expect(e?.constraint).toBe("self_storage_contracts_live_unit_uq");
      await db.query(`UPDATE self_storage_contracts SET status = 'terminated', terminated_at = now(), activated_at = coalesce(activated_at, now()) WHERE contract_number = 'C-1' AND empresa_id = $1`, [EMPRESA_A]);
      await contratoVivo(EMPRESA_A, c.id, cl2.id, u.id, "C-2");
      // Un borrador no ocupa el trastero.
      await db.query(
        `INSERT INTO self_storage_contracts (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date, monthly_price, tax_rate, billing_day)
         VALUES ($1,$2,'C-3',$3,$4,current_date,1,21,1)`,
        [EMPRESA_A, c.id, cl1.id, u.id]
      );
    });

    it("concurrencia: dos transacciones a la vez, exactamente una gana", async () => {
      const intentar = async (clienteId: string, numero: string) => {
        const conn = await db.connect();
        try {
          await conn.query("BEGIN");
          await conn.query(
            `INSERT INTO self_storage_contracts (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date, monthly_price, tax_rate, billing_day, status, signed_at)
             VALUES ($1,$2,$3,$4,$5,current_date,1,21,1,'pending_payment',now())`,
            [EMPRESA_A, c.id, numero, clienteId, u.id]
          );
          await new Promise((r) => setTimeout(r, 50));
          await conn.query("COMMIT");
          return "ok";
        } catch (e) {
          await conn.query("ROLLBACK").catch(() => {});
          return (e as { constraint?: string }).constraint ?? "otro";
        } finally {
          conn.release();
        }
      };
      const resultados = await Promise.all([intentar(cl1.id, "K-1"), intentar(cl2.id, "K-2")]);
      expect(resultados.filter((r) => r === "ok")).toHaveLength(1);
      expect(resultados).toContain("self_storage_contracts_live_unit_uq");
    });
  });

  // ── 6 ──────────────────────────────────────────────────────────────────────
  describe("6 · clientes", () => {
    it("NIF y teléfono normalizados; el mismo NIF escrito distinto es duplicado", async () => {
      const cl = await cliente(adminA, "12345678-z", { phone: "600 11 22 33", email: "Juan@Example.com" });
      expect(cl.taxId).toBe("12345678Z");
      expect(cl.phone).toBe("+34600112233");
      expect(cl.email).toBe("juan@example.com");
      expect(cl.status).toBe("active");
      const dup = await api("/customers", adminA, {
        method: "POST",
        body: { customerType: "individual", firstName: "Otro", lastName: "X", taxId: "12345678 Z", phone: "611111111", email: "o@x.es" },
      });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe("CLIENTE_DUPLICADO");
    });

    it("DNI con letra mala, empresa sin razón social y campos no esperados: 422", async () => {
      const base = { customerType: "individual", firstName: "A", lastName: "B", phone: "600112233", email: "a@b.es" };
      expect((await api("/customers", adminA, { method: "POST", body: { ...base, taxId: "12345678A" } })).body.code).toBe("DOCUMENTO_NO_VALIDO");
      expect(
        (await api("/customers", adminA, { method: "POST", body: { customerType: "company", taxId: "B12345674", phone: "600112233", email: "a@b.es" } })).status
      ).toBe(422);
      // Ni la empresa ni el estado ni Stripe se cuelan por el cuerpo.
      for (const intruso of [{ empresaId: EMPRESA_B }, { status: "blocked" }, { stripeCustomerId: "cus_x" }, { authUserId: adminA.usuario }]) {
        expect((await api("/customers", adminA, { method: "POST", body: { ...base, taxId: "12345678Z", ...intruso } })).status).toBe(422);
      }
    });

    it("empresa cliente con CIF y razón social", async () => {
      const cl = await ok(
        api("/customers", adminA, {
          method: "POST",
          body: { customerType: "company", companyName: "Transportes Reus SL", taxId: "B12345674", phone: "977123456", email: "admin@treus.es" },
        }),
        201
      );
      expect(cl.displayName).toBe("Transportes Reus SL");
    });

    it("bloquear exige motivo; bloqueo y desbloqueo quedan auditados", async () => {
      const cl = await cliente(adminA, "12345678Z");
      expect((await api(`/customers/${cl.id}`, empleadoA, { method: "PATCH", body: { status: "blocked" } })).body.code).toBe("MOTIVO_OBLIGATORIO");
      await ok(api(`/customers/${cl.id}`, empleadoA, { method: "PATCH", body: { status: "blocked", statusReason: "Seguridad: incidente" } }));
      await ok(api(`/customers/${cl.id}`, empleadoA, { method: "PATCH", body: { status: "active" } }));
      const audit = await ok(api(`/audit?entityType=customer&entityId=${cl.id}`, adminA));
      expect(audit.map((a: any) => a.action)).toEqual(expect.arrayContaining(["customer.created", "customer.blocked", "customer.unblocked"]));
    });

    it("una modificación audita sólo lo que cambia", async () => {
      const cl = await cliente(adminA, "12345678Z");
      await ok(api(`/customers/${cl.id}`, empleadoA, { method: "PATCH", body: { city: "Reus", email: "juan@example.com" } }));
      const audit = await ok(api(`/audit?entityType=customer&entityId=${cl.id}`, adminA));
      const mod = audit.find((a: any) => a.action === "customer.updated");
      expect(mod.after).toEqual({ city: "Reus" });
      expect(mod.actorName).toBe("Empleado A");
    });

    it("un teléfono autorizado para abrir identifica a UN cliente", async () => {
      const c1 = await cliente(adminA, "12345678Z");
      const c2 = await cliente(adminA, "87654321X");
      await ok(api(`/customers/${c1.id}/phones`, empleadoA, { method: "POST", body: { phone: "699000111", allowDoorAccess: true } }), 201);
      const r = await api(`/customers/${c2.id}/phones`, empleadoA, { method: "POST", body: { phone: "+34 699 000 111", allowDoorAccess: true } });
      expect(r.body.code).toBe("TELEFONO_DE_OTRO_CLIENTE");
      // Como contacto (sin abrir puertas) sí puede repetirse.
      await ok(api(`/customers/${c2.id}/phones`, empleadoA, { method: "POST", body: { phone: "699000111", allowDoorAccess: false } }), 201);
    });

    it("1 cliente → N contratos en centros distintos", async () => {
      const c1 = await centro(adminA, "REUS");
      const c2 = await centro(adminA, "TGN");
      const u1 = await trastero(adminA, c1.id, (await zona(adminA, c1.id, "Z1")).id, "1");
      const u2 = await trastero(adminA, c2.id, (await zona(adminA, c2.id, "Z1")).id, "1");
      const cl = await cliente(adminA, "12345678Z");
      const k1 = await contratoVivo(EMPRESA_A, c1.id, cl.id, u1.id, "C-1");
      await contratoVivo(EMPRESA_A, c2.id, cl.id, u2.id, "C-2");
      await db.query(
        `INSERT INTO self_storage_contract_members (empresa_id, contract_id, full_name, phone_e164, allow_phone) VALUES ($1,$2,'María','+34611222333',true)`,
        [EMPRESA_A, k1]
      );
      const ficha = await ok(api(`/customers/${cl.id}`, empleadoA));
      expect(ficha.contracts).toHaveLength(2);
      expect(ficha.contracts.find((k: any) => k.contractNumber === "C-1").members).toBe(1);
    });
  });

  // ── 7 ──────────────────────────────────────────────────────────────────────
  describe("7 · importación de trasteros", () => {
    // cuota_iva en EUROS (no porcentaje): base + cuota = PVP.
    const CSV = ["codigo;largo;ancho;alto;m2;m3;precio_base;cuota_iva;pvp", "1;2;1,5;2,5;3;7,5;49,59;10,41;60", "2;2;1,5;2,5;3;7,5;49,59;10,41;60", "3;3;2;2,5;6;15;82,64;17,36;100"].join("\n");
    let c: any, z: any;
    beforeEach(async () => {
      c = await centro(adminA, "REUS");
      z = await zona(adminA, c.id, "Z1");
    });

    const validar = (contenido: string, quien: Quien = adminA, extra: Record<string, unknown> = {}) =>
      api(`/centers/${c.id}/imports`, quien, { method: "POST", body: { fileName: "reus.csv", content: contenido, defaultZoneId: z.id, ...extra } });

    it("dry-run no crea nada; confirmar crea; reimportar el mismo fichero no duplica", async () => {
      const v = await ok(validar(CSV), 201);
      expect(v.summary).toMatchObject({ total: 3, create: 3, error: 0 });
      expect(await ok(api(`/units?centerId=${c.id}`, adminA))).toHaveLength(0);

      const a = await ok(api(`/imports/${v.id}/apply`, adminA, { method: "POST", body: {} }));
      expect(a.status).toBe("applied");
      const unidades = await ok(api(`/units?centerId=${c.id}`, adminA));
      expect(unidades).toHaveLength(3);
      const u3 = unidades.find((u: any) => u.code === "3");
      expect(u3).toMatchObject({ widthCm: 200, lengthCm: 300, heightCm: 250, areaM2: 6, volumeM3: 15, monthlyPrice: 82.64, vatAmount: 17.36, taxRate: 21, monthlyPriceGross: 100, status: "available" });

      const otra = await ok(validar(CSV), 201);
      expect(otra.summary).toMatchObject({ create: 0, update: 0, skip: 3 });
      await ok(api(`/imports/${otra.id}/apply`, adminA, { method: "POST", body: {} }));
      expect(await ok(api(`/units?centerId=${c.id}`, adminA))).toHaveLength(3);
    });

    it("una importación aplicada no se aplica dos veces (ni a la vez)", async () => {
      const v = await ok(validar(CSV), 201);
      const [r1, r2] = await Promise.all([
        api(`/imports/${v.id}/apply`, adminA, { method: "POST", body: {} }),
        api(`/imports/${v.id}/apply`, adminA, { method: "POST", body: {} }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      expect(await ok(api(`/units?centerId=${c.id}`, adminA))).toHaveLength(3);
    });

    it("cambio de precio en el fichero → actualiza y audita el cambio de precio; el estado no se toca", async () => {
      await ok(api(`/imports/${(await ok(validar(CSV), 201)).id}/apply`, adminA, { method: "POST", body: {} }));
      const u1 = (await ok(api(`/units?centerId=${c.id}&q=1`, adminA))).find((u: any) => u.code === "1");
      await ok(api(`/units/${u1.id}/status`, adminA, { method: "POST", body: { status: "maintenance", reason: "pintura" } }));
      const v = await ok(validar(CSV.replace("1;2;1,5;2,5;3;7,5;49,59;10,41;60", "1;2;1,5;2,5;3;7,5;57,85;12,15;70")), 201);
      expect(v.summary).toMatchObject({ update: 1, skip: 2 });
      await ok(api(`/imports/${v.id}/apply`, adminA, { method: "POST", body: {} }));
      const despues = await ok(api(`/units/${u1.id}`, adminA));
      expect(despues.monthlyPriceGross).toBe(70);
      expect(despues.status).toBe("maintenance");
      const audit = await ok(api(`/audit?entityType=unit&entityId=${u1.id}`, adminA));
      expect(audit.map((x: any) => x.action)).toContain("unit.price_changed");
    });

    it("fichero con números repetidos o errores: no se importa NADA", async () => {
      const malo = CSV + "\n2;2;1;2;;;10;2,1;\n4;dos;1;2;;;10;2,1;";
      const v = await ok(validar(malo), 201);
      expect(v.summary.error).toBe(3); // las dos filas del «2» y la del «dos»
      // La vista previa dice QUÉ trastero falla aunque la fila no se haya podido leer.
      expect(v.rows.filter((r: any) => r.action === "error").map((r: any) => r.unitCode)).toEqual(["2", "2", "4"]);
      const r = await api(`/imports/${v.id}/apply`, adminA, { method: "POST", body: {} });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe("IMPORTACION_CON_ERRORES");
      expect(await ok(api(`/units?centerId=${c.id}`, adminA))).toHaveLength(0);
    });

    it("lo que entra entre la vista previa y la confirmación se recalcula: nunca duplica", async () => {
      const v = await ok(validar(CSV), 201);
      await trastero(adminA, c.id, z.id, "2"); // alguien lo crea a mano mientras tanto
      const a = await ok(api(`/imports/${v.id}/apply`, adminA, { method: "POST", body: {} }));
      expect(a.summary).toMatchObject({ creados: 2 });
      expect(await ok(api(`/units?centerId=${c.id}`, adminA))).toHaveLength(3);
    });

    it("zona por defecto de otro centro o importación ajena: rechazado", async () => {
      const c2 = await centro(adminA, "TGN");
      const z2 = await zona(adminA, c2.id, "Z1");
      expect((await validar(CSV, adminA, { defaultZoneId: z2.id })).body.code).toBe("ZONA_DE_OTRO_CENTRO");
      const v = await ok(validar(CSV), 201);
      expect((await api(`/imports/${v.id}`, adminB)).status).toBe(404);
      expect((await api(`/imports/${v.id}/apply`, adminB, { method: "POST", body: {} })).status).toBe(404);
    });

    it("el empleado no importa", async () => {
      expect((await validar(CSV, empleadoA)).status).toBe(403);
    });
  });

  // ── 8 ──────────────────────────────────────────────────────────────────────
  describe("8 · plano", () => {
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">
      <script>alert(1)</script>
      <rect id="box-1" x="0" y="0" width="90" height="90" onclick="alert(2)"/>
      <rect id="box-2" x="100" y="0" width="90" height="90"/>
      <rect id="box-3" x="200" y="0" width="90" height="90"/>
    </svg>`;

    it("se guarda saneado y versionado, con el estado real de cada trastero y la vista según el rol", async () => {
      const c = await centro(adminA, "REUS");
      const z = await zona(adminA, c.id, "Z1");
      const u1 = await trastero(adminA, c.id, z.id, "1");
      const u2 = await trastero(adminA, c.id, z.id, "2");
      const subida = await ok(api(`/centers/${c.id}/floor-plan`, adminA, { method: "PUT", body: { svg: SVG } }), 201);
      expect(subida.version).toBe(1);
      expect(subida.removed).toEqual(expect.arrayContaining(["<script>", "@onclick"]));

      await ok(api(`/units/${u1.id}/shape`, adminA, { method: "PUT", body: { shapeId: "box-1" } }));
      await ok(api(`/units/${u2.id}/shape`, adminA, { method: "PUT", body: { shapeId: "box-2" } }));
      // Una forma no vincula dos trasteros; una forma que no está en el plano no se vincula.
      const u3 = await trastero(adminA, c.id, z.id, "3");
      expect((await api(`/units/${u3.id}/shape`, adminA, { method: "PUT", body: { shapeId: "box-1" } })).body.code).toBe("FORMA_YA_VINCULADA");
      expect((await api(`/units/${u3.id}/shape`, adminA, { method: "PUT", body: { shapeId: "box-99" } })).body.code).toBe("FORMA_NO_EXISTE");

      const cl = await cliente(adminA, "12345678Z");
      await contratoVivo(EMPRESA_A, c.id, cl.id, u1.id, "C-1");
      await db.query(`UPDATE self_storage_units SET status = 'occupied' WHERE id = $1`, [u1.id]);

      const plano = await ok(api(`/centers/${c.id}/floor-plan`, adminA));
      expect(plano.plan.svg).not.toMatch(/script|onclick/);
      expect(plano.unlinkedShapes).toEqual(["box-3"]);
      const p1 = plano.units.find((u: any) => u.id === u1.id);
      expect(p1.status).toBe("occupied");
      expect(p1.customer.name).toBe("Juan Pérez");
      expect(p1.contract.number).toBe("C-1");

      const vistaMant = await ok(api(`/centers/${c.id}/floor-plan`, mantA));
      const m1 = vistaMant.units.find((u: any) => u.id === u1.id);
      expect(m1.status).toBe("occupied");
      expect(m1.customer).toBeNull();
      expect(m1.contract).toBeNull();

      // Nueva versión sin «box-2»: el trastero 2 queda como huérfano.
      const v2 = await ok(api(`/centers/${c.id}/floor-plan`, adminA, { method: "PUT", body: { svg: SVG.replace('id="box-2"', 'id="box-20"') } }), 201);
      expect(v2.version).toBe(2);
      const tras = await ok(api(`/centers/${c.id}/floor-plan`, adminA));
      expect(tras.orphanUnits.map((o: any) => o.code)).toEqual(["2"]);
      // Las versiones no se editan.
      expect((await errorPg(`UPDATE self_storage_floor_plans SET svg = '<svg/>' WHERE center_id = $1`, [c.id]))?.code).toBe("42501");
    });

    it("un SVG con DOCTYPE no entra", async () => {
      const c = await centro(adminA, "REUS");
      const r = await api(`/centers/${c.id}/floor-plan`, adminA, { method: "PUT", body: { svg: '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>' } });
      expect(r.status).toBe(422);
    });
  });

  // ── 9 ──────────────────────────────────────────────────────────────────────
  describe("9 · permisos, auditoría y vocabulario", () => {
    it("sin rol en el módulo: 403 en todo; superadmin sin fila: admin", async () => {
      expect((await api("/bootstrap", sinRolA)).status).toBe(403);
      const b = await ok(api("/bootstrap", superA));
      expect(b.rol).toBe("superadmin");
    });

    it("mantenimiento no ve clientes ni gestiona trasteros; empleado no crea centros", async () => {
      const c = await centro(adminA, "REUS");
      const z = await zona(adminA, c.id, "Z1");
      expect((await api("/customers", mantA)).status).toBe(403);
      expect((await api("/units", mantA, { method: "POST", body: datosTrastero(c.id, z.id, "1") })).status).toBe(403);
      expect((await api("/centers", empleadoA, { method: "POST", body: { code: "X", name: "X" } })).status).toBe(403);
      expect((await api("/audit", empleadoA)).status).toBe(403);
      expect((await ok(api("/bootstrap", mantA))).permisos).not.toContain("ss.customers.view");
    });

    it("cambio de precio: auditado con antes y después", async () => {
      const c = await centro(adminA, "REUS");
      const u = await trastero(adminA, c.id, (await zona(adminA, c.id, "Z1")).id, "1");
      const d = await ok(api(`/units/${u.id}`, adminA, { method: "PATCH", body: { monthlyPriceGross: 72.6 } }));
      expect(d.monthlyPrice).toBe(60);
      const audit = await ok(api(`/audit?entityType=unit&entityId=${u.id}`, adminA));
      const cambio = audit.find((a: any) => a.action === "unit.price_changed");
      expect(cambio.before.monthlyPriceGross).toBe(60);
      expect(cambio.after.monthlyPriceGross).toBe(72.6);
    });

    it("la auditoría no se puede modificar ni borrar", async () => {
      await centro(adminA, "REUS");
      expect((await errorPg(`UPDATE self_storage_audit_logs SET action = 'x.y' WHERE empresa_id = $1`, [EMPRESA_A]))?.code).toBe("42501");
      expect((await errorPg(`DELETE FROM self_storage_audit_logs WHERE empresa_id = $1`, [EMPRESA_A]))?.code).toBe("42501");
    });

    it("los enums de la base son los del código", async () => {
      const valores = async (tipo: string) =>
        (await db.query(`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder`, [tipo])).rows.map(
          (r) => r.enumlabel
        );
      expect(await valores("self_storage_unit_status")).toEqual([...UNIT_STATUSES]);
      expect(await valores("self_storage_customer_status")).toEqual([...CUSTOMER_STATUSES]);
      expect(await valores("self_storage_customer_type")).toEqual([...CUSTOMER_TYPES]);
      expect(await valores("self_storage_contract_status")).toEqual([...CONTRACT_STATUSES]);
    });

    it("dashboard: ocupación por estados", async () => {
      const c = await centro(adminA, "REUS");
      const z = await zona(adminA, c.id, "Z1");
      const u1 = await trastero(adminA, c.id, z.id, "1");
      const u2 = await trastero(adminA, c.id, z.id, "2");
      await trastero(adminA, c.id, z.id, "3");
      await trastero(adminA, c.id, z.id, "4");
      await db.query(`UPDATE self_storage_units SET status = 'occupied' WHERE id = $1`, [u1.id]);
      await ok(api(`/units/${u2.id}/status`, adminA, { method: "POST", body: { status: "maintenance", reason: "x" } }));
      const d = await ok(api(`/dashboard?centerId=${c.id}`, mantA));
      expect(d.units).toMatchObject({ total: 4, available: 2, occupied: 1, maintenance: 1, rentable: 3, occupancyPct: 25, occupancyRentablePct: 33.33 });
      // Mantenimiento no ve cobros; el administrador, sí (aunque sean cero).
      expect(d.billing.monthlyInvoiced).toBeNull();
      const dAdmin = await ok(api(`/dashboard?centerId=${c.id}`, adminA));
      expect(dAdmin.billing).toMatchObject({ visible: true, monthlyInvoiced: 0, pendingCollection: 0, overdue: 0, openDunning: 0 });
    });
  });

  // ── 10 ─────────────────────────────────────────────────────────────────────
  describe("10 · aislamiento del módulo en la base", () => {
    it("ninguna FK de self_storage_* apunta fuera, ni ninguna de fuera apunta dentro", async () => {
      const { rows } = await db.query(`
        SELECT c.conrelid::regclass::text AS desde, c.confrelid::regclass::text AS hacia
          FROM pg_constraint c
         WHERE c.contype = 'f'
           AND (c.conrelid::regclass::text LIKE 'self_storage_%' OR c.confrelid::regclass::text LIKE 'self_storage_%')`);
      expect(rows.length).toBeGreaterThan(10);
      const cruzadas = rows.filter((r) => r.desde.startsWith("self_storage_") !== r.hacia.startsWith("self_storage_"));
      expect(cruzadas).toEqual([]);
    });
  });
});
