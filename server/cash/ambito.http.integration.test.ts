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
/** Fase 2: cajero del taller 1, con solo la caja 1 asignada. */
const CAJERO_T1 = "00000000-0000-4000-a000-0000000a1b04";
/** Fase 2: otro cajero, todavía sin ninguna caja. */
const CAJERO_SIN = "00000000-0000-4000-a000-0000000a1b05";
/** Fase 2: responsable del taller 1. */
const RESP_T1 = "00000000-0000-4000-a000-0000000a1b06";

let db: typeof import("../db.ts").default;
let base = "";
let servidor: Server;
let T1 = "";
let T2 = "";
let caja1 = 0;
let caja2 = 0;
let jornada1 = 0;
let jornada2 = 0;
let caja3 = 0;
let jornada3 = 0;

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

    // La tabla es de Supabase; en la base de pruebas se crea si falta, con la
    // MISMA forma que la de la plataforma: una recortada dejaría sin columnas a
    // la siguiente prueba que la cree con IF NOT EXISTS en la misma base.
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_usuario_modulos (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, modulo text NOT NULL,
        rol text, pantallas text[], empresa_id uuid, centro_id uuid, UNIQUE (user_id, modulo));
      ALTER TABLE app_usuario_modulos ADD COLUMN IF NOT EXISTS centro_id uuid;
      ALTER TABLE app_usuario_modulos ADD COLUMN IF NOT EXISTS empresa_id uuid;
    `);
    T1 = await taller(EMPRESA_A, "ambito-t1");
    T2 = await taller(EMPRESA_A, "ambito-t2");
    const TB = await taller(EMPRESA_B, "ambito-tb");

    // Las cuentas de usuario son de Supabase: en la base de pruebas se crean si
    // faltan, con las columnas de la de verdad (las mismas que pone
    // `seguridadMigracion.integration.test.ts`, que comparte la base).
    await db.query(`
      CREATE TABLE IF NOT EXISTS app_usuarios (
        id uuid PRIMARY KEY, username text NOT NULL, nombre text NOT NULL,
        email_recuperacion text, telefono text, activo boolean NOT NULL DEFAULT true,
        es_superadmin boolean NOT NULL DEFAULT false, employee_id uuid, empresa_id uuid,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
      ALTER TABLE app_usuarios ADD COLUMN IF NOT EXISTS empresa_id uuid;
      ALTER TABLE app_usuario_modulos ADD COLUMN IF NOT EXISTS centro_id uuid;
    `);
    for (const [usuario, empresa, rol, centro] of [
      [TODA_A, EMPRESA_A, "admin", null],
      [SOLO_T1, EMPRESA_A, "admin", T1],
      [DE_B, EMPRESA_B, "admin", null],
      [CAJERO_T1, EMPRESA_A, "cajero", T1],
      [CAJERO_SIN, EMPRESA_A, "cajero", T1],
      [RESP_T1, EMPRESA_A, "responsable", T1],
    ] as const) {
      await db.query(
        `INSERT INTO app_usuarios (id, username, nombre, empresa_id) VALUES ($1, $2, $2, $3)
         ON CONFLICT (id) DO UPDATE SET empresa_id = $3`,
        [usuario, `ambito-${usuario.slice(-4)}-${sufijo}`, empresa]
      );
      await db.query(
        `INSERT INTO app_usuario_modulos (user_id, modulo, rol, centro_id) VALUES ($1, 'cash', $2, $3)
         ON CONFLICT (user_id, modulo) DO UPDATE SET rol = $2, centro_id = $3`,
        [usuario, rol, centro]
      );
    }
    await db.query(`DELETE FROM cash_usuario_cajas WHERE empresa_id = $1`, [EMPRESA_A]);
    await db.query(`DELETE FROM cash_settings WHERE empresa_id = $1 AND clave = 'exigir_asignacion_caja'`, [
      EMPRESA_A,
    ]);

    caja1 = await caja(EMPRESA_A, T1, "ambito-caja1");
    caja2 = await caja(EMPRESA_A, T2, "ambito-caja2");
    await caja(EMPRESA_B, TB, "ambito-cajab");
    caja3 = await caja(EMPRESA_A, T1, "ambito-caja3");

    const servicio = await import("./service.ts");
    const ctxA = { empresaId: EMPRESA_A, userId: null };
    jornada1 = (await servicio.abrirJornada(ctxA, { registerId: caja1, fondoManual: [] })).sesion.id;
    jornada2 = (await servicio.abrirJornada(ctxA, { registerId: caja2, fondoManual: [] })).sesion.id;
    jornada3 = (await servicio.abrirJornada(ctxA, { registerId: caja3, fondoManual: [] })).sesion.id;

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
    if (RUN && db) {
      // El interruptor es de la empresa: que no se quede encendido para otra vuelta.
      await db.query(`DELETE FROM cash_settings WHERE empresa_id = $1 AND clave = 'exigir_asignacion_caja'`, [
        EMPRESA_A,
      ]);
    }
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

  // ── Fase 2: cajas asignadas ────────────────────────────────────────────────

  const cajasDe = async (quien: string) =>
    ((await pedir(quien, EMPRESA_A, "/bootstrap")).body.cajas as { id: number }[]).map((c) => c.id);

  it("con la regla apagada, el cajero ve todas las cajas de su taller", async () => {
    const cajas = await cajasDe(CAJERO_T1);
    expect(cajas).toContain(caja1);
    expect(cajas).toContain(caja3);
    expect(cajas).not.toContain(caja2);
  });

  it("el admin asigna taller y cajas; una caja de otro taller no se puede", async () => {
    const mal = await pedir(TODA_A, EMPRESA_A, `/access/users/${CAJERO_T1}`, {
      method: "PUT",
      body: { centroId: T1, cajas: [caja1, caja2] },
    });
    expect(mal.status).toBe(409);
    expect(mal.body.code).toBe("CAJA_DE_OTRO_TALLER");

    const bien = await pedir(TODA_A, EMPRESA_A, `/access/users/${CAJERO_T1}`, {
      method: "PUT",
      body: { centroId: T1, cajas: [caja1] },
    });
    expect(bien.status).toBe(200);
    expect(bien.body.usuario.cajas).toEqual([caja1]);

    const lista = await pedir(TODA_A, EMPRESA_A, "/access");
    expect(lista.status).toBe(200);
    const yo = lista.body.usuarios.find((u: { userId: string }) => u.userId === CAJERO_T1);
    expect(yo).toMatchObject({ centroId: T1, cajas: [caja1], limitadoPorCaja: true });
    expect(lista.body.sinCaja).toBeGreaterThanOrEqual(1); // CAJERO_SIN
  });

  it("no se enciende con cajeros sin caja, salvo forzándolo", async () => {
    const r = await pedir(TODA_A, EMPRESA_A, "/access/enforce", { method: "PUT", body: { exigir: true } });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("USUARIOS_SIN_CAJA");
    // Apagada sigue: el cajero aún ve la caja 3.
    expect(await cajasDe(CAJERO_T1)).toContain(caja3);

    const forzado = await pedir(TODA_A, EMPRESA_A, "/access/enforce", {
      method: "PUT",
      body: { exigir: true, forzar: true },
    });
    expect(forzado.status).toBe(200);
    expect(forzado.body.exigirAsignacion).toBe(true);
  });

  it("encendida: el cajero solo ve y toca su caja", async () => {
    expect(await cajasDe(CAJERO_T1)).toEqual([caja1]);

    expect(DEJA_PASAR(await pedir(CAJERO_T1, EMPRESA_A, `/sessions/${jornada1}`))).toBe(true);
    const otra = await pedir(CAJERO_T1, EMPRESA_A, `/sessions/${jornada3}`);
    expect(otra.status).toBe(403);
    expect(otra.body.code).toBe("CAJA_NO_ASIGNADA");

    // Cobrar en la caja que no tiene: lo para el servicio, no solo la puerta.
    const cobro = await pedir(CAJERO_T1, EMPRESA_A, "/collections", {
      method: "POST",
      body: {
        sessionId: jornada3,
        importeCentimos: 100,
        formasPago: [{ forma: "CASH", importe: 100 }],
        efectivoRecibido: [{ valor: 100, cantidad: 1 }],
        concepto: "prueba",
      },
    });
    expect(cobro.status).toBe(403);
    expect(cobro.body.code).toBe("CAJA_NO_ASIGNADA");

    const posicion = await pedir(CAJERO_T1, EMPRESA_A, "/posicion");
    expect(posicion.body.cajas.map((c: { registerId: number }) => c.registerId)).toEqual([caja1]);

    const historico = await pedir(CAJERO_T1, EMPRESA_A, "/sessions");
    expect(
      historico.body.sesiones.every((s: { register_id: number }) => s.register_id === caja1)
    ).toBe(true);
  });

  it("el cajero sin caja no ve ninguna; el responsable ve todas las de su taller", async () => {
    expect(await cajasDe(CAJERO_SIN)).toEqual([]);
    const resp = await cajasDe(RESP_T1);
    expect(resp).toContain(caja1);
    expect(resp).toContain(caja3);
    expect(resp).not.toContain(caja2);
  });

  it("asignar es solo de admin, y un admin de taller no saca a nadie de su taller", async () => {
    const cajero = await pedir(CAJERO_T1, EMPRESA_A, "/access");
    expect(cajero.status).toBe(403);
    const resp = await pedir(RESP_T1, EMPRESA_A, "/access");
    expect(resp.status).toBe(403);

    const fuera = await pedir(SOLO_T1, EMPRESA_A, `/access/users/${CAJERO_T1}`, {
      method: "PUT",
      body: { centroId: T2, cajas: [caja2] },
    });
    expect(fuera.status).toBe(403);
    const interruptor = await pedir(SOLO_T1, EMPRESA_A, "/access/enforce", {
      method: "PUT",
      body: { exigir: false },
    });
    expect(interruptor.status).toBe(403);

    // Dentro de su taller, sí.
    const dentro = await pedir(SOLO_T1, EMPRESA_A, `/access/users/${CAJERO_SIN}`, {
      method: "PUT",
      body: { centroId: T1, cajas: [caja3] },
    });
    expect(dentro.status).toBe(200);
    expect(await cajasDe(CAJERO_SIN)).toEqual([caja3]);
  });

  it("de otra empresa no se asigna a nadie", async () => {
    const r = await pedir(DE_B, EMPRESA_B, `/access/users/${CAJERO_T1}`, {
      method: "PUT",
      body: { centroId: null, cajas: [] },
    });
    expect(r.status).toBe(404);
  });

  it("apagada otra vez, todo vuelve a ser del taller", async () => {
    const r = await pedir(TODA_A, EMPRESA_A, "/access/enforce", { method: "PUT", body: { exigir: false } });
    expect(r.status).toBe(200);
    expect(await cajasDe(CAJERO_T1)).toContain(caja3);
  });
});
