/**
 * ¿Llegó el SMS del enlace? — contra Postgres, con la migración tal cual se
 * pega en Supabase y un Twilio de mentira que contesta lo que se le diga.
 */

import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type RequestHandler } from "express";
import type { PoolClient } from "pg";

import type { RespuestaTwilio } from "./entregaSms.ts";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;
const ESQUEMA = `prueba_entrega_sms_${process.pid}`;
const MIGRACION = readFileSync(
  new URL("../../supabase/migrations/core_alta_entrega_sms.sql", import.meta.url),
  "utf8"
);

const ANA = "1a1a1a1a-0000-4000-a000-000000000001";
const PEP = "1b1b1b1b-0000-4000-a000-000000000002";
const LUZ = "1c1c1c1c-0000-4000-a000-000000000003";
const NIL = "1d1d1d1d-0000-4000-a000-000000000004";

/** Un instante fijo: nada depende del reloj de la máquina. */
const AHORA = Date.parse("2026-11-26T18:00:00Z");
const hace = (min: number) => new Date(AHORA - min * 60_000).toISOString();
const dentroDe = (horas: number) => new Date(AHORA + horas * 3_600_000).toISOString();

let conexion: PoolClient;
let mod: typeof import("./entregaSms.ts");

/** Lo que «Twilio» contesta por cada mensaje, y por cuáles se le ha preguntado. */
const twilio = new Map<string, RespuestaTwilio | Error>();
let preguntados: string[] = [];
const consultar = async (sid: string): Promise<RespuestaTwilio> => {
  preguntados.push(sid);
  const r = twilio.get(sid);
  if (!r) throw new Error(`mensaje ${sid} desconocido`);
  if (r instanceof Error) throw r;
  return r;
};
const deps = (ahora = AHORA) => ({ consultor: conexion, consultar, ahora: () => ahora });

let n = 0;
async function enlace(p: {
  de: string;
  sid: string | null;
  enviadoHaceMin: number;
  estado?: string;
  caduca?: string;
}) {
  n += 1;
  await conexion.query(
    `INSERT INTO sea_employee_invites (employee_id, token_hash, telefono, estado, caduca_at, enviado_at, mensaje_sid)
     VALUES ($1, $2, '+34600000001', $3, $4, $5, $6)`,
    [p.de, `hash-${n}`, p.estado ?? "enviado", p.caduca ?? dentroDe(48), hace(p.enviadoHaceMin), p.sid]
  );
}
const guardado = async (sid: string) =>
  (await conexion.query(
    `SELECT entrega, entrega_codigo, entrega_detalle, entrega_at FROM sea_employee_invites WHERE mensaje_sid = $1`,
    [sid]
  )).rows[0];

