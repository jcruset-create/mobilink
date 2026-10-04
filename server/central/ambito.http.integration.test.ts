/**
 * MC Central con un usuario limitado a un taller: ve su taller y solo el suyo.
 *
 * Central guardaba el taller del usuario pero casi no lo usaba: el taller lo
 * elegía el propio usuario en la pantalla (`?centroId=`). Ahora manda el suyo,
 * pedir otro es un 403, y lo que es de toda la red y no se puede recortar
 * (reglas, previsión, extractos, organización…) se le niega entero.
 *
 * La autenticación es de mentira —quien llama lo dicen dos cabeceras—; el rol
 * y el taller salen de `app_usuario_modulos`, como en producción.
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

vi.mock("../core/auth.ts", async (original) => {
  const real = await original<typeof import("../core/auth.ts")>();
  return {
    ...real,
    authenticate: ((req, _res, next) => {
      req.authCtx = {
        userId: String(req.headers["x-usuario"]),
        username: "prueba",
        nombre: "Prueba",
        empresaId: String(req.headers["x-empresa"]),
        esSuperadmin: false,
        esAdmin: false,
      };
      next();
    }) as typeof real.authenticate,
    requireModule: (() => (_req, _res, next) => next()) as typeof real.requireModule,
  };
});

const sufijo = String(process.hrtime.bigint()).slice(-9);
const EMPRESA = "00000000-0000-4000-a000-00000000c3b1";
/** Admin de Central de toda la red. */
const TODA = "00000000-0000-4000-a000-0000000c3b01";
/** Consulta de Central limitado al taller 1. */
const SOLO_T1 = "00000000-0000-4000-a000-0000000c3b02";

let db: typeof import("../db.ts").default;
let base = "";
let servidor: Server;
let T1 = "";
let T2 = "";
let caja1 = 0;
let caja2 = 0;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function pedir(quien: string, ruta: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, { headers: { "x-usuario": quien, "x-empresa": EMPRESA } });
  const texto = await res.text();
  let body: any = texto;
  try {
    body = JSON.parse(texto);
  } catch {
    /* binario */
  }
  return { status: res.status, body };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Ver `taller()` en `server/cash/ambito.http.integration.test.ts`. */
async function taller(nombre: string): Promise<string> {
  const { rows: hay } = await db.query(`SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`);
  if (!hay[0]?.hay) {
    const cola = String(process.hrtime.bigint()).slice(-12).padStart(12, "0");
    return `00000000-0000-4000-a000-${cola}`;
  }
  await db.query(
    `INSERT INTO app_empresas (id, nombre, slug) VALUES ($1, 'Central', 'central-' || $2)
     ON CONFLICT (id) DO NOTHING`,
    [EMPRESA, EMPRESA]
  );
  const { rows } = await db.query(
    `INSERT INTO app_centros (empresa_id, nombre) VALUES ($1, $2) RETURNING id`,
    [EMPRESA, `${nombre}-${sufijo}`]
  );
  return rows[0].id;
}

async function caja(centroId: string, nombre: string): Promise<number> {
  const ahora = Date.now();
  const { rows } = await db.query(
    `INSERT INTO cash_registers (empresa_id, centro, centro_id, nombre, created_at_ms, updated_at_ms)
     VALUES ($1, 'central', $2, $3, $4, $4) RETURNING id`,
    [EMPRESA, centroId, `${nombre}-${sufijo}`, ahora]
  );
  const id = rows[0].id as number;
  await db.query(`UPDATE cash_registers SET codigo = $2 WHERE id = $1`, [id, `K${id.toString(36).toUpperCase()}`]);
  return id;
}

