import { describe, expect, it } from "vitest";
import { descripcionNormalizada, leerDescripcion } from "./articulos.ts";

describe("leerDescripcion", () => {
  it("lee la descripción real de Soledad", () => {
    const a = leerDescripcion("245/70X17.5 HANKOOK AH35 136M");
    expect(a.medida).toBe("245/70R17.5");
    expect(a.marca).toBe("HANKOOK");
    expect(a.modelo).toBe("AH35");
    expect(a.indice).toBe("136M");
    expect(a.bonito).toBe("HANKOOK AH35 245/70 R17.5 136M");
  });

  it("acepta una marca desconocida cuando hay medida", () => {
    const a = leerDescripcion("315/80R22.5 MARCANUEVA ZX9 156/150L");
    expect(a.marca).toBe("MARCANUEVA");
    expect(a.modelo).toBe("ZX9");
    expect(a.indice).toBe("156/150L");
  });

  it("lo que no encaja se enseña tal cual, sin inventar", () => {
    const a = leerDescripcion("CAMARA 20 PULGADAS");
    expect(a.medida).toBeNull();
    expect(a.bonito).toBe("CAMARA 20 PULGADAS");
  });

  it("la clave del mapeo ignora X/R, espacios y coma decimal", () => {
    expect(descripcionNormalizada("245/70X17.5 HANKOOK AH35 136M")).toBe(
      descripcionNormalizada("245/70 R17,5  hankook  AH35 136M")
    );
  });
});