beforeAll(async () => {
  if (!RUN) return;
  const db = (await import("../db.ts")).default;
  mod = await import("./entregaSms.ts");
  conexion = await db.connect();
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE; CREATE SCHEMA ${ESQUEMA}`);
  await conexion.query(`SET search_path = ${ESQUEMA}`);
  // La tabla como la deja core_alta_operario.sql (lo que aquí importa de ella).
  await conexion.query(`
    CREATE TABLE sea_employees (id uuid PRIMARY KEY, nombre text NOT NULL);
    CREATE TABLE sea_employee_invites (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id  uuid NOT NULL REFERENCES sea_employees(id) ON DELETE CASCADE,
      token_hash   text NOT NULL UNIQUE,
      telefono     text NOT NULL,
      canal        text NOT NULL DEFAULT 'sms',
      estado       text NOT NULL DEFAULT 'enviado',
      caduca_at    timestamptz NOT NULL,
      enviado_at   timestamptz NOT NULL DEFAULT now(),
      abierto_at   timestamptz,
      mensaje_sid  text,
      error        text
    );
    INSERT INTO sea_employees (id, nombre) VALUES ('${ANA}', 'Ana'), ('${PEP}', 'Pep'), ('${LUZ}', 'Luz'), ('${NIL}', 'Nil');
  `);
});

afterAll(async () => {
  if (!RUN) return;
  await conexion.query(`DROP SCHEMA IF EXISTS ${ESQUEMA} CASCADE`);
  conexion.release();
});

describe.runIf(RUN)("la migración", () => {
  it("sin ella no hay nada que enseñar, y se dice en vez de fallar", async () => {
    expect(await mod.hayEntrega(conexion)).toBe(false);
  });

  it("entra, se puede repetir y no toca lo que había", async () => {
    await enlace({ de: NIL, sid: "SMviejo", enviadoHaceMin: 5000, estado: "recibida", caduca: hace(600) });
    await conexion.query(MIGRACION);
    await conexion.query(MIGRACION);
    expect(await mod.hayEntrega(conexion)).toBe(true);
    const { rows } = await conexion.query(
      `SELECT estado, mensaje_sid, entrega, entrega_at FROM sea_employee_invites WHERE mensaje_sid = 'SMviejo'`
    );
    expect(rows[0]).toEqual({ estado: "recibida", mensaje_sid: "SMviejo", entrega: null, entrega_at: null });
  });
});

describe.runIf(RUN)("preguntar a Twilio por los enlaces vivos", () => {
  beforeEach(async () => {
    await conexion.query(`DELETE FROM sea_employee_invites`);
    twilio.clear();
    preguntados = [];
  });

  it("un SMS aceptado que no llegó se ve como no entregado, con su porqué", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 30 });
    twilio.set("SMana", { status: "undelivered", errorCode: 30003, errorMessage: "Unreachable destination handset" });

    const entregas = await mod.entregasDeEnlaces(deps());

    expect(entregas[ANA]).toEqual({
      estado: "no_entregado",
      motivo: "El móvil está apagado o sin cobertura. (código 30003 de Twilio)",
      telefono: "+34600000001",
      enviadoAt: hace(30),
    });
    expect(await guardado("SMana")).toMatchObject({
      entrega: "no_entregado",
      entrega_codigo: 30003,
      entrega_detalle: "Unreachable destination handset",
    });
  });

  it("uno entregado se apunta y no se vuelve a preguntar por él", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 3 });
    twilio.set("SMana", { status: "delivered", errorCode: null, errorMessage: null });

    expect((await mod.entregasDeEnlaces(deps()))[ANA]).toMatchObject({ estado: "entregado", motivo: null });
    expect(preguntados).toEqual(["SMana"]);

    // Una hora después, con Twilio diciendo otra cosa: ya no se le pregunta.
    twilio.set("SMana", { status: "failed", errorCode: 30008, errorMessage: "x" });
    expect((await mod.entregasDeEnlaces(deps(AHORA + 3_600_000)))[ANA].estado).toBe("entregado");
    expect(preguntados).toEqual(["SMana"]);
  });

  it("«enviado» por Twilio es en camino, y se pregunta otra vez pasado medio minuto, no antes", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 1 });
    twilio.set("SMana", { status: "sent", errorCode: null, errorMessage: null });

    expect((await mod.entregasDeEnlaces(deps()))[ANA].estado).toBe("en_camino");
    await mod.entregasDeEnlaces(deps(AHORA + 10_000));
    expect(preguntados).toHaveLength(1);

    twilio.set("SMana", { status: "delivered", errorCode: null, errorMessage: null });
    expect((await mod.entregasDeEnlaces(deps(AHORA + 40_000)))[ANA].estado).toBe("entregado");
    expect(preguntados).toHaveLength(2);
  });

  it("un en camino de hace más de un cuarto de hora se enseña como sin confirmar", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 90 });
    twilio.set("SMana", { status: "sent", errorCode: null, errorMessage: null });

    expect((await mod.entregasDeEnlaces(deps()))[ANA].estado).toBe("sin_confirmar");
    // Lo guardado sigue siendo «en camino»: «sin confirmar» depende de cuándo se mire.
    expect((await guardado("SMana")).entrega).toBe("en_camino");
  });

  it("solo cuenta el ÚLTIMO enlace de cada persona", async () => {
    await enlace({ de: ANA, sid: "SMprimero", enviadoHaceMin: 200, estado: "anulada" });
    await enlace({ de: ANA, sid: "SMsegundo", enviadoHaceMin: 2 });
    twilio.set("SMprimero", { status: "undelivered", errorCode: 30005, errorMessage: "x" });
    twilio.set("SMsegundo", { status: "delivered", errorCode: null, errorMessage: null });

    expect((await mod.entregasDeEnlaces(deps()))[ANA].estado).toBe("entregado");
    expect(preguntados).toEqual(["SMsegundo"]);
  });

  it("no se pregunta por un enlace abierto, recibido, anulado, caducado o sin identificador", async () => {
    await enlace({ de: ANA, sid: "SMabierto", enviadoHaceMin: 10, estado: "abierto" });
    await enlace({ de: PEP, sid: "SMcaducado", enviadoHaceMin: 6000, caduca: hace(60) });
    await enlace({ de: LUZ, sid: null, enviadoHaceMin: 10 });
    await enlace({ de: NIL, sid: "SManulado", enviadoHaceMin: 10, estado: "anulada" });

    expect(await mod.entregasDeEnlaces(deps())).toEqual({});
    expect(preguntados).toEqual([]);
  });

  it("si el último enlace está anulado, no se enseña el anterior aunque siguiera vivo", async () => {
    await enlace({ de: ANA, sid: "SMvivo", enviadoHaceMin: 100 });
    await enlace({ de: ANA, sid: "SMfallido", enviadoHaceMin: 5, estado: "anulada" });

    expect(await mod.entregasDeEnlaces(deps())).toEqual({});
  });

  it("si Twilio falla con uno, los demás salen y ese se queda como estaba", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 2 });
    await enlace({ de: PEP, sid: "SMpep", enviadoHaceMin: 2 });
    twilio.set("SMana", new Error("Twilio caído"));
    twilio.set("SMpep", { status: "delivered", errorCode: null, errorMessage: null });

    const entregas = await mod.entregasDeEnlaces(deps());

    expect(entregas[PEP].estado).toBe("entregado");
    expect(entregas[ANA].estado).toBe("en_camino");
    // No se apunta como preguntado: la próxima vez se vuelve a intentar.
    expect((await guardado("SMana")).entrega_at).toBeNull();
  });

  it("un estado de Twilio que no se conoce no pisa lo que ya se sabía", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 2 });
    await conexion.query(`UPDATE sea_employee_invites SET entrega = 'en_camino' WHERE mensaje_sid = 'SMana'`);
    twilio.set("SMana", { status: "algo_nuevo", errorCode: null, errorMessage: null });

    expect((await mod.entregasDeEnlaces(deps()))[ANA].estado).toBe("en_camino");
    expect((await guardado("SMana")).entrega).toBe("en_camino");
  });

  it("el código de error solo se guarda si de verdad no llegó", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 2 });
    // Twilio a veces arrastra un código en un mensaje que acaba entregándose.
    twilio.set("SMana", { status: "delivered", errorCode: 30003, errorMessage: "viejo" });

    await mod.entregasDeEnlaces(deps());

    expect(await guardado("SMana")).toMatchObject({ entrega: "entregado", entrega_codigo: null, entrega_detalle: null });
  });
});

describe.runIf(RUN)("GET /api/core/alta/entregas", () => {
  function servidor(quien: { esAdmin: boolean; esSuperadmin: boolean }) {
    const autenticar: RequestHandler = (req, _res, next) => {
      (req as any).authCtx = {
        userId: "9a9a9a9a-0000-4000-a000-000000000009",
        nombre: "Lourdes",
        empresaId: "0e0e0e0e-0000-4000-a000-000000000001",
        ...quien,
      };
      next();
    };
    const app = express();
    app.use("/api/core/alta/entregas", mod.createEntregaSmsRouter({ autenticar, ...deps() }));
    return new Promise<{ url: string; cerrar: () => void }>((ok) => {
      const s = app.listen(0, () =>
        ok({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}/api/core/alta/entregas`, cerrar: () => s.close() })
      );
    });
  }

  beforeEach(async () => {
    await conexion.query(`DELETE FROM sea_employee_invites`);
    twilio.clear();
    preguntados = [];
  });

  it("quien no es administrador no lo ve, y a Twilio ni se le pregunta", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 2 });
    const { url, cerrar } = await servidor({ esAdmin: false, esSuperadmin: false });
    try {
      const r = await fetch(url);
      expect(r.status).toBe(403);
      expect(preguntados).toEqual([]);
    } finally {
      cerrar();
    }
  });

  it("a un administrador le da la entrega de cada enlace vivo", async () => {
    await enlace({ de: ANA, sid: "SMana", enviadoHaceMin: 2 });
    twilio.set("SMana", { status: "undelivered", errorCode: 30007, errorMessage: "Message filtered" });
    const { url, cerrar } = await servidor({ esAdmin: true, esSuperadmin: false });
    try {
      const r = await fetch(url);
      expect(r.status).toBe(200);
      const d = await r.json();
      expect(d.disponible).toBe(true);
      expect(d.entregas[ANA].estado).toBe("no_entregado");
      expect(d.entregas[ANA].motivo).toContain("filtrado");
    } finally {
      cerrar();
    }
  });
});