describe.skipIf(!RUN)("MC Central: el ámbito de taller", () => {
  beforeAll(async () => {
    const { initDb } = await import("../db.ts");
    db = (await import("../db.ts")).default;
    await initDb();
    await (await import("../cash/schema.ts")).initCash();
    await (await import("./schema.ts")).initCentral();

    // Con la MISMA forma que la de la plataforma, como hacen las demás pruebas
    // que la crean con IF NOT EXISTS: una recortada dejaría sin columnas a la
    // siguiente que pase por la misma base.
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_usuario_modulos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, modulo text NOT NULL,
        rol text, pantallas text[], empresa_id uuid, centro_id uuid, UNIQUE (user_id, modulo));
      ALTER TABLE app_usuario_modulos ADD COLUMN IF NOT EXISTS centro_id uuid;
      ALTER TABLE app_usuario_modulos ADD COLUMN IF NOT EXISTS empresa_id uuid;
    `);
    T1 = await taller("central-t1");
    T2 = await taller("central-t2");
    for (const [usuario, rol, centro] of [
      [TODA, "admin", null],
      [SOLO_T1, "consulta", T1],
    ] as const) {
      await db.query(
        `INSERT INTO app_usuario_modulos (user_id, modulo, rol, centro_id) VALUES ($1, 'central', $2, $3)
         ON CONFLICT (user_id, modulo) DO UPDATE SET rol = $2, centro_id = $3`,
        [usuario, rol, centro]
      );
    }
    caja1 = await caja(T1, "central-caja1");
    caja2 = await caja(T2, "central-caja2");

    const app = express();
    app.use(express.json());
    const { createCentralRouter } = await import("./router.ts");
    app.use("/api/central", createCentralRouter());
    await new Promise<void>((resolve) => {
      servidor = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/central`;
  }, 180_000);

  afterAll(async () => {
    if (servidor) await new Promise<void>((r) => servidor.close(() => r()));
  });

  it("la red: solo las cajas de su taller", async () => {
    const r = await pedir(SOLO_T1, "/network");
    expect(r.status).toBe(200);
    const ids = r.body.cajas.map((c: { registerId: number }) => c.registerId);
    expect(ids).toContain(caja1);
    expect(ids).not.toContain(caja2);
    expect(r.body.ambitoCentroId).toBe(T1);

    const toda = await pedir(TODA, "/network");
    const todas = toda.body.cajas.map((c: { registerId: number }) => c.registerId);
    expect(todas).toContain(caja1);
    expect(todas).toContain(caja2);
  });

  it("la posición: sus cajas, y el total es el de sus cajas", async () => {
    const r = await pedir(SOLO_T1, "/position");
    expect(r.status).toBe(200);
    const ids = r.body.porCaja.map((c: { registerId: number }) => c.registerId);
    expect(ids).not.toContain(caja2);
    const suma = r.body.porCaja.reduce((a: number, c: { totalCentimos: number }) => a + c.totalCentimos, 0);
    expect(r.body.posicion.totalCentimos).toBe(suma);
  });

  it("pedir otro taller por la URL es un 403, no un listado vacío", async () => {
    for (const ruta of [
      `/sessions?centroId=${T2}`,
      `/deposits?centroId=${T2}`,
      `/position/breakdown?centroId=${T2}`,
    ]) {
      const r = await pedir(SOLO_T1, ruta);
      expect(r.status, ruta).toBe(403);
      expect(r.body.code, ruta).toBe("TALLER_FUERA_DE_AMBITO");
    }
    // Su propio taller, sí.
    expect((await pedir(SOLO_T1, `/sessions?centroId=${T1}`)).status).toBe(200);

    // Y el desglose de una caja de otro taller sale vacío: el taller manda.
    const desglose = await pedir(SOLO_T1, `/position/breakdown?registerId=${caja2}`);
    expect(desglose.status).toBe(200);
    expect(desglose.body.cajas).toEqual([]);
  });

  it("lo que es de toda la red se le niega; a quien tiene toda la red, no", async () => {
    for (const ruta of ["/alerts", "/change", "/forecast", "/kpis", "/zones", "/statements", "/health"]) {
      const r = await pedir(SOLO_T1, ruta);
      expect(r.status, ruta).toBe(403);
      expect(r.body.code, ruta).toBe("SOLO_TODA_LA_RED");
    }
    const r = await pedir(TODA, "/alerts");
    expect(r.status).not.toBe(403);
  });
});
