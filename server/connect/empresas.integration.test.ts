/**
 * Aislamiento de la cartera de empresas entre plataformas, contra PostgreSQL.
 *
 * Lo que se fija aquí es la promesa del núcleo multiempresa: una petición
 * autenticada de la Plataforma A NO puede leer ni tocar una empresa de la B
 * cambiando el id a mano. Se comprueba contra el router de verdad por HTTP,
 * porque el aislamiento vive en las consultas y no en el panel: probarlo
 * llamando a funciones internas no demostraría nada de lo que importa.
 *
 * Lo único que se sustituye es la autenticación con Supabase, que aquí no se
 * puede levantar. El rbac, las consultas y los permisos son los de producción.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

vi.mock("../core/auth.ts", () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.authCtx = {
      userId: `test-${req.headers["x-test-user"] ?? ""}`,
      username: String(req.headers["x-test-user"] ?? ""),
      nombre: "Prueba",
      empresaId: "test",
      esSuperadmin: false,
    };
    next();
  },
}));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

interface Plataforma { id: number; email: string; empresaId: number }
let plataformaA: Plataforma;
let plataformaB: Plataforma;

async function api(
  ruta: string,
  usuario: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, {
    method: init?.method ?? "GET",
    headers: { "x-test-user": usuario, "Content-Type": "application/json" },
    body: init?.body != null ? JSON.stringify(init.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Una plataforma con su administrador y una empresa propia en su cartera. */
async function crearPlataforma(nombre: string): Promise<Plataforma> {
  const cc = await db.query(
    `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$3) RETURNING id`,
    [`cc-emp-${nombre}-${sufijo}`, `Plataforma ${nombre}`, now],
  );
  const id = Number(cc.rows[0].id);
  const email = `admin-emp-${nombre}-${sufijo}@example.com`;
  await db.query(
    `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'cc_admin',$4,$4)`,
    [id, email, `Admin ${nombre}`, now],
  );
  /*
   * El CIF se guarda YA normalizado, que es lo que hace la API al dar de alta.
   * Sembrarlo sin normalizar dejaría la fila fuera del control de duplicados y
   * la prueba mediría el sembrado en vez del código.
   */
  const emp = await db.query(
    `INSERT INTO connect_provider_companies
       (uuid, name, "taxId", "taxIdNormalized", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$3,$4,$4) RETURNING id`,
    [`emp-${nombre}-${sufijo}`, `Empresa de ${nombre}`, `X${nombre.toUpperCase()}${sufijo}`, now],
  );
  const empresaId = Number(emp.rows[0].id);
  await db.query(
    `INSERT INTO connect_tenant_companies
       (uuid, "controlCenterId", "companyId", roles, "internalCode", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'["PROVIDER"]',$4,$5,$5)`,
    [`rel-${nombre}-${sufijo}`, id, empresaId, `COD-${nombre}-${sufijo}`, now],
  );
  return { id, email, empresaId };
}

