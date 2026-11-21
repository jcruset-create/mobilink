import { describe, expect, it } from "vitest";
import { diagnosticar, indiceDe, indiceDelModelo, medidaClave, parecido, quitarIndices, type Catalogo, type GomaFlota } from "./depurarCatalogo";

describe("normalizar", () => {
  it("quita los índices pegados al modelo", () => {
    expect(quitarIndices("AH51 154M")).toBe("AH51");
    expect(quitarIndices("ah51 156/150L")).toBe("AH51");
    expect(quitarIndices("RA58 121R120")).toBe("RA58");
    expect(quitarIndices("K135 101W XL")).toBe("K135");
    expect(quitarIndices("RA18 121R10P")).toBe("RA18");
    expect(quitarIndices("X MULTI Z")).toBe("X MULTI Z");
    expect(quitarIndices("SMARTCITY AU04+")).toBe("SMARTCITY AU04+");
    expect(quitarIndices("154M")).toBe("154M"); // un nombre de un solo trozo no se vacía
  });
  it("medida base como tc_medida_base", () => {
    expect(medidaClave("315/80 R22.5")).toBe("315/80R22.5");
    expect(medidaClave("225/75R16CP")).toBe("225/75R16");
    expect(medidaClave("215/75R16C")).toBe("215/75R16");
    expect(medidaClave("12R22,5")).toBe("12R22.5");
  });
  it("índice de carga: el último, sin confundirlo con el modelo", () => {
    expect(indiceDe("Hankook AH51 315/80R22.5 156/150L")).toBe("156");
    expect(indiceDe("Hankook K135 225/45R17 94W")).toBe("94");
    expect(indiceDelModelo("AH51 154M")).toBe("154");
    expect(indiceDelModelo("K135")).toBeNull();
    expect(indiceDe("154/150")).toBe("154");
  });
  it("parecido", () => {
    expect(parecido("XMUILTI", "X MULTI Z")).toBeGreaterThanOrEqual(0.6);
    expect(parecido("VANTRA", "Vantra ST AS2 RA30")).toBeGreaterThanOrEqual(0.8);
    expect(parecido("AH31", "DL51")).toBeLessThan(0.6);
  });
});

const cat = (): Catalogo => ({
  marcas: [
    { id: "hk", nombre: "Hankook", activo: true, alias: [] },
    { id: "mi", nombre: "Michelin", activo: true, alias: [] },
    { id: "in", nombre: "Insa", activo: true, alias: ["INSATRUCK"] },
    { id: "vacia", nombre: "Kormoran", activo: true, alias: [] },
    { id: "un", nombre: "Uniroyal", activo: true, alias: [] },
  ],
  modelos: [
    { id: "ah51", marcaId: "hk", nombre: "AH51", activo: true, alias: [] },
    { id: "ra30", marcaId: "hk", nombre: "RA30", activo: true, alias: ["Vantra ST AS2 RA30"] },
    { id: "xmz", marcaId: "mi", nombre: "X MULTI Z", activo: true, alias: [] },
    { id: "hd", marcaId: "mi", nombre: "X MULTI HD D", activo: true, alias: [] },
    { id: "hdp", marcaId: "mi", nombre: "X MULTI HD D+", activo: true, alias: [] },
    { id: "k25", marcaId: "in", nombre: "K25", activo: true, alias: [] },
    { id: "huerfano", marcaId: "mi", nombre: "XTE3", activo: true, alias: [] },
  ],
  refs: [
    { id: "r-ah51", modeloId: "ah51", medida: "315/80R22.5", referenciaCompleta: "Hankook AH51 315/80R22.5 156/150L", activo: true },
    { id: "r-ra30", modeloId: "ra30", medida: "215/75R16C", referenciaCompleta: "Hankook RA30 215/75R16C 116/114R", activo: true },
    { id: "r-xmz", modeloId: "xmz", medida: "315/80R22.5", referenciaCompleta: "Michelin X MULTI Z 315/80R22.5 156/150L", activo: true },
    { id: "r-hd", modeloId: "hd", medida: "315/80R22.5", referenciaCompleta: "Michelin X MULTI HD D 315/80R22.5", activo: true },
    { id: "r-hdp", modeloId: "hdp", medida: "315/80R22.5", referenciaCompleta: "Michelin X MULTI HD D+ 315/80R22.5", activo: true },
    { id: "r-k25", modeloId: "k25", medida: "385/65R22.5", referenciaCompleta: "Insa K25 385/65R22.5", activo: true },
  ],
  medidas: [
    { id: "m1", valor: "225/75R16", activo: true }, { id: "m2", valor: "225/75R16CP", activo: true },
  ],
  equivalencias: [], distintos: [],
});

