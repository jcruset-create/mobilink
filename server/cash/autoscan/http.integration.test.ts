/**
 * AutoScan por HTTP: exactamente lo que va a hablar el agente.
 *
 * Existe por un fallo concreto. La suite de dominio —27 casos, todos verdes—
 * llama a `devices.ts`, `inbox.ts` y `promote.ts` directamente, así que nunca
 * pasó por Express. Y por Express las tres rutas de máquina estaban debajo del
 * `r.use(authenticate, …)` del router de personas, que corta con 401 en cuanto
 * no hay un Bearer de Supabase. Un escáner no tiene sesión: **ninguna de las
 * tres funcionaba en producción** mientras el dominio salía impecable.
 *
 * De ahí la regla de este fichero: se monta con **`mountCash` de verdad**, en
 * el mismo orden que el servidor. Montar aquí solo el router de máquina daría
 * una suite verde que no prueba lo único que hay que probar — que el de
 * máquina va delante y no se lo come el otro.
 *
 * Lo que se comprueba, en una frase cada uno:
 *
 *   · activar NO pide sesión de persona, y subir NO pide sesión de persona;
 *   · pero las rutas de personas SIGUEN pidiéndola (no se ha abierto un boquete);
 *   · una credencial mala da 401 de AutoScan, no «falta el token de sesión»;
 *   · sin licencia no entra nada, que es lo que dejó de mirar `requireModule`;
 *   · y la idempotencia funciona por cabecera y por campo del multipart.
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.RUN_DB_TESTS === "1" && !!process.env.DATABASE_URL;

process.env.CASH_STORAGE_LOCAL = "1";

let base = "";
let servidor: Server;
let db: typeof import("../../db.ts").default;
let devices: typeof import("./devices.ts");

const EMPRESA = "00000000-0000-4000-a000-0000000a5d01";
const CENTRO = "00000000-0000-4000-a000-0000000cd001";
const USUARIO = "00000000-0000-4000-a000-0000000a5d99";

/** Empresas cuya licencia decimos que está al día. Se cambia por prueba. */
let conLicencia = new Set<string>([EMPRESA]);

const sufijo = String(process.hrtime.bigint()).slice(-9);