describe.skipIf(!RUN)("Aislamiento de la cartera de empresas", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("./schema.ts");
    const { createEmpresasRouter } = await import("./empresasRouter.ts");
    await initDb();
    await initConnect();

    plataformaA = await crearPlataforma("alfa");
    plataformaB = await crearPlataforma("beta");

    const app = express();
    app.use("/empresas", createEmpresasRouter());
    await new Promise<void>((ok) => { servidor = app.listen(0, () => ok()); });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/empresas`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    for (const p of [plataformaA, plataformaB]) {
      if (!p) continue;
      await db.query(`DELETE FROM connect_tenant_companies WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [p.id]).catch(() => {});
      await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [p.empresaId]).catch(() => {});
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [p.id]).catch(() => {});
    }
  }, 30_000);

  it("cada plataforma ve su empresa y no la de la otra", async () => {
    const a = await api("/", plataformaA.email);
    expect(a.status).toBe(200);
    const idsA = a.body.data.map((x: any) => x.id);
    expect(idsA).toContain(plataformaA.empresaId);
    expect(idsA).not.toContain(plataformaB.empresaId);

    const b = await api("/", plataformaB.email);
    const idsB = b.body.data.map((x: any) => x.id);
    expect(idsB).toContain(plataformaB.empresaId);
    expect(idsB).not.toContain(plataformaA.empresaId);
  });

  /*
   * El caso que da nombre al requisito: cambiar el id en la URL. 404 y no 403
   * a propósito — confirmar que la empresa existe ya sería contar algo, y con
   * eso se puede enumerar la cartera ajena tanteando ids.
   */
  it("pedir la ficha de una empresa ajena responde 404, no sus datos", async () => {
    const ajena = await api(`/${plataformaB.empresaId}`, plataformaA.email);
    expect(ajena.status).toBe(404);
    expect(JSON.stringify(ajena.body)).not.toContain("beta");

    const propia = await api(`/${plataformaA.empresaId}`, plataformaA.email);
    expect(propia.status).toBe(200);
    expect(propia.body.id).toBe(plataformaA.empresaId);
  });

  it("tampoco se puede modificar la ficha de una empresa ajena", async () => {
    const r = await api(`/${plataformaB.empresaId}`, plataformaA.email, {
      method: "PATCH",
      body: { name: "Secuestrada" },
    });
    expect(r.status).toBe(404);

    const sigueIgual = await db.query(
      `SELECT name FROM connect_provider_companies WHERE id = $1`,
      [plataformaB.empresaId],
    );
    expect(sigueIgual.rows[0].name).toBe("Empresa de beta");
  });

  it("la búsqueda por CIF no filtra empresas de otra plataforma", async () => {
    const cif = `X BETA${sufijo}`;   // el CIF exacto de la empresa de la otra
    const r = await api(`/?q=${encodeURIComponent(cif)}`, plataformaA.email);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(0);
  });

  it("una empresa nueva nace en la cartera de quien la crea, y solo en esa", async () => {
    const alta = await api("/", plataformaA.email, {
      method: "POST",
      body: { name: `Nueva ${sufijo}`, taxId: `B-99${sufijo}`, roles: ["PROVIDER", "CUSTOMER"] },
    });
    expect(alta.status).toBe(201);
    const nuevaId = alta.body.id;
    expect(alta.body.relacion.roles).toEqual(["CUSTOMER", "PROVIDER"]);

    expect((await api(`/${nuevaId}`, plataformaA.email)).status).toBe(200);
    expect((await api(`/${nuevaId}`, plataformaB.email)).status).toBe(404);

    await db.query(`DELETE FROM connect_tenant_companies WHERE "companyId" = $1`, [nuevaId]);
    await db.query(`DELETE FROM connect_provider_companies WHERE id = $1`, [nuevaId]);
  });

  /*
   * La otra mitad de la ficha maestra: el mismo CIF no puede dar de alta dos
   * empresas. Se contesta 409 con el id de la que ya hay para que el panel
   * pueda ofrecer añadirla a la cartera en lugar de duplicarla.
   */
  it("un CIF repetido no crea una segunda ficha", async () => {
    const cifPropio = (
      await db.query(`SELECT "taxId" FROM connect_provider_companies WHERE id = $1`, [plataformaA.empresaId])
    ).rows[0].taxId;

    const r = await api("/", plataformaA.email, {
      method: "POST",
      body: { name: "Duplicada", taxId: cifPropio, roles: ["PROVIDER"] },
    });
    expect(r.status).toBe(409);
    expect(r.body.companyId).toBe(plataformaA.empresaId);
  });

  /*
   * Aquí está el motivo de separar identidad y relación: la MISMA empresa
   * trabaja con las dos plataformas, con condiciones distintas, y ninguna ve
   * las de la otra.
   */
  it("una empresa compartida lleva condiciones distintas en cada plataforma", async () => {
    await api(`/${plataformaA.empresaId}/relacion`, plataformaA.email, {
      method: "PUT",
      body: { roles: ["PROVIDER"], paymentTerms: "30 días", authorizationLimit: 500 },
    });
    // La plataforma B añade la misma empresa a su cartera, con lo suyo.
    await db.query(
      `INSERT INTO connect_tenant_companies
         (uuid, "controlCenterId", "companyId", roles, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,$3,'["PROVIDER"]',$4,$4)`,
      [`rel-compartida-${sufijo}`, plataformaB.id, plataformaA.empresaId, now],
    );
    await api(`/${plataformaA.empresaId}/relacion`, plataformaB.email, {
      method: "PUT",
      body: { roles: ["CUSTOMER"], paymentTerms: "60 días", authorizationLimit: 2000 },
    });

    const vistaA = await api(`/${plataformaA.empresaId}`, plataformaA.email);
    const vistaB = await api(`/${plataformaA.empresaId}`, plataformaB.email);

    expect(vistaA.body.relacion.paymentTerms).toBe("30 días");
    expect(vistaA.body.relacion.authorizationLimit).toBe(500);
    expect(vistaA.body.relacion.roles).toEqual(["PROVIDER"]);

    expect(vistaB.body.relacion.paymentTerms).toBe("60 días");
    expect(vistaB.body.relacion.authorizationLimit).toBe(2000);
    expect(vistaB.body.relacion.roles).toEqual(["CUSTOMER"]);

    // Y la identidad es UNA: el mismo uuid en las dos.
    expect(vistaA.body.uuid).toBe(vistaB.body.uuid);
  });

  it("retirar la relación saca la empresa de la cartera sin borrarla", async () => {
    const r = await api(`/${plataformaA.empresaId}/relacion`, plataformaB.email, { method: "DELETE" });
    expect(r.status).toBe(200);

    expect((await api(`/${plataformaA.empresaId}`, plataformaB.email)).status).toBe(404);
    // Sigue existiendo para su dueña: retirar no es borrar.
    expect((await api(`/${plataformaA.empresaId}`, plataformaA.email)).status).toBe(200);
  });
});
