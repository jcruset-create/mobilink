/**
 * Que el superadministrador pueda configurar una central, contra el router real.
 *
 * Esto existe por un fallo concreto: **Puesta en marcha no funcionaba con el
 * único rol que puede crear centrales**. `centroDe` devuelve null para el
 * superadministrador a propósito —en los listados eso significa «los ve
 * todos»—, pero configurar no es listar, así que las rutas de administración
 * exigen una central concreta y contestaban «Indica el centro de control».
 * Aceptaban `controlCenterId` para resolverlo; lo que faltaba era que el panel
 * lo mandase.
 *
 * Se habla por HTTP con el router de producción. Lo único sustituido es la
 * autenticación de Supabase, que aquí no se puede levantar.
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
      nombre: "Prueba", empresaId: "test", esSuperadmin: false,
    };
    next();
  },
}));

let base = "";
let servidor: Server;
let db: typeof import("../db.ts").default;

const sufijo = String(process.hrtime.bigint()).slice(-9);
const now = Date.now();

let centroId = 0;
let otroCentroId = 0;
let emailSuper = "";
let emailAdmin = "";

async function api(
  ruta: string, usuario: string,
  opciones?: { method?: string; body?: unknown },
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, {
    method: opciones?.method ?? "GET",
    headers: { "x-test-user": usuario, "Content-Type": "application/json" },
    body: opciones?.body !== undefined ? JSON.stringify(opciones.body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function crearCentro(nombre: string): Promise<number> {
  const r = await db.query(
    `INSERT INTO connect_control_centers (uuid, name, "createdAtMs", "updatedAtMs")
     VALUES ($1,$2,$3,$3) RETURNING id`,
    [`cc-${nombre}-${sufijo}`, `Central ${nombre} ${sufijo}`, now],
  );
  return r.rows[0].id;
}

describe.skipIf(!RUN)("Puesta en marcha con el superadministrador", () => {
  beforeAll(async () => {
    db = (await import("../db.ts")).default;
    const { initDb } = await import("../db.ts");
    const { initConnect } = await import("./schema.ts");
    const { createConnectBackofficeRouter } = await import("./backoffice.ts");
    await initDb();
    await initConnect();

    centroId = await crearCentro("setup");
    otroCentroId = await crearCentro("ajena");

    emailSuper = `super-setup-${sufijo}@example.com`;
    emailAdmin = `admin-setup-${sufijo}@example.com`;
    await db.query(
      `INSERT INTO connect_users ("controlCenterId", email, name, role, "createdAtMs", "updatedAtMs")
       VALUES ($1,$2,'Super','superadmin',$3,$3), ($1,$4,'Admin','cc_admin',$3,$3)`,
      [centroId, emailSuper, now, emailAdmin],
    );

    const app = express();
    app.use("/bo", createConnectBackofficeRouter());
    await new Promise<void>((ok) => { servidor = app.listen(0, () => ok()); });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/bo`;
  }, 60_000);

  afterAll(async () => {
    if (!RUN) return;
    servidor?.closeAllConnections?.();
    servidor?.close();
    for (const id of [centroId, otroCentroId]) {
      if (!id) continue;
      await db.query(`DELETE FROM connect_tariff_plans WHERE "controlCenterId" = $1`, [id]).catch(() => {});
      await db.query(`DELETE FROM connect_users WHERE "controlCenterId" = $1`, [id]).catch(() => {});
      await db.query(`DELETE FROM connect_control_centers WHERE id = $1`, [id]).catch(() => {});
    }
  }, 30_000);

  it("el superadministrador ve la lista de centrales para poder elegir", async () => {
    const r = await api("/setup/control-centers", emailSuper);
    expect(r.status).toBe(200);
    const ids = r.body.data.map((c: any) => c.id);
    expect(ids).toContain(centroId);
    expect(ids).toContain(otroCentroId);
    // Con nombre, que es lo que se pinta en el selector
    expect(r.body.data.find((c: any) => c.id === centroId).name).toContain("setup");
  });

  it("quien tiene central propia recibe la suya y solo la suya", async () => {
    const r = await api("/setup/control-centers", emailAdmin);
    expect(r.status).toBe(200);
    expect(r.body.data.map((c: any) => c.id)).toEqual([centroId]);
  });

  it("ESTE ERA EL FALLO: sin decir la central, se pide; diciéndola, funciona", async () => {
    const sin = await api("/setup/status", emailSuper);
    expect(sin.status).toBe(400);
    expect(sin.body.error.code).toBe("centro_requerido");

    const con = await api(`/setup/status?controlCenterId=${centroId}`, emailSuper);
    expect(con.status).toBe(200);
    expect(Array.isArray(con.body.pasos)).toBe(true);
    expect(con.body.pasos.length).toBeGreaterThan(0);
    // Cada paso dice por qué hace falta: es lo que hace útil la pantalla
    expect(con.body.pasos.every((p: any) => typeof p.porQue === "string" && p.porQue)).toBe(true);
  });

  it("el cc_admin sigue sin tener que decir nada", async () => {
    const r = await api("/setup/status", emailAdmin);
    expect(r.status).toBe(200);
    expect(r.body.pasos.length).toBeGreaterThan(0);
  });

  it("un controlCenterId vacío pide la central, no consulta la número 0", async () => {
    // Number("") es 0, y antes eso consultaba una central que no existe
    // devolviendo una puesta en marcha vacía en vez de pedir que se elija.
    const r = await api("/setup/status?controlCenterId=", emailSuper);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("centro_requerido");

    const cero = await api("/setup/status?controlCenterId=0", emailSuper);
    expect(cero.status).toBe(400);
  });

  it("el cc_admin no puede configurar otra central pidiéndolo por la query", async () => {
    // Su centro lo impone el backend a partir de su usuario: lo que llegue
    // por aquí se ignora, no se obedece.
    const r = await api(`/setup/status?controlCenterId=${otroCentroId}`, emailAdmin);
    expect(r.status).toBe(200);
    const suyo = await api("/setup/status", emailAdmin);
    expect(r.body).toEqual(suyo.body);
  });

  it("aplicar una plantilla crea el tarifario en la central elegida", async () => {
    const r = await api("/setup/apply-template", emailSuper, {
      method: "POST",
      body: {
        plantilla: "CARRETERA_24H", code: `T${sufijo}`.slice(0, 12),
        nombre: "Tarifario de prueba", anio: new Date().getFullYear(),
        controlCenterId: centroId,
      },
    });
    expect(r.status).toBe(200);
    expect(r.body.reglas).toBeGreaterThan(0);

    const fila = await db.query(
      `SELECT "controlCenterId" FROM connect_tariff_plans WHERE id = $1`, [r.body.tariffPlanId]);
    expect(Number(fila.rows[0].controlCenterId)).toBe(centroId);
  });

  it("y sin central, aplicar una plantilla no escribe nada", async () => {
    const antes = await db.query(`SELECT COUNT(*)::int n FROM connect_tariff_plans`);
    const r = await api("/setup/apply-template", emailSuper, {
      method: "POST",
      body: { plantilla: "CARRETERA_24H", code: "X", nombre: "X" },
    });
    expect(r.status).toBe(400);
    const despues = await db.query(`SELECT COUNT(*)::int n FROM connect_tariff_plans`);
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });
});
