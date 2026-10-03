/**
 * Row Level Security de Self Storage: aislamiento ENTRE CLIENTES.
 *
 * El servidor entra como propietario y no pasa por RLS; RLS protege a quien
 * llegue por PostgREST con la anon key o con el JWT de un usuario. Aquí se
 * reproduce eso en un PostgreSQL normal:
 *
 *   · se crean los roles `anon` y `authenticated` y un `auth.uid()` que lee
 *     el JWT igual que el de Supabase (`request.jwt.claim.sub` o
 *     `request.jwt.claims`), si no existen;
 *   · se conceden los privilegios que Supabase da por defecto a una tabla nueva
 *     (TODO a anon y authenticated) y se vuelve a aplicar el esquema, que es lo
 *     que pasa en producción: el 0004 los recorta;
 *   · cada consulta va con `SET LOCAL ROLE` y el `sub` de un usuario.
 *
 * Casos: Ana sólo ve lo suyo, Bea sólo lo suyo, un empleado (usuario sin
 * cliente) no ve nada, anon no puede ni preguntar, y nadie escribe.
 *
 * Sólo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

const EMPRESA = "00000000-0000-4000-a000-0000005511a1";
const ANA = "00000000-0000-4000-a000-0000005511f1"; // auth.users.id de la clienta Ana
const BEA = "00000000-0000-4000-a000-0000005511f2"; // auth.users.id de la clienta Bea
const EMPLEADO = "00000000-0000-4000-a000-0000005511f3"; // usuario sin ficha de cliente

let db: typeof import("../db.ts").default;
const ids: Record<string, string> = {};

async function crearSiNoExiste(sql: string) {
  await db.query(sql).catch((e: { code?: string }) => {
    if (e.code !== "42710" && e.code !== "42P06") throw e; // ya existe
  });
}

/** Ejecuta una consulta como un usuario de PostgREST. */
async function como<T = any>(rol: "anon" | "authenticated", sub: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL ROLE ${rol}`);
    await c.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub ?? ""]);
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [sub ? JSON.stringify({ sub, role: rol }) : ""]);
    const r = await c.query(sql, params);
    return r.rows as T[];
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

async function codigoError(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "otro";
  }
}

async function limpiar() {
  await db.query(`ALTER TABLE self_storage_invoices DISABLE TRIGGER self_storage_invoices_guard`);
  await db.query(`DELETE FROM self_storage_payments WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`DELETE FROM self_storage_invoices WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`ALTER TABLE self_storage_invoices ENABLE TRIGGER self_storage_invoices_guard`);
  await db.query(`ALTER TABLE self_storage_access_events DISABLE TRIGGER self_storage_access_events_guard`);
  await db.query(`DELETE FROM self_storage_access_events WHERE empresa_id = $1`, [EMPRESA]);
  await db.query(`ALTER TABLE self_storage_access_events ENABLE TRIGGER self_storage_access_events_guard`);
  for (const t of ["self_storage_contract_members", "self_storage_contracts", "self_storage_reservations", "self_storage_customer_phones", "self_storage_customers", "self_storage_units", "self_storage_zones", "self_storage_centers"]) {
    await db.query(`DELETE FROM ${t} WHERE empresa_id = $1`, [EMPRESA]);
  }
}

describe.skipIf(!RUN)("Self Storage · RLS entre clientes", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;

    // ── Lo que Supabase trae de serie ──
    await crearSiNoExiste(`CREATE ROLE anon NOLOGIN`);
    await crearSiNoExiste(`CREATE ROLE authenticated NOLOGIN`);
    await crearSiNoExiste(`CREATE SCHEMA auth`);
    await db.query(`
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        )::uuid
      $$`);
    await db.query(`GRANT USAGE ON SCHEMA auth TO anon, authenticated`);
    await db.query(`GRANT USAGE ON SCHEMA public TO anon, authenticated`);
    // Privilegios por defecto de Supabase sobre las tablas nuevas…
    await db.query(`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated`);
    // …y el esquema del módulo vuelve a aplicarse encima, como en producción.
    const { initSelfStorage } = await import("./schema.ts");
    await initSelfStorage();

    await limpiar();

    // ── Datos (como propietario, que es como escribe el servidor) ──
    const q = async (sql: string, p: unknown[]) => (await db.query(sql, p)).rows[0].id as string;
    ids.centro = await q(`INSERT INTO self_storage_centers (empresa_id, code, name) VALUES ($1,'RLS','RLS') RETURNING id`, [EMPRESA]);
    ids.zona = await q(`INSERT INTO self_storage_zones (empresa_id, center_id, code, name) VALUES ($1,$2,'Z1','Z1') RETURNING id`, [EMPRESA, ids.centro]);
    const trastero = (code: string) =>
      q(
        `INSERT INTO self_storage_units (empresa_id, center_id, zone_id, code, width_cm, length_cm, height_cm, area_m2, volume_m3, monthly_price, tax_rate, monthly_price_gross)
         VALUES ($1,$2,$3,$4,100,100,200,1,2,10,21,12.10) RETURNING id`,
        [EMPRESA, ids.centro, ids.zona, code]
      );
    ids.u1 = await trastero("1");
    ids.u2 = await trastero("2");
    ids.u3 = await trastero("3"); // libre: nadie lo ve por PostgREST
    const cliente = (nombre: string, nif: string, auth: string) =>
      q(
        `INSERT INTO self_storage_customers (empresa_id, customer_type, first_name, last_name, tax_id, phone, email, auth_user_id)
         VALUES ($1,'individual',$2,'Prueba',$3,'+34600000000',$4,$5) RETURNING id`,
        [EMPRESA, nombre, nif, `${nombre.toLowerCase()}@x.es`, auth]
      );
    ids.ana = await cliente("Ana", "11111111H", ANA);
    ids.bea = await cliente("Bea", "22222222J", BEA);
    await db.query(`INSERT INTO self_storage_customer_phones (empresa_id, customer_id, phone_e164) VALUES ($1,$2,'+34611000001'), ($1,$3,'+34611000002')`, [
      EMPRESA,
      ids.ana,
      ids.bea,
    ]);
    const contrato = (num: string, cli: string, u: string) =>
      q(
        `INSERT INTO self_storage_contracts (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date, monthly_price, tax_rate, billing_day, status, signed_at, activated_at)
         VALUES ($1,$2,$3,$4,$5,current_date,10,21,1,'active',now(),now()) RETURNING id`,
        [EMPRESA, ids.centro, num, cli, u]
      );
    ids.kAna = await contrato("RLS-ANA", ids.ana, ids.u1);
    ids.kBea = await contrato("RLS-BEA", ids.bea, ids.u2);
    const factura = (cli: string, k: string, num: string, estado: string) =>
      q(
        `INSERT INTO self_storage_invoices (empresa_id, customer_id, contract_id, kind, collection_method, series, invoice_number, issue_date,
           subtotal, tax, total, status, customer_name, customer_tax_id, issuer_name, issuer_tax_id)
         VALUES ($1,$2,$3,'one_off','manual','F',$4,current_date,10,2.1,12.1,$5::self_storage_invoice_status,'X','11111111H','Emisor','B12345674') RETURNING id`,
        [EMPRESA, cli, k, num, estado]
      );
    ids.fAna = await factura(ids.ana, ids.kAna, "RLS-F-1", "pending");
    ids.fBea = await factura(ids.bea, ids.kBea, "RLS-F-2", "pending");
    ids.fBorradorAna = await q(
      `INSERT INTO self_storage_invoices (empresa_id, customer_id, contract_id, kind, collection_method) VALUES ($1,$2,$3,'one_off','manual') RETURNING id`,
      [EMPRESA, ids.ana, ids.kAna]
    );
    for (const [cli, f] of [[ids.ana, ids.fAna], [ids.bea, ids.fBea]]) {
      await db.query(
        `INSERT INTO self_storage_payments (empresa_id, customer_id, invoice_id, amount, payment_method, status, paid_at, recorded_by)
         VALUES ($1,$2,$3,12.1,'cash','succeeded',now(),$4)`,
        [EMPRESA, cli, f, EMPLEADO]
      );
    }
    await db.query(`INSERT INTO self_storage_contract_members (empresa_id, contract_id, full_name) VALUES ($1,$2,'María (autorizada de Ana)'), ($1,$3,'Luis (autorizado de Bea)')`, [
      EMPRESA,
      ids.kAna,
      ids.kBea,
    ]);
    // Fase 3: un evento de acceso de cada una.
    for (const [cli, k, nombre] of [[ids.ana, ids.kAna, "Ana"], [ids.bea, ids.kBea, "Bea"]]) {
      await db.query(
        `INSERT INTO self_storage_access_events (empresa_id, center_id, contract_id, customer_id, actor_type, actor_name, method, decision, reason, execution_status)
         VALUES ($1,$2,$3,$4,'customer',$5,'app','denied','DOOR_NOT_ALLOWED','not_attempted')`,
        [EMPRESA, ids.centro, k, cli, nombre]
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    await limpiar().catch(() => {});
    await db.end().catch(() => {});
  });

  it("Ana sólo ve SUS filas en cada tabla del portal", async () => {
    expect((await como("authenticated", ANA, `SELECT id FROM self_storage_customers`)).map((r) => r.id)).toEqual([ids.ana]);
    expect((await como("authenticated", ANA, `SELECT contract_number FROM self_storage_contracts`)).map((r) => r.contract_number)).toEqual(["RLS-ANA"]);
    expect((await como("authenticated", ANA, `SELECT id FROM self_storage_units`)).map((r) => r.id)).toEqual([ids.u1]);
    expect((await como("authenticated", ANA, `SELECT full_name FROM self_storage_contract_members`)).map((r) => r.full_name)).toEqual(["María (autorizada de Ana)"]);
    expect((await como("authenticated", ANA, `SELECT phone_e164 FROM self_storage_customer_phones`)).map((r) => r.phone_e164)).toEqual(["+34611000001"]);
    expect(await como("authenticated", ANA, `SELECT id FROM self_storage_centers`)).toHaveLength(1);
  });

  it("facturas y pagos (fase 2): cada cliente los suyos, y nunca un borrador", async () => {
    expect((await como("authenticated", ANA, `SELECT id FROM self_storage_invoices`)).map((r) => r.id)).toEqual([ids.fAna]);
    expect((await como("authenticated", BEA, `SELECT id FROM self_storage_invoices`)).map((r) => r.id)).toEqual([ids.fBea]);
    expect(await como("authenticated", ANA, `SELECT * FROM self_storage_invoices WHERE id = $1`, [ids.fBea])).toEqual([]);
    expect(await como("authenticated", ANA, `SELECT * FROM self_storage_payments WHERE invoice_id = $1`, [ids.fBea])).toEqual([]);
    expect(await como("authenticated", ANA, `SELECT id FROM self_storage_payments`)).toHaveLength(1);
    expect(await como("authenticated", EMPLEADO, `SELECT id FROM self_storage_invoices`)).toEqual([]);
    for (const t of ["self_storage_stripe_events", "self_storage_sequences", "self_storage_dunning_cases", "self_storage_notifications", "self_storage_billing_items"]) {
      expect(await como("authenticated", ANA, `SELECT 1 FROM ${t}`), t).toEqual([]);
    }
    expect(await codigoError(como("authenticated", ANA, `UPDATE self_storage_invoices SET status = 'paid', paid_at = now() WHERE id = $1`, [ids.fAna]))).toBe("42501");
    expect(await codigoError(como("anon", null, `SELECT 1 FROM self_storage_invoices`))).toBe("42501");
  });

  it("⚑ accesos (fase 3): cada cliente sólo sus eventos; dispositivos, puertas y sincronizaciones cerrados", async () => {
    expect((await como("authenticated", ANA, `SELECT actor_name FROM self_storage_access_events`)).map((r) => r.actor_name)).toEqual(["Ana"]);
    expect((await como("authenticated", BEA, `SELECT actor_name FROM self_storage_access_events`)).map((r) => r.actor_name)).toEqual(["Bea"]);
    expect(await como("authenticated", ANA, `SELECT * FROM self_storage_access_events WHERE customer_id = $1`, [ids.bea])).toEqual([]);
    expect(await como("authenticated", EMPLEADO, `SELECT 1 FROM self_storage_access_events`)).toEqual([]);
    for (const t of ["self_storage_devices", "self_storage_device_outputs", "self_storage_doors", "self_storage_device_syncs", "self_storage_temporary_access_doors"]) {
      expect(await como("authenticated", ANA, `SELECT 1 FROM ${t}`), t).toEqual([]);
    }
    expect(await codigoError(como("authenticated", ANA, `INSERT INTO self_storage_access_events (empresa_id, actor_type, method, decision, reason, execution_status) VALUES ($1,'customer','app','granted','GRANTED','succeeded')`, [EMPRESA]))).toBe("42501");
    expect(await codigoError(como("anon", null, `SELECT 1 FROM self_storage_access_events`))).toBe("42501");
  });

  it("Ana no alcanza lo de Bea ni pidiéndolo por id", async () => {
    expect(await como("authenticated", ANA, `SELECT * FROM self_storage_customers WHERE id = $1`, [ids.bea])).toEqual([]);
    expect(await como("authenticated", ANA, `SELECT * FROM self_storage_contracts WHERE id = $1`, [ids.kBea])).toEqual([]);
    expect(await como("authenticated", ANA, `SELECT * FROM self_storage_units WHERE id = $1`, [ids.u2])).toEqual([]);
  });

  it("Bea, simétrico; con el JWT en `request.jwt.claims` también funciona", async () => {
    const c = await db.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SET LOCAL ROLE authenticated`);
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: BEA, role: "authenticated" })]);
      const r = await c.query(`SELECT contract_number FROM self_storage_contracts`);
      expect(r.rows.map((x) => x.contract_number)).toEqual(["RLS-BEA"]);
    } finally {
      await c.query("ROLLBACK");
      c.release();
    }
  });

  it("un usuario sin ficha de cliente (un empleado) no ve nada por PostgREST", async () => {
    for (const t of ["self_storage_customers", "self_storage_contracts", "self_storage_units", "self_storage_centers", "self_storage_contract_members"]) {
      expect(await como("authenticated", EMPLEADO, `SELECT 1 FROM ${t}`), t).toEqual([]);
    }
  });

  it("las tablas internas están cerradas incluso para un cliente", async () => {
    for (const t of ["self_storage_audit_logs", "self_storage_settings", "self_storage_unit_imports", "self_storage_floor_plans", "self_storage_unit_types"]) {
      expect(await como("authenticated", ANA, `SELECT 1 FROM ${t}`), t).toEqual([]);
    }
  });

  it("anon no puede ni leer", async () => {
    expect(await codigoError(como("anon", null, `SELECT 1 FROM self_storage_units`))).toBe("42501");
    expect(await codigoError(como("anon", null, `SELECT 1 FROM self_storage_customers`))).toBe("42501");
  });

  it("nadie escribe por PostgREST: ni su propia ficha, ni un contrato, ni un trastero", async () => {
    expect(await codigoError(como("authenticated", ANA, `UPDATE self_storage_customers SET email = 'x@x.es' WHERE id = $1`, [ids.ana]))).toBe("42501");
    expect(
      await codigoError(
        como(
          "authenticated",
          ANA,
          `INSERT INTO self_storage_contracts (empresa_id, center_id, contract_number, customer_id, storage_unit_id, start_date, monthly_price, tax_rate, billing_day)
           VALUES ($1,$2,'HACK',$3,$4,current_date,0,0,1)`,
          [EMPRESA, ids.centro, ids.ana, ids.u3]
        )
      )
    ).toBe("42501");
    expect(await codigoError(como("authenticated", ANA, `DELETE FROM self_storage_units WHERE id = $1`, [ids.u1]))).toBe("42501");
  });
});
