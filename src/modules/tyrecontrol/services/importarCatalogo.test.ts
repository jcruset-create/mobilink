import { describe, expect, it } from "vitest";
import {
  claveModelo, claveOferta, elegirHoja, ofertaDelModelo, kgDeIndice, kmhDeCodigo, leerHoja, medidaDeCatalogo, modeloDeCatalogo, planificar, planVacio,
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

  it("guarda la oferta: una fila por modelo, medida, IC y CV", () => {
    // El «Roadian CT8 / CTX» no tiene modelo y no entra.
    expect(p.oferta).toHaveLength(5);
    expect(p.oferta[1]).toEqual({ marca: "Hankook", modelo: "RA18", medida: "195/70R15", simple: "100", doble: "98", cv: "R" });
    expect(p.ofertaNueva).toBe(5);
  });

  const yaImportado = {
    marcas: [...hay.marcas, { id: "nx", nombre: "Nexen" }],
    modelos: [
      { id: "m1", marca_id: "hk", nombre: "RA58" }, { id: "m2", marca_id: "du", nombre: "SP346" },
      { id: "m3", marca_id: "du", nombre: "SP346+" }, { id: "m4", marca_id: "hk", nombre: "RA18" }, { id: "m5", marca_id: "nx", nombre: "Roadian CT8" },
    ],
    medidas: [...hay.medidas, { valor: "205/75R17.5" }, { valor: "315/60R22.5" }],
    indices: ["98", "100", "102", "104", "122", "124", "148", "154"].map((valor) => ({ valor })),
    velocidades: ["L", "M", "R"].map((valor) => ({ valor })),
  };

  it("un Excel ya importado pero sin su oferta: solo falta la oferta", () => {
    const despues = planificar(filas, yaImportado);
    expect(despues.modelos).toEqual([]);
    expect(despues.ofertaNueva).toBe(5);
    expect(planVacio(despues)).toBe(false);
  });

  it("un Excel que ya se importó, con su oferta, no tiene nada que hacer", () => {
    const despues = planificar(filas, {
      ...yaImportado,
      oferta: [
        claveOferta("m1", "195/70R15", "104", "102", "R"), claveOferta("m4", "195/70 R15", "100", "98", "r"),
        claveOferta("m3", "315/60R22.5", "154", "148", "L"), claveOferta("m2", "205/75R17.5", "124", "122", "M"),
        claveOferta("m5", "195/70R15", "104", "102", "R"),
      ],
    });
    expect(planVacio(despues)).toBe(true);
  });
});

describe("la oferta en el formulario de nueva referencia", () => {
  const oferta = [
    { modelo_id: "ra18", medida: "195/70R15", simple: "104", doble: "102", cv: "R" },
    { modelo_id: "ra18", medida: "225/75R16", simple: "121", doble: "120", cv: "R" },
    { modelo_id: "ra18", medida: "225/75R16", simple: "118", doble: "116", cv: "R" },
    { modelo_id: "ra58", medida: "205/65R16", simple: "107", doble: "105", cv: "T" },
  ];

  it("de un modelo, solo sus medidas", () => {
    const o = ofertaDelModelo(oferta, "ra18", "");
    expect(o.conOferta).toBe(true);
    expect(o.medidas).toEqual(["195/70R15", "225/75R16"]);
    expect(o.simples).toEqual([]);
  });

  it("de una medida, sus IC y CV", () => {
    const o = ofertaDelModelo(oferta, "ra18", "225/75 R16");
    expect(o.simples).toEqual(["118", "121"]);
    expect(o.dobles).toEqual(["116", "120"]);
    expect(o.velocidades).toEqual(["R"]);
    expect(o.medidaFuera).toBe(false);
  });

  it("una medida que el modelo no tiene se avisa", () => {
    expect(ofertaDelModelo(oferta, "ra18", "12R22.5").medidaFuera).toBe(true);
  });

  it("un modelo sin oferta no filtra nada", () => {
    const o = ofertaDelModelo(oferta, "otro", "225/75R16");
    expect(o.conOferta).toBe(false);
    expect(o.medidaFuera).toBe(false);
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
