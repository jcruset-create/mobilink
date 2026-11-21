import { describe, it, expect, vi, beforeEach } from "vitest";

/*
 * Se simula la capa de IA, no la decisión. Lo que se prueba aquí es el
 * recorrido entero con la consulta del encargo —CEAT en 295/80R22.5— y, sobre
 * todo, qué pasa cuando el modelo contesta mal: sin citar nada, con otra
 * marca, con otra medida o sin fuentes. Son los cuatro casos por los que una
 * ficha inventada acabaría en el catálogo.
 */
vi.mock("../../core/openaiService.ts", () => ({
  hayIA: vi.fn(() => true),
  pedirIA: vi.fn(),
}));

const { hayIA, pedirIA } = await import("../../core/openaiService.ts");
const { buscarModelos } = await import("./busqueda.ts");
const { interpretarConsulta, clasificarTodos, creables } = await import(
  "../../../src/modules/tyrecontrol/services/catalogoIA.ts"
);

const CONSULTA = interpretarConsulta("Busca modelos de neumáticos CEAT en 295/80R22.5");

/** Una URL como las de verdad: sin espacios, que es lo que exige el filtro. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

const ficha = (modelo: string, over: Record<string, unknown> = {}) => ({
  fabricante: "CEAT", modelo, medida: "295/80R22.5",
  indiceCargaSimple: "152", indiceCargaDoble: "148", codigoVelocidad: "M",
  ply: null, tipoVehiculo: "camión", posicion: "traccion", utilizacion: "carretera",
  ms: true, tresPmsf: true, eficienciaEnergetica: "C", adherenciaMojado: "B", ruidoDb: 73,
  ean: null, imagenUrl: null, fichaUrl: `https://www.ceat.com/${slug(modelo)}`,
  fuentes: [{ url: `https://www.ceat.com/${slug(modelo)}`, titulo: `CEAT ${modelo}` }],
  ...over,
});

const respuesta = (modelos: any[], citas: string[] = ["https://www.ceat.com/truck"]) => ({
  ok: true, texto: "", citas, modelo: "gpt", duracionMs: 10,
  datos: { modelos, sin_resultados_fiables: false },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hayIA).mockReturnValue(true);
});

describe("buscarModelos", () => {
  it("la consulta del encargo devuelve los modelos con sus fuentes", async () => {
    vi.mocked(pedirIA).mockResolvedValue(respuesta([
      ficha("WINMILE X3-R"), ficha("WINSUPER X3-D"), ficha("WINLOAD X5-D"),
    ]) as any);

    const r = await buscarModelos(CONSULTA);

    expect(r.ok).toBe(true);
    expect(r.candidatos).toHaveLength(3);
    expect(r.aviso).toBe("");
    // Se le pidió la herramienta de búsqueda: sin eso contestaría de memoria.
    const peticion = vi.mocked(pedirIA).mock.calls[0][0] as any;
    expect(peticion.herramientas).toEqual([{ type: "web_search" }]);
    expect(peticion.prompt).toContain("CEAT");
    expect(peticion.prompt).toContain("295/80R22.5");
  });

  it("SIN CITAS no se ofrece nada: contestó de memoria", async () => {
    // Éste es el caso peligroso. El modelo devuelve siete fichas perfectas y
    // ni una página consultada: son recuerdos, no resultados.
    vi.mocked(pedirIA).mockResolvedValue(respuesta([ficha("WINMILE X3-R")], []) as any);

    const r = await buscarModelos(CONSULTA);

    expect(r.ok).toBe(false);
    expect(r.candidatos).toEqual([]);
    expect(r.aviso).toContain("sin consultar ninguna página");
  });

  it("sin clave de OpenAI lo dice, y dice qué hacer mientras tanto", async () => {
    vi.mocked(hayIA).mockReturnValue(false);
    const r = await buscarModelos(CONSULTA);
    expect(r.ok).toBe(false);
    expect(r.aviso).toContain("OPENAI_API_KEY");
    expect(r.aviso).toContain("a mano");
    expect(pedirIA).not.toHaveBeenCalled();
  });

  it("sin marca o sin medida no se gasta una llamada", async () => {
    const r = await buscarModelos(interpretarConsulta("busca neumáticos"));
    expect(r.ok).toBe(false);
    expect(r.aviso).toContain("marca y la medida");
    expect(pedirIA).not.toHaveBeenCalled();
  });

  it("un fallo del proveedor se cuenta como fallo, no como «no hay resultados»", async () => {
    vi.mocked(pedirIA).mockResolvedValue({ ok: false, texto: "", modelo: "gpt", duracionMs: 1, error: "429 rate limit" } as any);
    const r = await buscarModelos(CONSULTA);
    expect(r.aviso).toContain("No se ha podido buscar");
    expect(r.aviso).toContain("429");
  });

  it("que no haya resultados es una respuesta correcta", async () => {
    vi.mocked(pedirIA).mockResolvedValue({
      ok: true, texto: "", citas: ["https://www.ceat.com/truck"], modelo: "gpt", duracionMs: 1,
      datos: { modelos: [], sin_resultados_fiables: true },
    } as any);
    const r = await buscarModelos(CONSULTA);
    expect(r.ok).toBe(true);
    expect(r.candidatos).toEqual([]);
    expect(r.aviso).toContain("No se han encontrado modelos de CEAT en 295/80R22.5");
  });
});

describe("el recorrido entero: CEAT 295/80R22.5", () => {
  it("separa lo que se puede crear de lo que no, y no cuela nada", async () => {
    vi.mocked(pedirIA).mockResolvedValue(respuesta([
      ficha("WINMILE X3-R"),                                  // nuevo y verificado
      ficha("WINSUPER X3-D"),                                 // ya en el catálogo
      ficha("WINLOAD X5-D", { fuentes: [] }),                 // sin fuente
      ficha("WINMILE X3-AW", { medida: "315/80R22.5" }),      // otra medida
      ficha("R-Drive 002", { fabricante: "Bridgestone" }),    // otra marca
      ficha("WINLOAD X3-D", { indiceCargaSimple: null }),     // falta carga
    ]) as any);

    const r = await buscarModelos(CONSULTA);
    const clasificados = clasificarTodos(r.candidatos, CONSULTA, [
      { id: "r1", marca: "CEAT", modelo: "WINSUPER X3-D", medida: "295/80R22.5" },
    ]);

    const porModelo = Object.fromEntries(clasificados.map((c) => [c.modelo, c.estado]));
    expect(porModelo["WINMILE X3-R"]).toBe("nuevo");
    expect(porModelo["WINSUPER X3-D"]).toBe("existente");
    expect(porModelo["WINLOAD X5-D"]).toBe("no_verificado");
    expect(porModelo["WINMILE X3-AW"]).toBe("no_verificado");
    expect(porModelo["R-Drive 002"]).toBe("no_verificado");
    expect(porModelo["WINLOAD X3-D"]).toBe("revisar");

    // De seis candidatos, uno solo se marca solo para crear.
    expect(creables(clasificados).map((c) => c.modelo)).toEqual(["WINMILE X3-R"]);
  });
});
