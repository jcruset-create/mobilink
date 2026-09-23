import { describe, it, expect } from "vitest";
import { normalizarMarca, marcaDelCatalogo, type MarcaConLogo } from "./logoMarca";

const catalogo: MarcaConLogo[] = [
  { id: "m1", nombre: "Mercedes-Benz", logo_url: "https://x/mb.png" },
  { id: "m2", nombre: "Volvo", logo_url: "https://x/volvo.png" },
  { id: "m3", nombre: "MAN", logo_url: null },
  { id: "m4", nombre: "Manitou", logo_url: "https://x/manitou.png" },
  { id: "m5", nombre: "Scania", logo_url: "https://x/scania.png" },
];

describe("normalizarMarca", () => {
  it("quita signos, acentos y mayúsculas", () => {
    expect(normalizarMarca("Mercedes-Benz")).toBe("MERCEDESBENZ");
    expect(normalizarMarca(" citroën ")).toBe("CITROEN");
    expect(normalizarMarca(null)).toBe("");
  });
});

describe("marcaDelCatalogo", () => {
  it("el id manda sobre el texto", () => {
    expect(marcaDelCatalogo({ marca: "VOLVO", marca_id: "m5" }, catalogo)?.nombre).toBe("Scania");
  });

  it("empareja aunque cambien mayúsculas y guiones", () => {
    expect(marcaDelCatalogo({ marca: "MERCEDES-BENZ" }, catalogo)?.id).toBe("m1");
    expect(marcaDelCatalogo({ marca: "volvo" }, catalogo)?.id).toBe("m2");
  });

  it("el caso real: MERCEDES a secas es Mercedes-Benz", () => {
    expect(marcaDelCatalogo({ marca: "MERCEDES" }, catalogo)?.id).toBe("m1");
  });

  it("MAN no se convierte en Manitou", () => {
    // Un logo equivocado es peor que ninguno: parece que confirma el dato.
    expect(marcaDelCatalogo({ marca: "MAN" }, catalogo)?.id).toBe("m3");
    expect(marcaDelCatalogo({ marca: "MANITOU" }, catalogo)?.id).toBe("m4");
  });

  it("si dos marcas empiezan igual, no se elige a voleo", () => {
    const dudoso: MarcaConLogo[] = [
      { id: "a", nombre: "Iveco Bus" }, { id: "b", nombre: "Iveco Camión" },
    ];
    expect(marcaDelCatalogo({ marca: "IVECO" }, dudoso)).toBeNull();
  });

  it("sin marca, o con una que no está, no hay logo", () => {
    expect(marcaDelCatalogo({ marca: null }, catalogo)).toBeNull();
    expect(marcaDelCatalogo({ marca: "Pegaso" }, catalogo)).toBeNull();
    expect(marcaDelCatalogo({ marca: "BM" }, catalogo)).toBeNull();
  });

  it("un marca_id que ya no está en el catálogo cae al nombre", () => {
    expect(marcaDelCatalogo({ marca: "SCANIA", marca_id: "borrada" }, catalogo)?.id).toBe("m5");
  });
});
