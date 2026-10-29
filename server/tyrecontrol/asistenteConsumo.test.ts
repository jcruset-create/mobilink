/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * El asistente y el contador.
 *
 * El asistente es el único consumidor que NO pasa por `pedirIA`: necesita
 * varias vueltas con herramientas. Así que el contador se engancha a mano, y
 * esto comprueba que de verdad está enganchado: una pregunta es una petición,
 * los tokens se suman de TODAS las vueltas y el tope de la empresa se respeta
 * antes de gastar.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const EMPRESA = "11111111-1111-4111-8111-111111111111";

const crear = vi.fn();
vi.mock("../core/openaiService.ts", () => ({
  hayIA: () => true,
  MODELOS: { asistente: "modelo-asistente" },
  getClienteIA: () => ({ responses: { create: (...a: any[]) => crear(...a) } }),
}));

const reservar = vi.fn();
const cerrar = vi.fn();
vi.mock("../core/iaConsumo.ts", () => ({
  reservar: (...a: any[]) => reservar(...a),
  cerrar: (...a: any[]) => cerrar(...a),
}));

vi.mock("./alcance.ts", () => ({
  resolverAlcance: async () => ({ empresaId: EMPRESA, nombre: "Plana", esCliente: true }),
}));
// Las herramientas del asistente consultan la base; con el doble devuelven
// agregados vacíos, que es suficiente: aquí se mide el contador, no las cifras.
import { clienteFalso } from "./resumenVehiculo/doblesPrueba.ts";
vi.mock("../supabase.ts", () => ({ get supabase() { return clienteFalso({}); } }));

const { mountAsistente } = await import("./asistente.ts");

let base = "";
let servidor: Server;

const preguntar = async () => {
  const r = await fetch(`${base}/api/tyrecontrol/asistente/preguntar`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pregunta: "¿cómo va la flota?" }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
};

const vuelta = (texto: string, entrada: number, salida: number, id = "resp_1") => ({
  id,
  output: [{ type: "message", content: [{ type: "output_text", text: texto }] }],
  output_text: texto,
  usage: { input_tokens: entrada, output_tokens: salida },
});

const vueltaConHerramienta = (entrada: number, salida: number) => ({
  id: "resp_tool",
  output: [{ type: "function_call", name: "estado_flota", arguments: "{}", call_id: "c1" }],
  usage: { input_tokens: entrada, output_tokens: salida },
});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  mountAsistente(app, (req, _res, next) => { (req as any).authCtx = { userId: "u1" }; next(); });
  await new Promise<void>((listo) => { servidor = app.listen(0, () => listo()); });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
afterAll(() => { servidor?.close(); });

beforeEach(() => {
  crear.mockReset();
  reservar.mockReset().mockResolvedValue({ permitido: true, usoId: "uso-1", contador: "ok" });
  cerrar.mockReset().mockResolvedValue(undefined);
});

describe("atribución", () => {
  it("reserva a nombre de la empresa del alcance, no de la que pida el cliente", async () => {
    crear.mockResolvedValue(vuelta("La flota está bien", 100, 20));
    const r = await preguntar();
    expect(r.status).toBe(200);
    expect(reservar).toHaveBeenCalledWith({
      empresaId: EMPRESA, operacion: "asistente.preguntar", modeloPedido: "modelo-asistente",
    });
  });
});

describe("una pregunta es UNA petición", () => {
  it("con varias vueltas de herramientas se apunta una sola fila, con sus intentos", async () => {
    crear
      .mockResolvedValueOnce(vueltaConHerramienta(100, 10))
      .mockResolvedValueOnce(vuelta("Respuesta final", 300, 40, "resp_final"));
    // La herramienta consulta supabase; con el doble vacío devolverá error y
    // el bucle sigue: lo que importa aquí es cuántas vueltas y cuántos tokens.
    const r = await preguntar();
    expect(r.status).toBe(200);
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(cerrar).toHaveBeenCalledWith("uso-1", expect.objectContaining({
      resultado: "ok",
      intentos: 2,
      // 100+300 y 10+40: se suman TODAS las vueltas, no solo la que redacta.
      tokensEntrada: 400,
      tokensSalida: 50,
      peticionId: "resp_final",
    }));
  });
});

describe("topes", () => {
  it("con la cuota agotada no se llama al proveedor", async () => {
    reservar.mockResolvedValue({ permitido: false, usoId: null, contador: "ok", motivo: "tope_peticiones" });
    const r = await preguntar();
    expect(r.status).toBe(429);
    expect(r.body.error).toContain("límite diario");
    expect(crear).not.toHaveBeenCalled();
  });

  it("con la IA desactivada para la empresa, tampoco", async () => {
    reservar.mockResolvedValue({ permitido: false, usoId: null, contador: "ok", motivo: "ia_desactivada" });
    const r = await preguntar();
    expect(r.status).toBe(403);
    expect(crear).not.toHaveBeenCalled();
  });

  it("si el contador no contesta, el asistente SIGUE funcionando (compatibilidad)", async () => {
    reservar.mockResolvedValue({ permitido: true, usoId: null, contador: "caido" });
    crear.mockResolvedValue(vuelta("Sigo aquí", 10, 5));
    const r = await preguntar();
    expect(r.status).toBe(200);
    expect(crear).toHaveBeenCalled();
    expect(cerrar).toHaveBeenCalledWith(null, expect.anything());
  });
});

describe("errores", () => {
  it("un fallo del proveedor se apunta con código corto, no con el mensaje", async () => {
    crear.mockRejectedValue(new Error("429 Rate limit for org-123"));
    const r = await preguntar();
    expect(r.status).toBe(500);
    expect(cerrar).toHaveBeenCalledWith("uso-1", expect.objectContaining({
      resultado: "error", errorCodigo: "proveedor",
    }));
    expect(JSON.stringify(cerrar.mock.calls[0][1])).not.toContain("org-123");
  });

  it("nunca deja la fila en 'en_curso': se cierra una sola vez y siempre", async () => {
    crear.mockResolvedValue(vuelta("Hecho", 10, 5));
    await preguntar();
    expect(cerrar).toHaveBeenCalledTimes(1);
  });
});
