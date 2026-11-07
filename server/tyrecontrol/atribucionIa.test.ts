/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Atribución del gasto de IA por empresa.
 *
 * Enganchar el contador en la capa central NO basta: si el llamante no pasa
 * la empresa, el gasto se apunta sin dueño y el tope por cliente no aplica.
 * Esto comprueba que los cinco lectores la transmiten hasta `pedirIA`.
 *
 * (El asistente no pasa por `pedirIA` —da varias vueltas con herramientas— y
 * se comprueba aparte, en asistenteConsumo.test.ts.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const pedirIA = vi.fn();
vi.mock("../core/openaiService.ts", () => ({
  pedirIA: (...a: any[]) => pedirIA(...a),
  hayIA: () => true,
  MODELOS: { porDefecto: "m", documento: "m", informe: "m", asistente: "m", respaldo: "" },
  getClienteIA: () => ({}),
}));

const { LectorFlancoIA } = await import("./flanco/lectorFlanco.ts");
const { LectorSerieIA } = await import("./etiquetas/lectorEtiqueta.ts");
const { OpenAiFichaTecnicaOcr } = await import("./ficha-tecnica/ocrService.ts");
const { LectorParteIA } = await import("./parte/lectorParte.ts");
const { LectorParteIA: LectorParteProveedorIA } = await import("./parteProveedor/lector.ts");

const EMPRESA = "11111111-1111-4111-8111-111111111111";
const FOTO = "data:image/jpeg;base64,AAAA";

beforeEach(() => {
  pedirIA.mockReset();
  pedirIA.mockResolvedValue({ ok: false, texto: "", modelo: "m", duracionMs: 1, error: "doble" });
});

const empresaPedida = () => pedirIA.mock.calls[0][0].empresaId;
const operacionPedida = () => pedirIA.mock.calls[0][0].operacion;

describe("los cinco lectores imputan el gasto a la empresa que se les da", () => {
  it("flanco", async () => {
    await new LectorFlancoIA().leer(FOTO, EMPRESA);
    expect(empresaPedida()).toBe(EMPRESA);
    expect(operacionPedida()).toBe("tyrecontrol.flanco.leer");
  });

  it("etiqueta", async () => {
    await new LectorSerieIA().leer(FOTO, EMPRESA);
    expect(empresaPedida()).toBe(EMPRESA);
    expect(operacionPedida()).toBe("tyrecontrol.etiquetas.leer");
  });

  it("ficha técnica", async () => {
    await new OpenAiFichaTecnicaOcr().extraer([FOTO], EMPRESA).catch(() => {});
    expect(empresaPedida()).toBe(EMPRESA);
    expect(operacionPedida()).toBe("tyrecontrol.ficha-tecnica.ocr");
  });

  it("parte guiado", async () => {
    await new LectorParteIA().leer([FOTO], EMPRESA);
    expect(empresaPedida()).toBe(EMPRESA);
    expect(operacionPedida()).toBe("tyrecontrol.parte.leer");
  });

  it("parte de proveedor", async () => {
    await new LectorParteProveedorIA().leer({ dataUri: FOTO, nombre: "p.jpg", empresaId: EMPRESA });
    expect(empresaPedida()).toBe(EMPRESA);
    expect(operacionPedida()).toBe("tyrecontrol.parteProveedor.leer");
  });
});

describe("sin empresa resuelta", () => {
  it("la lectura SALE igual y se apunta sin empresa: una foto no se queda sin leer", async () => {
    await new LectorFlancoIA().leer(FOTO);
    expect(pedirIA).toHaveBeenCalledTimes(1);
    expect(empresaPedida()).toBeNull();
  });

  it("y nunca se inventa una empresa a partir de nada", async () => {
    await new LectorFlancoIA().leer(FOTO, null);
    expect(empresaPedida()).toBeNull();
  });
});

describe("empresaDeSesion", () => {
  it("sin sesión devuelve null en vez de fallar", async () => {
    vi.resetModules();
    vi.doMock("../supabase.ts", () => ({ supabase: {} }));
    const { empresaDeSesion } = await import("./alcance.ts");
    expect(await empresaDeSesion(undefined)).toBeNull();
    expect(await empresaDeSesion(null)).toBeNull();
  });

  it("si la consulta revienta, devuelve null y la llamada sigue sin empresa", async () => {
    vi.resetModules();
    vi.doMock("../supabase.ts", () => ({
      supabase: { from() { throw new Error("base caída"); } },
    }));
    const { empresaDeSesion } = await import("./alcance.ts");
    expect(await empresaDeSesion("usuario-1")).toBeNull();
  });
});
