import { describe, expect, it } from "vitest";
import {
  claveModelo, elegirHoja, kgDeIndice, kmhDeCodigo, leerHoja, medidaDeCatalogo, modeloDeCatalogo, planificar, planVacio,
} from "./importarCatalogo";

describe("medidas", () => {
  it("se escriben como en la base: sin C de comercial ni XL; CP se queda", () => {
    expect(medidaDeCatalogo("195/70 R15C")).toBe("195/70R15");
    expect(medidaDeCatalogo("225/65 R16CP")).toBe("225/65R16CP");
    expect(medidaDeCatalogo("215/65 R17 XL")).toBe("215/65R17");
    expect(medidaDeCatalogo("315/80 R22.5")).toBe("315/80R22.5");
    expect(medidaDeCatalogo("155 R13C")).toBe("155R13");
  });
});

describe("modelos", () => {
  it("limpia los nombres que repetirían uno que ya hay", () => {
    expect(modeloDeCatalogo("Dunlop", "SP346 (17.5/19.5)")).toBe("SP346");
    expect(modeloDeCatalogo("Hankook", "SmartFlex AL51")).toBe("AL51");
    expect(modeloDeCatalogo("Hankook", "Vantra Transit (RA58)")).toBe("RA58");
    expect(modeloDeCatalogo("Hankook", "TH31+")).toBe("TH31+");
    expect(modeloDeCatalogo("Michelin", "Agilis 3")).toBe("Agilis 3");
  });

  it("un nombre que junta dos dibujos no se crea", () => {
    expect(modeloDeCatalogo("Nexen", "Roadian CT8 / CTX")).toBeNull();
  });

  it("el + es otro modelo; los espacios y guiones no", () => {
    expect(claveModelo("SP346")).not.toBe(claveModelo("SP346+"));
    expect(claveModelo("ULTRAGRIP MAX D")).toBe(claveModelo("ULTRA GRIP MAX D"));
    expect(claveModelo("Duravis R-STEER 002")).toBe(claveModelo("DURAVIS R-STEER 002"));
  });
});

describe("leer una hoja", () => {
  it("formato de camión: IC en dos columnas y eje", () => {
    const f = leerHoja([{ Marca: "Dunlop", "Modelo / dibujo": "SP346 (17.5/19.5)", Medida: "205/75 R17.5", "IC completo": "124/122", CV: "M", "IC sencillo": 124, "IC gemelo": 122, Eje: "Dirección" }])!;
    expect(f[0]).toEqual({ marca: "Dunlop", modelo: "SP346", medida: "205/75R17.5", simple: "124", doble: "122", cv: "M", temporada: null, eje: "direccion" });
  });

  it("formato de furgoneta: IC en una columna y temporada", () => {
    const f = leerHoja([{ Marca: "Michelin", Modelo: "Agilis Alpin", Temporada: "Invierno", Medida: "185/75 R16C", "IC sencillo/gemelo": "104/102", CV: "R" }])!;
    expect(f[0]).toMatchObject({ marca: "Michelin", modelo: "Agilis Alpin", medida: "185/75R16", simple: "104", doble: "102", cv: "R", temporada: "Invierno" });
  });

  it("formato de Hankook: sin marca, con el código en «Referencia»", () => {
    const f = leerHoja([{ Medida: "195/70 R15C", "IC sencillo / gemelo": "104/102", CV: "R", Referencia: "RA58", Modelo: "Vantra Transit" }])!;
    expect(f[0]).toMatchObject({ marca: "Hankook", modelo: "RA58", simple: "104", doble: "102" });
  });

  it("un índice sin gemelo, y una velocidad o índice raros se descartan", () => {
    const f = leerHoja([
      { Marca: "B", Modelo: "X", Medida: "385/65 R22.5", "IC sencillo": 160, "IC gemelo": "", CV: "K" },
      { Marca: "B", Modelo: "X", Medida: "385/65 R22.5", "IC sencillo": "160R", "IC gemelo": "", CV: "KK" },
    ])!;
    expect(f[0]).toMatchObject({ simple: "160", doble: null, cv: "K" });
    expect(f[1]).toMatchObject({ simple: null, cv: null });
  });

  it("una hoja de notas no es una hoja de catálogo", () => {
    expect(leerHoja([{ ALCANCE: "Furgoneta", "": "x" }])).toBeNull();
  });

  it("de varias hojas elige la que tiene modelos", () => {
    const h = elegirHoja({
      "Medidas sin marca": [{ Medida: "155 R13C", "IC sencillo": 90, "IC gemelo": 88, CV: "R" }, { Medida: "165 R13C", "IC sencillo": 94, "IC gemelo": 92, CV: "P" }],
      "Catalogo por modelo": [{ Marca: "Hankook", "Modelo / dibujo": "Vantra LT (RA18)", Medida: "155 R13C", "IC sencillo": 90, "IC gemelo": 88, CV: "R" }],
      Notas: [{ ALCANCE: "x" }],
    })!;
    expect(h.nombre).toBe("Catalogo por modelo");
  });
});

