/**
 * El ámbito por HTTP: lo de otra empresa y lo de otro taller no se ve ni se
 * toca, se pida por la ruta que se pida.
 *
 * Existe por una auditoría de las rutas. El servicio comprobaba la empresa y
 * el taller al escribir (abrir, cobrar, cerrar…), pero muchas rutas que se
 * piden por número no pasaban por ahí: seis lecturas de jornada no miraban ni
 * la empresa, así que con cambiar el número de la URL se leía la caja de otra
 * empresa. Ahora hay una puerta delante de todas (`PUERTAS` en `router.ts`), y
 * esta suite la prueba por Express, que es por donde se colaba.
 *
 * La autenticación es de mentira —quien llama lo dicen dos cabeceras—; el
 * resto es de verdad: el rol y el taller salen de `app_usuario_modulos`, como
 * en producción.
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

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
const EMPRESA_A = "00000000-0000-4000-a000-00000000a1b1";
const EMPRESA_B = "00000000-0000-4000-a000-00000000a1b2";
/** Admin de la empresa A sin taller: toda la empresa. */
const TODA_A = "00000000-0000-4000-a000-0000000a1b01";
/** Admin de la empresa A limitado al taller 1. */
const SOLO_T1 = "00000000-0000-4000-a000-0000000a1b02";
/** Admin de la empresa B. */
const DE_B = "00000000-0000-4000-a000-0000000a1b03";

