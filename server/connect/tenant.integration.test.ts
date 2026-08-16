/**
 * Aislamiento entre centros de control, contra PostgreSQL real.
 *
 * Central Pro se diseñó multi-centro pero el listado de asistencias y la
 * facturación nunca filtraron por centro: con una sola central no se notaba.
 * Con dos, y con costes y márgenes de por medio, una vería los importes de la
 * otra. Estas pruebas fijan que eso no puede volver a pasar.
 *
 * Se habla con el router de verdad por HTTP. Lo único que se sustituye es la
 * autenticación con Supabase, que aquí no se puede levantar: el resto —el
 * rbac, las consultas y los permisos— es el de producción.
 *
 * Solo con RUN_DB_TESTS=1 y DATABASE_URL a una base DESECHABLE.
 */

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

/**
 * La identidad llega por una cabecera de prueba en lugar de por un token de
 * Supabase. `resolveConnectUser` busca después el usuario real en
 * connect_users, así que el rol y el centro salen de la base, no del mock.
 */
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

interface Centro { id: number; email: string; asistenciaId: number; partnerId: number }
let centroA: Centro;
let centroB: Centro;
let emailSuperadmin = "";

async function api(ruta: string, usuario: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, { headers: { "x-test-user": usuario } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** Centro de control con su usuario, su partner y una asistencia finalizada. */
async function crearCentro(nombre: string, coste: number): Promise<Centro> {
  const cc = await db.query(
    `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$3) RETURNING id`,
    [`cc-${nombre}-${sufijo}`, `Central ${nombre}`, now],
  );
  const id = cc.rows[0].id;
  const email = `admin-${nombre}-${sufijo}@example.com`;
  await db.query(
    `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'cc_admin',$4,$4)`,
    [id, email, `Admin ${nombre}`, now],
  );
  const p = await db.query(
    `INSERT INTO connect_partners (uuid, name, "controlCenterId", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$4,$4) RETURNING id`,
    [`partner-${nombre}-${sufijo}`, `Partner ${nombre}`, id, now],
  );
  const a = await db.query(
    `INSERT INTO connect_assistances
       (uuid, "partnerId", "controlCenterId", status, "expedientNumber", "finalCost",
        "customerName", "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,'finished',$4,$5,$6,$7,$7) RETURNING id`,
    [`a-${nombre}-${sufijo}`, p.rows[0].id, id, `EXP-${nombre}-${sufijo}`, coste,
     `Cliente de ${nombre}`, now],
  );
  return { id, email, asistenciaId: a.rows[0].id, partnerId: p.rows[0].id };
}

describe.skipIf(!RUN)("Aislamiento entre centros de control", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("./schema.ts");
    const { createConnectBackofficeRouter } = await import("./backoffice.ts");
    await initDb();
    await initConnect();

    centroA = await crearCentro("alfa", 331);
    centroB = await crearCentro("beta", 999);

    emailSuperadmin = `super-${sufijo}@example.com`;
    await db.query(
      `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'Super','superadmin',$3,$3)`,
      [centroA.id, emailSuperadmin, now],
    );

    const app = express();
    app.use("/bo", createConnectBackofficeRouter());
    await new Promise<void>((ok) => { servidor = app.listen(0, () => ok()); });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/bo`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    // Sin cerrar las conexiones vivas, close() espera a que caduquen las
    // keep-alive de fetch y el hook se agota.
    servidor?.closeAllConnections?.();
    servidor?.close();
    for (const c of [centroA, centroB]) {
      if (!c) continue;
      await db.query(`DELETE FROM connect_assistances WHERE "controlCenterId" = $1`, [c.id]).catch(() => {});
      await db.query(`DELETE FROM connect_partners WHERE "controlCenterId" = $1`, [c.id]).catch(() => {});
      await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [c.id]).catch(() => {});
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [c.id]).catch(() => {});
    }
  }, 30_000);

  it("cada central ve su asistencia y no la de la otra", async () => {
    const a = await api("/assistances?limit=500", centroA.email);
    expect(a.status).toBe(200);
    const idsA = a.body.data.map((x: any) => x.id);
    expect(idsA).toContain(centroA.asistenciaId);
    expect(idsA).not.toContain(centroB.asistenciaId);

    const b = await api("/assistances?limit=500", centroB.email);
    const idsB = b.body.data.map((x: any) => x.id);
    expect(idsB).toContain(centroB.asistenciaId);
    expect(idsB).not.toContain(centroA.asistenciaId);
  });

  it("la ficha de una asistencia ajena responde 404, no sus datos", async () => {
    // 404 y no 403 a propósito: confirmar que existe ya sería contar algo.
    const r = await api(`/assistances/${centroB.asistenciaId}`, centroA.email);
    expect(r.status).toBe(404);

    const propia = await api(`/assistances/${centroA.asistenciaId}`, centroA.email);
    expect(propia.status).toBe(200);
    expect(propia.body.id).toBe(centroA.asistenciaId);
  });

  it("la facturación no suma los importes de la otra central", async () => {
    const desde = now - 86_400_000;
    const hasta = now + 86_400_000;
    const a = await api(`/billing/summary?from=${desde}&to=${hasta}`, centroA.email);
    expect(a.status).toBe(200);
    // 331 es de alfa; 999 es de beta y no puede aparecer por ninguna parte.
    //
    // El "999" se busca en el cuerpo SIN el rango de fechas que la API devuelve
    // tal cual: son marcas de tiempo en milisegundos y tarde o temprano una
    // lleva "999" dentro, con lo que la prueba fallaba por el reloj y no por
    // una fuga de datos. Pasó de verdad un 16 de agosto.
    const { from: _desde, to: _hasta, ...datos } = a.body;
    expect(Number(a.body.totals.amount)).toBe(331);
    expect(JSON.stringify(datos)).not.toContain("999");
    expect(JSON.stringify(datos)).not.toContain("Partner beta");

    const b = await api(`/billing/summary?from=${desde}&to=${hasta}`, centroB.email);
    expect(Number(b.body.totals.amount)).toBe(999);
  });

  it("las líneas de facturación tampoco se cruzan", async () => {
    const desde = now - 86_400_000;
    const hasta = now + 86_400_000;
    const r = await api(`/billing/lines?from=${desde}&to=${hasta}`, centroA.email);
    const ids = r.body.data.map((x: any) => x.id);
    expect(ids).toContain(centroA.asistenciaId);
    expect(ids).not.toContain(centroB.asistenciaId);
  });

  it("el superadministrador del hub sí ve las dos", async () => {
    // Es quien da de alta y da soporte a las centrales: atraviesa a propósito.
    const r = await api("/assistances?limit=500", emailSuperadmin);
    const ids = r.body.data.map((x: any) => x.id);
    expect(ids).toContain(centroA.asistenciaId);
    expect(ids).toContain(centroB.asistenciaId);
  });

  it("una asistencia creada por la API hereda el centro de su partner", async () => {
    // Sin esto quedaría sin dueño: no la vería nadie al filtrar, que es peor
    // que verla de más porque desaparece sin avisar.
    const { createAssistance } = await import("./service.ts");
    const { row } = await createAssistance({
      partnerId: centroB.partnerId,
      serviceType: "tyres",
      address: "Ctra. N-340",
      customerName: "Cliente API",
    } as any);
    expect(row.controlCenterId).toBe(centroB.id);

    const ajena = await api("/assistances?limit=500", centroA.email);
    expect(ajena.body.data.map((x: any) => x.id)).not.toContain(row.id);

    await db.query(`DELETE FROM connect_assistances WHERE id = $1`, [row.id]);
  });
});