describe("planificar", () => {
  const hay = {
    marcas: [{ id: "hk", nombre: "Hankook" }, { id: "du", nombre: "Dunlop" }],
    modelos: [{ marca_id: "hk", nombre: "RA58" }, { marca_id: "du", nombre: "SP346" }],
    medidas: [{ valor: "195/70R15" }],
    indices: [{ valor: "104" }],
    velocidades: [{ valor: "R" }],
  };
  const filas = leerHoja([
    { Marca: "Hankook", "Modelo / dibujo": "Vantra Transit (RA58)", Medida: "195/70 R15C", "IC sencillo": 104, "IC gemelo": 102, CV: "R" },
    { Marca: "Hankook", "Modelo / dibujo": "Vantra LT (RA18)", Medida: "195/70 R15C", "IC sencillo": 100, "IC gemelo": 98, CV: "R" },
    { Marca: "Dunlop", "Modelo / dibujo": "SP346+", Medida: "315/60 R22.5", "IC sencillo": 154, "IC gemelo": 148, CV: "L" },
    { Marca: "Dunlop", "Modelo / dibujo": "SP346 (17.5/19.5)", Medida: "205/75 R17.5", "IC sencillo": 124, "IC gemelo": 122, CV: "M" },
    { Marca: "Nexen", "Modelo / dibujo": "Roadian CT8", Medida: "195/70 R15C", "IC sencillo": 104, "IC gemelo": 102, CV: "R" },
    { Marca: "Nexen", "Modelo / dibujo": "Roadian CT8 / CTX", Medida: "195/70 R15C", "IC sencillo": 104, "IC gemelo": 102, CV: "R" },
  ])!;
  const p = planificar(filas, hay);

  it("solo lo que falta", () => {
    expect(p.marcas).toEqual(["Nexen"]);
    expect(p.medidas).toEqual(["205/75R17.5", "315/60R22.5"]);
    expect(p.indices).toEqual(["98", "100", "102", "122", "124", "148", "154"]);
    expect(p.velocidades).toEqual(["L", "M"]);
    expect(p.modelos.map((m) => `${m.marca} ${m.nombre}`)).toEqual(["Dunlop SP346+", "Hankook RA18", "Nexen Roadian CT8"]);
  });

  it("y cuenta lo que ya estaba", () => {
    expect(p.yaEstaban).toEqual({ medidas: 1, indices: 1, velocidades: 1, modelos: 2 });
  });

  it("un Excel que ya se importó no tiene nada que hacer", () => {
    const despues = planificar(filas, {
      marcas: [...hay.marcas, { id: "nx", nombre: "Nexen" }],
      modelos: [...hay.modelos, { marca_id: "du", nombre: "SP346+" }, { marca_id: "hk", nombre: "RA18" }, { marca_id: "nx", nombre: "Roadian CT8" }],
      medidas: [...hay.medidas, { valor: "205/75R17.5" }, { valor: "315/60R22.5" }],
      indices: ["98", "100", "102", "104", "122", "124", "148", "154"].map((valor) => ({ valor })),
      velocidades: ["L", "M", "R"].map((valor) => ({ valor })),
    });
    expect(planVacio(despues)).toBe(true);
  });
});

describe("kilos y km/h", () => {
  it("de la tabla normalizada", () => {
    expect(kgDeIndice("104")).toBe(900);
    expect(kgDeIndice("160")).toBe(4500);
    expect(kgDeIndice("300")).toBeNull();
    expect(kmhDeCodigo("r")).toBe(170);
    expect(kmhDeCodigo("H")).toBe(210);
  });
});
