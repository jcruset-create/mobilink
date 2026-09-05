/**
 * El callback de Twilio: la firma manda.
 *
 * Sin base de datos. Lo que se prueba aquí es la puerta —que un callback sin
 * firma válida no pasa, que uno firmado sí, y que cuando la firma falla ni se
 * mira el cuerpo—, así que el efecto se sustituye por un espía.
 *
 * Se levanta un servidor de verdad en un puerto libre, como en la miniweb
 * pública: la firma se calcula sobre la URL exacta, y con un `req` inventado no
 * se estaría probando lo mismo.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "http";

const aplicados: { sid: string; estadoTwilio: string; errorCode: string | null }[] = [];

vi.mock("./envio.ts", () => ({
  aplicarEstadoProveedor: async (p: {
    sid: string; estadoTwilio: string; errorCode?: string | null;
  }) => {
    aplicados.push({ sid: p.sid, estadoTwilio: p.estadoTwilio, errorCode: p.errorCode ?? null });
    return { aplicado: true };
  },
}));

const TOKEN = "token-de-pruebas-1234567890";
const ENTORNO = { ...process.env };

let servidor: Server;
let base = "";
let twilio: { getExpectedTwilioSignature: (t: string, u: string, p: Record<string, string>) => string };
let RUTA = "";

beforeAll(async () => {
  const express = (await import("express")).default;
  twilio = (await import("twilio")).default;
  const { createSatisfactionCallbackRouter } = await import("./routerCallback.ts");
  ({ RUTA_CALLBACK: RUTA } = await import("./urlPublica.ts"));

  const app = express();
  app.use(RUTA, createSatisfactionCallbackRouter());
  await new Promise<void>((listo) => {
    servidor = app.listen(0, () => {
      const dir = servidor.address();
      base = `http://127.0.0.1:${typeof dir === "object" && dir ? dir.port : 0}`;
      listo();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((listo) => servidor.close(() => listo()));
});

beforeEach(() => {
  aplicados.length = 0;
  process.env.TWILIO_AUTH_TOKEN = TOKEN;
  // La firma se calcula sobre la URL EXACTA, así que la base configurada tiene
  // que ser la del servidor de pruebas.
  process.env.PUBLIC_APP_URL = base;
});
afterEach(() => { process.env = { ...ENTORNO }; });

async function llamar(cuerpo: Record<string, string>, o: { firmar: boolean }) {
  const url = `${base}${RUTA}`;
  const firma = o.firmar
    ? twilio.getExpectedTwilioSignature(TOKEN, url, cuerpo)
    : "firma-inventada";
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": firma,
    },
    body: new URLSearchParams(cuerpo).toString(),
  });
}

describe("firma del callback", () => {
  it("con firma válida se aplica el estado", async () => {
    const r = await llamar({ MessageSid: "SMbueno", MessageStatus: "delivered" }, { firmar: true });
    expect(r.status).toBe(200);
    expect(aplicados).toEqual([
      { sid: "SMbueno", estadoTwilio: "delivered", errorCode: null },
    ]);
  });

  it("con firma inválida se rechaza y NO se toca nada", async () => {
    const r = await llamar({ MessageSid: "SMcolado", MessageStatus: "delivered" }, { firmar: false });
    expect(r.status).toBe(403);
    expect(aplicados).toEqual([]);
  });

  it("sin token configurado no pasa nadie", async () => {
    delete process.env.TWILIO_AUTH_TOKEN;
    const r = await llamar({ MessageSid: "SMx", MessageStatus: "sent" }, { firmar: true });
    expect(r.status).toBe(403);
    expect(aplicados).toEqual([]);
  });

  it("un cuerpo manipulado invalida la firma", async () => {
    const url = `${base}${RUTA}`;
    const firma = twilio.getExpectedTwilioSignature(
      TOKEN, url, { MessageSid: "SMuno", MessageStatus: "sent" });
    // Se firma una cosa y se manda otra: es el ataque evidente.
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": firma,
      },
      body: new URLSearchParams({ MessageSid: "SMuno", MessageStatus: "delivered" }).toString(),
    });
    expect(r.status).toBe(403);
    expect(aplicados).toEqual([]);
  });
});

describe("cuerpo del callback", () => {
  it("sin SID no hace nada, pero responde 200", async () => {
    // 200 a propósito: un 4xx haría que Twilio reintentara un callback que
    // nunca se va a aplicar.
    const r = await llamar({ MessageStatus: "delivered" }, { firmar: true });
    expect(r.status).toBe(200);
    expect(aplicados).toEqual([]);
  });

  it("lleva el código de error cuando viene", async () => {
    await llamar(
      { MessageSid: "SMmal", MessageStatus: "failed", ErrorCode: "63024" }, { firmar: true });
    expect(aplicados[0]).toEqual({
      sid: "SMmal", estadoTwilio: "failed", errorCode: "63024",
    });
  });

  it("repetirlo llega dos veces: el router no filtra, filtra la base", async () => {
    await llamar({ MessageSid: "SMrep", MessageStatus: "delivered" }, { firmar: true });
    await llamar({ MessageSid: "SMrep", MessageStatus: "delivered" }, { firmar: true });
    expect(aplicados).toHaveLength(2);
  });
});