let db: typeof import("../db.ts").default;
let base = "";
let servidor: Server;
let T1 = "";
let T2 = "";
let caja1 = 0;
let caja2 = 0;
let jornada1 = 0;
let jornada2 = 0;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function pedir(
  quien: string,
  empresa: string,
  ruta: string,
  opciones: { method?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, {
    method: opciones.method ?? "GET",
    headers: {
      "x-usuario": quien,
      "x-empresa": empresa,
      ...(opciones.body ? { "content-type": "application/json" } : {}),
    },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const texto = await res.text();
  let body: any = texto;
  try {
    body = JSON.parse(texto);
  } catch {
    /* PDF u otro binario */
  }
  return { status: res.status, body };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Un taller de verdad en `app_centros` si la base tiene la fundación SaaS; si
 * no, un id cualquiera pero distinto cada vez (ver «Ámbito por taller» en
 * `cash.integration.test.ts`, que hace lo mismo y explica por qué).
 */
async function taller(empresa: string, nombre: string): Promise<string> {
  const { rows: hay } = await db.query(`SELECT to_regclass('public.app_centros') IS NOT NULL AS hay`);
  if (!hay[0]?.hay) {
    const cola = String(process.hrtime.bigint()).slice(-12).padStart(12, "0");
    return `00000000-0000-4000-a000-${cola}`;
  }
  await db.query(
    `INSERT INTO app_empresas (id, nombre, slug) VALUES ($1, 'Ámbito', 'ambito-' || $2)
     ON CONFLICT (id) DO NOTHING`,
    [empresa, empresa]
  );
  const { rows } = await db.query(
    `INSERT INTO app_centros (empresa_id, nombre) VALUES ($1, $2) RETURNING id`,
    [empresa, `${nombre}-${sufijo}`]
  );
  return rows[0].id;
}

async function caja(empresa: string, centroId: string, nombre: string): Promise<number> {
  const ahora = Date.now();
  const { rows } = await db.query(
    `INSERT INTO cash_registers (empresa_id, centro, centro_id, nombre, created_at_ms, updated_at_ms)
     VALUES ($1, 'ambito', $2, $3, $4, $4) RETURNING id`,
    [empresa, centroId, `${nombre}-${sufijo}`, ahora]
  );
  const id = rows[0].id as number;
  await db.query(`UPDATE cash_registers SET codigo = $2 WHERE id = $1`, [
    id,
    `H${id.toString(36).toUpperCase()}`,
  ]);
  return id;
}

describe.skipIf(!RUN)("ámbito de caja por HTTP", () => {
  beforeAll(async () => {
    const { initDb } = await import("../db.ts");
    db = (await import("../db.ts")).default;
    await initDb();
    await (await import("./schema.ts")).initCash();

    // La tabla es de Supabase; en la base de pruebas se crea si falta.
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_usuario_modulos (
        user_id UUID NOT NULL,
        modulo TEXT NOT NULL,
        rol TEXT,
        pantallas TEXT[],
        centro_id UUID,
        PRIMARY KEY (user_id, modulo)
      );
    `);
    T1 = await taller(EMPRESA_A, "ambito-t1");
    T2 = await taller(EMPRESA_A, "ambito-t2");
    const TB = await taller(EMPRESA_B, "ambito-tb");
    for (const [usuario, centro] of [
      [TODA_A, null],
      [SOLO_T1, T1],
      [DE_B, null],
    ] as const) {
      await db.query(
        `INSERT INTO app_usuario_modulos (user_id, modulo, rol, centro_id) VALUES ($1, 'cash', 'admin', $2)
         ON CONFLICT (user_id, modulo) DO UPDATE SET rol = 'admin', centro_id = $2`,
        [usuario, centro]
      );
    }

    caja1 = await caja(EMPRESA_A, T1, "ambito-caja1");
    caja2 = await caja(EMPRESA_A, T2, "ambito-caja2");
    await caja(EMPRESA_B, TB, "ambito-cajab");

    const servicio = await import("./service.ts");
    const ctxA = { empresaId: EMPRESA_A, userId: null };
    jornada1 = (await servicio.abrirJornada(ctxA, { registerId: caja1, fondoManual: [] })).sesion.id;
    jornada2 = (await servicio.abrirJornada(ctxA, { registerId: caja2, fondoManual: [] })).sesion.id;

    const app = express();
    app.use(express.json());
    const { createCashRouter } = await import("./router.ts");
    app.use("/api/cash", createCashRouter());
    await new Promise<void>((resolve) => {
      servidor = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/cash`;
  }, 180_000);

  afterAll(async () => {
    if (servidor) await new Promise<void>((r) => servidor.close(() => r()));
  });

  /*
   * La puerta deja pasar cuando la respuesta no es suya: ni «no existe» ni
   * «de otro taller». Lo que conteste la ruta después es asunto de la ruta —la
   * propuesta de cierre de una jornada sin arqueo, por ejemplo, es un 409—.
   */
  const DEJA_PASAR = (r: { status: number }) => r.status !== 403 && r.status !== 404;

  /** Las seis lecturas que no miraban ni la empresa. */
  const LECTURAS_DE_JORNADA = (j: number, c: number) => [
    `/sessions/${j}`,
    `/sessions/${j}/stock`,
    `/sessions/${j}/movements`,
    `/sessions/${j}/change?importe=100`,
    `/sessions/${j}/closing-proposal`,
    `/registers/${c}/session`,
  ];

  it("otra empresa no lee una jornada cambiando el número de la URL: «no existe»", async () => {
    for (const ruta of LECTURAS_DE_JORNADA(jornada1, caja1)) {
      const r = await pedir(DE_B, EMPRESA_B, ruta);
      expect(r.status, ruta).toBe(404);
      // «No existe» y no «no puedes»: un 403 confirmaría que el número existe.
      expect(r.body.code, ruta).toMatch(/NO_ENCONTRADA$/);
    }
  });

  it("quien tiene toda la empresa las sigue leyendo", async () => {
    for (const ruta of LECTURAS_DE_JORNADA(jornada2, caja2)) {
      const r = await pedir(TODA_A, EMPRESA_A, ruta);
      expect(DEJA_PASAR(r), ruta).toBe(true);
    }
  });

  it("limitado a un taller: la suya sí, la del otro taller no", async () => {
    for (const ruta of LECTURAS_DE_JORNADA(jornada1, caja1)) {
      expect(DEJA_PASAR(await pedir(SOLO_T1, EMPRESA_A, ruta)), ruta).toBe(true);
    }
    for (const ruta of [
      ...LECTURAS_DE_JORNADA(jornada2, caja2),
      `/sessions/${jornada2}/report.pdf`,
      `/sessions/${jornada2}/documents`,
      `/registers/${caja2}/bank-deposits`,
      `/registers/${caja2}/treasury/pending`,
    ]) {
      const r = await pedir(SOLO_T1, EMPRESA_A, ruta);
      expect(r.status, ruta).toBe(403);
      expect(r.body.code, ruta).toBe("CAJA_FUERA_DE_AMBITO");
    }
  });

  it("y tampoco escribe en ella: anular la jornada o hacer un ingreso de la caja del otro taller", async () => {
    const anular = await pedir(SOLO_T1, EMPRESA_A, `/sessions/${jornada2}/void`, {
      method: "POST",
      body: { motivo: "prueba" },
    });
    expect(anular.status).toBe(403);

    const ingreso = await pedir(SOLO_T1, EMPRESA_A, "/bank-deposits", {
      method: "POST",
      body: { registerId: caja2, sessionIds: [jornada2], importeCentimos: 100 },
    });
    expect(ingreso.status).toBe(403);
    expect(ingreso.body.code).toBe("CAJA_FUERA_DE_AMBITO");
  });

  it("no se queda con la caja de otro taller moviéndola al suyo, ni da de alta cajas fuera del suyo", async () => {
    const mover = await pedir(SOLO_T1, EMPRESA_A, `/registers/${caja2}`, {
      method: "PATCH",
      body: { centroId: T1 },
    });
    expect(mover.status).toBe(403);

    const sacar = await pedir(SOLO_T1, EMPRESA_A, `/registers/${caja1}`, {
      method: "PATCH",
      body: { centroId: T2 },
    });
    expect(sacar.status).toBe(403);

    const alta = await pedir(SOLO_T1, EMPRESA_A, "/registers", {
      method: "POST",
      body: { nombre: `ambito-nueva-${sufijo}`, centroId: T2 },
    });
    expect(alta.status).toBe(403);

    const { rows } = await db.query(`SELECT centro_id FROM cash_registers WHERE id = $1`, [caja2]);
    expect(rows[0].centro_id).toBe(T2);
  });

  it("lo que no es un número pasa la puerta y lo decide su ruta", async () => {
    const r = await pedir(SOLO_T1, EMPRESA_A, "/autoscan/inbox/summary");
    expect(r.status).toBe(200);
  });

  it("los traslados de la lista son solo los que tocan una caja de tu taller", async () => {
    const r = await pedir(SOLO_T1, EMPRESA_A, `/transfers?registerId=${caja2}`);
    expect(r.status).toBe(403);
    expect((await pedir(SOLO_T1, EMPRESA_A, "/transfers")).status).toBe(200);
  });
});