/** Un PDF de verdad: los magic bytes se comprueban al recibir. */
const pdf = (texto: string) =>
  Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(texto), Buffer.from("\n%%EOF\n")]);

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Sube un documento como lo haría el agente: multipart y su cabecera. */
async function subir(
  secret: string | null,
  contenido: Buffer,
  opciones: { idempotencyKey?: string; enElCuerpo?: boolean; nombre?: string } = {}
): Promise<{ status: number; body: any }> {
  const form = new FormData();
  const clave = opciones.idempotencyKey;

  /*
   * El orden importa de verdad: multer solo deja en `req.body` los campos que
   * llegan ANTES del fichero. Un agente que mande la clave después se
   * encontraría con que la idempotencia no funciona y no sabría por qué, así
   * que aquí se prueban las dos formas.
   */
  if (clave && opciones.enElCuerpo) form.append("idempotencyKey", clave);
  form.append(
    "documento",
    new Blob([new Uint8Array(contenido)], { type: "application/pdf" }),
    opciones.nombre ?? "factura.pdf"
  );

  const res = await fetch(`${base}/autoscan/documents`, {
    method: "POST",
    headers: {
      ...(secret ? { "x-autoscan-key": secret } : {}),
      ...(clave && !opciones.enElCuerpo ? { "idempotency-key": clave } : {}),
    },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function json(ruta: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${base}${ruta}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Da de alta un escáner por la vía real: código y canje. */
async function nuevoEscaner(nombre = `PC-${sufijo}-${Math.random().toString(36).slice(2, 6)}`) {
  const { codigo } = await devices.crearCodigoActivacion({
    empresaId: EMPRESA,
    centroId: CENTRO,
    nombre,
    creadoPor: USUARIO,
  });
  const r = await json("/autoscan/activate", { method: "POST", body: { codigo, version: "1.0.0" } });
  return { codigo, ...r };
}

describe.skipIf(!RUN)("AutoScan por HTTP", () => {
  beforeAll(async () => {
    const { initDb } = await import("../../db.ts");
    db = (await import("../../db.ts")).default;
    await initDb();
    await (await import("../schema.ts")).initCash();
    devices = await import("./devices.ts");

    const app = express();
    app.use(express.json());

    /*
     * El montaje DE VERDAD, no uno de mentira que ponga los routers en el
     * orden que le conviene a la prueba. Si alguien vuelve a meter las rutas
     * de máquina debajo de `authenticate`, esto se pone rojo.
     */
    const cash = await import("../index.ts");
    cash.mountCash(app);
    // El worker analiza con la IA de verdad: fuera. Aquí se prueba la puerta.
    cash.pararWorkerAutoScan();
    // Y la licencia la contesta la prueba: la función del SaaS no está en esta base.
    devices.registrarComprobadorDeLicencia(async (empresaId) => conLicencia.has(empresaId));

    await new Promise<void>((resolve) => {
      servidor = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/cash`;
  }, 180_000);

  afterAll(async () => {
    await new Promise<void>((r) => servidor?.close(() => r()));
    await db.query(`DELETE FROM cash_autoscan_inbox WHERE empresa_id = $1`, [EMPRESA]);
    await db.query(`DELETE FROM cash_autoscan_activation_codes WHERE empresa_id = $1`, [EMPRESA]);
    await db.query(`DELETE FROM cash_autoscan_devices WHERE empresa_id = $1`, [EMPRESA]);
  });

  describe("la puerta de máquina no pide sesión de persona", () => {
    it("activar funciona SIN Authorization", async () => {
      const r = await nuevoEscaner();
      /*
       * Éste es el caso que estaba roto. Antes daba 401 «Falta el token de
       * sesión» y el agente no podía dar el primer paso.
       */
      expect(r.status).toBe(201);
      expect(r.body.secret).toBeTruthy();
      expect(r.body.empresaId).toBe(EMPRESA);
      expect(r.body.centroId).toBe(CENTRO);
    });

    it("subir funciona SIN Authorization, solo con la credencial del escáner", async () => {
      const { body: d } = await nuevoEscaner();
      const r = await subir(d.secret, pdf(`sin-sesion-${sufijo}`), {
        idempotencyKey: `sin-sesion-${sufijo}`,
      });
      expect(r.status).toBe(202);
      expect(r.body.duplicado).toBe(false);
    });

    it("el latido tampoco, y deja la versión que dice el agente", async () => {
      const { body: d } = await nuevoEscaner();
      const res = await fetch(`${base}/autoscan/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-autoscan-key": d.secret },
        body: JSON.stringify({ version: "9.9.9" }),
      });
      expect(res.status).toBe(200);
      const { rows } = await db.query(
        `SELECT version FROM cash_autoscan_devices WHERE id = $1`,
        [d.deviceId]
      );
      expect(rows[0].version).toBe("9.9.9");
    });
  });

  describe("y sin embargo no se ha abierto ningún boquete", () => {
    it("la bandeja de las personas SIGUE pidiendo sesión", async () => {
      const r = await json("/autoscan/inbox");
      expect(r.status).toBe(401);
      // El 401 de personas, no el de AutoScan: la ruta no ha cambiado de router.
      expect(r.body.error).toMatch(/token de sesión/i);
    });

    it("una credencial de escáner NO abre las rutas de personas", async () => {
      const { body: d } = await nuevoEscaner();
      const r = await json("/autoscan/inbox", { headers: { "x-autoscan-key": d.secret } });
      expect(r.status).toBe(401);
    });

    it("el resto de la API de caja sigue igual de cerrada", async () => {
      const r = await json("/bootstrap");
      expect(r.status).toBe(401);
    });
  });

  describe("credenciales", () => {
    it("sin credencial: 401 de AutoScan, no el de sesión", async () => {
      const r = await subir(null, pdf(`sin-credencial-${sufijo}`));
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("AUTOSCAN_NO_AUTORIZADO");
    });

    it("una credencial inventada dice lo mismo que una revocada", async () => {
      const inventada = await subir("no-existe-esta-clave", pdf(`inventada-${sufijo}`));
      const { body: d } = await nuevoEscaner();
      await devices.revocarDispositivo(EMPRESA, d.deviceId, USUARIO);
      const revocada = await subir(d.secret, pdf(`revocada-${sufijo}`));

      expect(inventada.status).toBe(401);
      expect(revocada.status).toBe(401);
      // Misma respuesta: quien prueba claves no puede distinguir los dos casos.
      expect(revocada.body).toEqual(inventada.body);
    });

    it("un código de activación no vale dos veces por HTTP", async () => {
      const { codigo } = await nuevoEscaner();
      const otra = await json("/autoscan/activate", { method: "POST", body: { codigo } });
      expect(otra.status).toBe(401);
      expect(otra.body.code).toBe("CODIGO_NO_VALIDO");
    });
  });

  describe("licencia", () => {
    it("sin licencia no entra ningún documento, aunque la credencial sea buena", async () => {
      const { body: d } = await nuevoEscaner();
      conLicencia = new Set();
      try {
        const r = await subir(d.secret, pdf(`sin-licencia-${sufijo}`));
        /*
         * 403 y no 401: la credencial vale, lo que no vale es la licencia. Si
         * dijéramos 401, un agente bien hecho borraría su credencial y habría
         * que reinstalarlo por una factura sin pagar.
         */
        expect(r.status).toBe(403);
        expect(r.body.code).toBe("LICENCIA_CADUCADA");
      } finally {
        conLicencia = new Set([EMPRESA]);
      }

      const { rows } = await db.query(
        `SELECT COUNT(*)::int AS n FROM cash_autoscan_inbox WHERE empresa_id = $1 AND device_id = $2`,
        [EMPRESA, d.deviceId]
      );
      expect(rows[0].n).toBe(0);
    });

    it("sin licencia tampoco se puede activar un escáner nuevo", async () => {
      conLicencia = new Set();
      try {
        const r = await nuevoEscaner();
        expect(r.status).toBe(403);
        expect(r.body.code).toBe("LICENCIA_CADUCADA");
      } finally {
        conLicencia = new Set([EMPRESA]);
      }
    });
  });

  describe("lo que el agente necesita saber para reintentar", () => {
    it("el mismo papel dos veces: 202 y luego 200, y una sola fila", async () => {
      const { body: d } = await nuevoEscaner();
      const contenido = pdf(`mismo-papel-${sufijo}`);

      /*
       * Claves DISTINTAS a propósito: si fueran la misma, la segunda respuesta
       * vendría por idempotencia y no probaría la deduplicación por contenido,
       * que es lo que se quiere ver aquí. Son dos preguntas distintas.
       */
      const primera = await subir(d.secret, contenido, { idempotencyKey: `dedup-1-${sufijo}` });
      const segunda = await subir(d.secret, contenido, { idempotencyKey: `dedup-2-${sufijo}` });

      expect(primera.status).toBe(202);
      expect(primera.body.duplicado).toBe(false);
      expect(segunda.status).toBe(200);
      expect(segunda.body.duplicado).toBe(true);
      // Y es LA MISMA fila, no una segunda marcada como duplicada.
      expect(segunda.body.documentoId).toBe(primera.body.documentoId);
    });

    it("reintentar con la misma Idempotency-Key devuelve el mismo documento", async () => {
      const { body: d } = await nuevoEscaner();
      const clave = `idem-cab-${sufijo}`;

      const a = await subir(d.secret, pdf(`idem-a-${sufijo}`), { idempotencyKey: clave });
      /*
       * Contenido DISTINTO a propósito: si respondiera lo mismo por ser el
       * mismo papel no probaría nada. Lo que se comprueba es que manda la
       * clave, que es lo que usa el agente cuando no sabe si la primera llegó.
       */
      const b = await subir(d.secret, pdf(`idem-b-${sufijo}`), { idempotencyKey: clave });

      expect(a.status).toBe(202);
      expect(b.body.documentoId).toBe(a.body.documentoId);
    });

    it("la clave vale igual como campo del multipart, si va antes del fichero", async () => {
      const { body: d } = await nuevoEscaner();
      const clave = `idem-campo-${sufijo}`;

      const a = await subir(d.secret, pdf(`campo-a-${sufijo}`), {
        idempotencyKey: clave,
        enElCuerpo: true,
      });
      const b = await subir(d.secret, pdf(`campo-b-${sufijo}`), {
        idempotencyKey: clave,
        enElCuerpo: true,
      });

      expect(a.status).toBe(202);
      expect(b.body.documentoId).toBe(a.body.documentoId);
    });

    it("un ejecutable renombrado a .pdf se rechaza con un motivo, no con un 500", async () => {
      const { body: d } = await nuevoEscaner();
      const r = await subir(d.secret, Buffer.from("MZ\x90\x00 no soy un pdf"), {
        nombre: "factura.pdf",
      });
      expect(r.status).toBe(400);
      expect(r.body.error).toBeTruthy();
    });

    it("un fichero enorme dice que es enorme, y no revienta por dentro", async () => {
      const { body: d } = await nuevoEscaner();
      const gordo = Buffer.concat([pdf("grande"), Buffer.alloc(16 * 1024 * 1024, 0x41)]);
      const r = await subir(d.secret, gordo);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("FICHERO_DEMASIADO_GRANDE");
    });

    it("sin Idempotency-Key no se acepta el documento: es obligatoria", async () => {
      const { body: d } = await nuevoEscaner();
      const r = await subir(d.secret, pdf(`sin-clave-${sufijo}`));
      /*
       * Requisito del contrato, no un descuido. Sin clave no hay forma de
       * distinguir «el agente reintenta lo mismo» de «ha llegado otro papel»,
       * y el índice único que sostiene la idempotencia se queda sin su
       * segunda columna. El agente tiene que generarla y conservarla mientras
       * dure el reintento.
       */
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/idempotencia/i);
    });

    it("sin fichero, un 400 que lo dice", async () => {
      const { body: d } = await nuevoEscaner();
      const res = await fetch(`${base}/autoscan/documents`, {
        method: "POST",
        headers: { "x-autoscan-key": d.secret },
        body: new FormData(),
      });
      expect(res.status).toBe(400);
    });
  });
});
