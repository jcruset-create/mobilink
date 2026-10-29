/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * La capa de IA con el contador puesto: que no se rompa nada de lo que ya
 * funcionaba y que el consumo quede bien apuntado.
 *
 * Se usa un DOBLE del proveedor. Aquí no se llama a OpenAI.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Doble del proveedor ─────────────────────────────────────────────────────
const crear = vi.fn();
vi.mock("openai", () => ({
  default: class {
    responses = { create: (...a: any[]) => crear(...a) };
    audio = { transcriptions: { create: vi.fn() } };
  },
}));

// ── Doble del contador ──────────────────────────────────────────────────────
const reservar = vi.fn();
const cerrar = vi.fn();
const registrarSinClave = vi.fn();
vi.mock("./iaConsumo.ts", async () => {
  const real: any = await vi.importActual("./iaConsumo.ts");
  return {
    moduloDe: real.moduloDe,
    reservar: (...a: any[]) => reservar(...a),
    cerrar: (...a: any[]) => cerrar(...a),
    registrarSinClave: (...a: any[]) => registrarSinClave(...a),
  };
});

const { pedirIA } = await import("./openaiService.ts");

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const respuestaOk = (texto: string, id = "resp_1") => ({
  id, output: [{ type: "message", content: [{ type: "output_text", text: texto }] }],
  usage: { input_tokens: 120, output_tokens: 40 },
});

class ErrorProveedor extends Error {
  constructor(public status: number) { super("algo ha fallado en el proveedor"); }
}

beforeEach(() => {
  crear.mockReset();
  reservar.mockReset().mockResolvedValue({ permitido: true, usoId: "uso-1" });
  cerrar.mockReset().mockResolvedValue(undefined);
  registrarSinClave.mockReset().mockResolvedValue(undefined);
  process.env.OPENAI_API_KEY = "sk-de-prueba";
  delete process.env.OPENAI_FALLBACK_MODEL;
});