const n = (marca: string | null, modelo: string | null, medida: string | null, veces = 1): GomaFlota[] =>
  Array.from({ length: veces }, (_, i) => ({ id: `${marca}${modelo}${medida}${i}`, marca, modelo, medida, indiceCarga: null }));

describe("diagnosticar", () => {
  const gomas = [
    ...n("HANKOOK", "AH51", "315/80R22.5", 3),        // encaja tal cual
    ...n("HANKOOK", "AH51 156L", "315/80R22.5", 5),   // auto: índice pegado (y coincide)
    ...n("HANKOOK", "AH51 154M", "315/80R22.5", 2),   // mismo modelo, índice distinto → parecido
    ...n("MICHELIN", "X-MULTI Z", "315/80 R22.5", 2), // auto: escrito de otra forma
    ...n("MICHELIN", "XMUILTI", "315/80R22.5", 1),    // parecido
    ...n("HANKOOK", "VANTRA", "215/75R16C", 4),       // parecido por alias
    ...n("INSATRUCK", "K25", "315/80R22.5", 2),       // modelo sí, medida no
    ...n("HANKOOK", "AH31", "315/80R22.5", 6),        // no está
    ...n("UNIROYAL", "FH40", "315/80R22.5", 2),       // no está (marca sí)
    ...n("R.CORDOBA", "X", "315/80R22.5", 1),         // marca no está
    ...n(null, "AH31", "315/80R22.5", 1),             // incompleta
  ];
  const d = diagnosticar(cat(), gomas);
  const de = (modelo: string) => d.sinReferencia.find((g) => g.modelo === modelo)!;

  it("cuenta las que encajan", () => {
    expect(d.resumen.gomas).toBe(29);
    expect(d.resumen.encajan).toBe(3);
    expect(d.resumen.incompletas).toBe(1);
  });
  it("sugiere bien cada caso", () => {
    expect(de("AH51 156L")).toMatchObject({ tipo: "auto", referenciaId: "r-ah51", gomas: 5 });
    expect(de("AH51 154M")).toMatchObject({ tipo: "parecido", referenciaId: "r-ah51" });
    expect(de("AH51 154M").motivo).toContain("154");
    expect(de("X-MULTI Z")).toMatchObject({ tipo: "auto", referenciaId: "r-xmz" });
    expect(de("XMUILTI")).toMatchObject({ tipo: "parecido", referenciaId: "r-xmz" });
    expect(de("VANTRA")).toMatchObject({ tipo: "parecido", referenciaId: "r-ra30" });
    expect(de("K25")).toMatchObject({ tipo: "sin_medida", marcaCatalogo: "Insa" });
    expect(de("AH31")).toMatchObject({ tipo: "sin_modelo", marcaCatalogo: "Hankook" });
    expect(de("FH40").tipo).toBe("sin_modelo");
    expect(de("X").tipo).toBe("sin_marca");
    expect(d.resumen.automaticas).toBe(2);
    expect(d.resumen.gomasAutomaticas).toBe(7);
    // Las opciones a mano: primero las de la marca.
    expect(de("AH31").opciones[0].referenciaId).toBe("r-ah51");
  });
  it("con una equivalencia guardada, encaja", () => {
    const c = cat();
    c.equivalencias = [{ id: "e1", marca: "HANKOOK", modelo: "AH51 156L", medida: "315/80R22.5", referenciaId: "r-ah51" }];
    const d2 = diagnosticar(c, gomas);
    expect(d2.resumen.encajan).toBe(8);
    expect(d2.resumen.porEquivalencia).toBe(5);
    expect(d2.sinReferencia.find((g) => g.modelo === "AH51 156L")).toBeUndefined();
    expect(d2.equivalencias[0]).toMatchObject({ gomas: 5, texto: "Hankook AH51 315/80R22.5 156/150L" });
  });
  it("sobrante: vacío en catálogo y sin gomas", () => {
    expect(d.sobrante.marcas.map((m) => m.nombre)).toEqual(["Kormoran"]); // Uniroyal tiene gomas
    expect(d.sobrante.modelos.map((m) => m.nombre)).toEqual(["XTE3"]);
    expect(d.sobrante.refsSinGomas.map((r) => r.id)).toContain("r-hd");
  });
  it("parecidos: HD D / HD D+ y 225/75R16 / CP, hasta marcarlos distintos", () => {
    expect(d.parecidos.map((p) => p.tipo).sort()).toEqual(["medida", "modelo"]);
    const c = cat();
    c.distintos = [{ tipo: "modelo", a: "hd", b: "hdp" }];
    expect(diagnosticar(c, gomas).parecidos.map((p) => p.tipo)).toEqual(["medida"]);
  });
});