describe("sin regresión para los llamantes que ya existían", () => {
  it("una llamada sin empresa funciona igual y se apunta sin empresa", async () => {
    crear.mockResolvedValue(respuestaOk("1234 ABC"));
    const r = await pedirIA({ prompt: "lee la matrícula", operacion: "assist.detectPlate" });
    expect(r).toMatchObject({ ok: true, texto: "1234 ABC", tokensEntrada: 120, tokensSalida: 40 });
    expect(reservar).toHaveBeenCalledWith(expect.objectContaining({
      empresaId: null, modulo: "assist", operacion: "assist.detectPlate",
    }));
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it("el esquema estricto sigue llegando al proveedor y el JSON se devuelve ya parseado", async () => {
    crear.mockResolvedValue(respuestaOk('{"marca":"Michelin"}'));
    const r = await pedirIA<{ marca: string }>({
      prompt: "lee el flanco", operacion: "tyre.flanco",
      esquema: { nombre: "flanco", schema: { type: "object" } },
    });
    expect(r.datos).toEqual({ marca: "Michelin" });
    const cuerpo = crear.mock.calls[0][0];
    expect(cuerpo.text.format).toMatchObject({ type: "json_schema", name: "flanco", strict: true });
  });

  it("si el JSON no es válido, sigue siendo ok:false y se apunta como tal", async () => {
    crear.mockResolvedValue(respuestaOk("esto no es json"));
    const r = await pedirIA({
      prompt: "x", operacion: "tyre.flanco", esquema: { nombre: "f", schema: {} },
    });
    expect(r.ok).toBe(false);
    expect(cerrar).toHaveBeenCalledWith("uso-1", expect.objectContaining({ errorCodigo: "json_invalido" }));
  });
});

describe("qué se apunta", () => {
  it("una petición con tres intentos es UNA petición con intentos = 3", async () => {
    crear
      .mockRejectedValueOnce(new ErrorProveedor(503))
      .mockRejectedValueOnce(new ErrorProveedor(503))
      .mockResolvedValueOnce(respuestaOk("vale", "resp_9"));
    const r = await pedirIA({ prompt: "x", operacion: "resumen.vehiculo", empresaId: EMPRESA });
    expect(r.ok).toBe(true);
    expect(cerrar).toHaveBeenCalledTimes(1);
    expect(cerrar).toHaveBeenCalledWith("uso-1", expect.objectContaining({
      resultado: "ok", intentos: 3, usoRespaldo: false, peticionId: "resp_9",
      tokensEntrada: 120, tokensSalida: 40,
    }));
  });

  it("si contesta el modelo de respaldo, se apunta cuál contestó", async () => {
    process.env.OPENAI_FALLBACK_MODEL = "modelo-respaldo";
    crear.mockRejectedValue(new ErrorProveedor(500));
    crear.mockRejectedValueOnce(new ErrorProveedor(500))
      .mockRejectedValueOnce(new ErrorProveedor(500))
      .mockRejectedValueOnce(new ErrorProveedor(500))
      .mockResolvedValueOnce(respuestaOk("del respaldo"));
    const r = await pedirIA({ prompt: "x", operacion: "resumen.vehiculo", empresaId: EMPRESA });
    expect(r).toMatchObject({ ok: true, modelo: "modelo-respaldo" });
    expect(cerrar).toHaveBeenCalledWith("uso-1", expect.objectContaining({
      usoRespaldo: true, modeloServido: "modelo-respaldo", intentos: 4,
    }));
  });

  it("del fallo total se guarda un código, nunca el mensaje del proveedor", async () => {
    crear.mockRejectedValue(new ErrorProveedor(500));
    const r = await pedirIA({ prompt: "x", operacion: "resumen.vehiculo", empresaId: EMPRESA });
    expect(r.ok).toBe(false);
    const cierre = cerrar.mock.calls[0][1];
    expect(cierre).toMatchObject({ resultado: "error", errorCodigo: "proveedor" });
    expect(JSON.stringify(cierre)).not.toContain("algo ha fallado");
  });
});

describe("cuando no se puede llamar", () => {
  it("sin clave no se llama al proveedor y queda apuntado", async () => {
    delete process.env.OPENAI_API_KEY;
    const r = await pedirIA({ prompt: "x", operacion: "resumen.vehiculo", empresaId: EMPRESA });
    expect(r).toMatchObject({ ok: false, error: "OPENAI_API_KEY no configurada" });
    expect(crear).not.toHaveBeenCalled();
    expect(registrarSinClave).toHaveBeenCalledTimes(1);
    expect(reservar).not.toHaveBeenCalled();
  });

  it("con la cuota agotada NO se llama al proveedor", async () => {
    reservar.mockResolvedValue({ permitido: false, usoId: null, motivo: "tope_peticiones" });
    const r = await pedirIA({ prompt: "x", operacion: "resumen.vehiculo", empresaId: EMPRESA });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("límite diario");
    expect(crear).not.toHaveBeenCalled();
    expect(cerrar).not.toHaveBeenCalled();   // la fila la cerró ya la reserva
  });

  it("con la IA desactivada para la empresa, tampoco", async () => {
    reservar.mockResolvedValue({ permitido: false, usoId: null, motivo: "ia_desactivada" });
    const r = await pedirIA({ prompt: "x", operacion: "resumen.vehiculo", empresaId: EMPRESA });
    expect(r.error).toContain("desactivada");
    expect(crear).not.toHaveBeenCalled();
  });

  it("si el contador no contesta, la llamada sale igual y no se apunta", async () => {
    reservar.mockResolvedValue({ permitido: true, usoId: null });
    crear.mockResolvedValue(respuestaOk("sale igual"));
    const r = await pedirIA({ prompt: "x", operacion: "tyre.flanco" });
    expect(r.ok).toBe(true);
    expect(cerrar).toHaveBeenCalledWith(null, expect.anything());
  });

  it("un timeout del proveedor acaba en ok:false, no en excepción", async () => {
    const t = new Error("Request timed out");
    (t as any).name = "AbortError";
    crear.mockRejectedValue(t);
    const r = await pedirIA({ prompt: "x", operacion: "resumen.vehiculo", empresaId: EMPRESA, timeoutMs: 10 });
    expect(r.ok).toBe(false);
    expect(crear.mock.calls[0][1]).toMatchObject({ timeout: 10 });
  });

  it("un error de petición (400) no se reintenta: repetirlo no lo arregla", async () => {
    crear.mockRejectedValue(new ErrorProveedor(400));
    const r = await pedirIA({ prompt: "x", operacion: "resumen.vehiculo", empresaId: EMPRESA });
    expect(r.ok).toBe(false);
    expect(crear).toHaveBeenCalledTimes(1);
  });
});
