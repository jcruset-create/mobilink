import { describe, expect, it } from "vitest";
import { decidirAcciones, leerCsv, leerFilas, mapearCabeceras, resumen, type ContextoCentro, type TrasteroExistente } from "./importUnits.ts";

/** Cabecera como la del fichero de Reus (sin zona: la elige quien importa). */
const CABECERA = "Nº trastero;largo;ancho;alto;m²;m³;precio;IVA;PVP";

const ctxVacio = (zona: string | null = "zona-1"): ContextoCentro => ({
  existentes: new Map(),
  zonasPorCodigo: new Map([["Z1", "zona-1"], ["Z2", "zona-2"]]),
  tiposPorCodigo: new Map([["BOX-3", "tipo-3"]]),
  zonaPorDefecto: zona,
});

describe("CSV", () => {
  it("separador ; con comillas y CRLF, y BOM", () => {
    expect(leerCsv('﻿a;b\r\n"x;1";"di""jo"\r\n')).toEqual([
      ["a", "b"],
      ["x;1", 'di"jo'],
    ]);
  });

  it("separador , y tabulador", () => {
    expect(leerCsv("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(leerCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reconoce las cabeceras de Reus", () => {
    const { mapa, desconocidas } = mapearCabeceras(CABECERA.split(";"));
    expect(mapa).toMatchObject({ code: 0, length: 1, width: 2, height: 3, area: 4, volume: 5, price: 6, tax: 7, gross: 8 });
    expect(desconocidas).toEqual([]);
  });
});

describe("lectura de filas", () => {
  it("fila buena en metros con coma decimal", () => {
    const { filas } = leerFilas(`${CABECERA}\n1;2;1,5;2,5;3;7,5;49,59;21;60,00\n`);
    expect(filas[0].errors).toEqual([]);
    expect(filas[0].parsed).toMatchObject({
      code: "1",
      length_cm: 200,
      width_cm: 150,
      height_cm: 250,
      area_m2: 3,
      volume_m3: 7.5,
      monthly_price: 49.59,
      tax_rate: 21,
      monthly_price_gross: 60,
    });
  });

  it("calcula m² y m³ si faltan, y avisa si los declarados se desvían", () => {
    const { filas } = leerFilas("numero;largo;ancho;alto;m2;pvp\nA1;2;1,5;2,5;;60\nA2;2;1,5;2,5;4;60\n", { ivaPorDefecto: 21 });
    expect(filas[0].parsed?.area_m2).toBe(3);
    expect(filas[0].parsed?.volume_m3).toBe(7.5);
    expect(filas[1].parsed?.area_m2).toBe(4);
    expect(filas[1].warnings.join()).toMatch(/difieren/);
  });

  it("PVP que no corresponde a precio + IVA es error de la fila", () => {
    const { filas } = leerFilas(`${CABECERA}\n1;2;1,5;2,5;3;7,5;40;21;60\n`);
    expect(filas[0].parsed).toBeNull();
    expect(filas[0].errors.join()).toMatch(/PVP/);
  });

  it("número repetido en el fichero: error en TODAS sus filas", () => {
    const { filas } = leerFilas(`${CABECERA}\n7;2;1;2;;;10;21;\n7;2;1;2;;;10;21;\n8;2;1;2;;;10;21;\n`);
    expect(filas[0].errors.join()).toMatch(/repetido/);
    expect(filas[1].errors.join()).toMatch(/repetido/);
    expect(filas[2].errors).toEqual([]);
  });

  it("valores no numéricos y medidas a cero", () => {
    const { filas } = leerFilas(`${CABECERA}\n1;dos;1;2;;;10;21;\n2;0;1;2;;;10;21;\n`);
    expect(filas[0].errors.join()).toMatch(/Largo/);
    expect(filas[1].errors.join()).toMatch(/mayor que cero/);
  });

  it("faltan columnas obligatorias", () => {
    expect(() => leerFilas("numero;largo\n1;2\n")).toThrow(/Faltan columnas/);
    expect(() => leerFilas("solo cabecera\n")).toThrow(/no tiene filas/);
  });
});

describe("decisión contra la base", () => {
  const existente: TrasteroExistente = {
    id: "u-1",
    code: "1",
    zone_id: "zona-1",
    unit_type_id: null,
    name: null,
    width_cm: 150,
    length_cm: 200,
    height_cm: 250,
    area_m2: 3,
    volume_m3: 7.5,
    monthly_price: 49.59,
    tax_rate: 21,
    monthly_price_gross: 60,
    deposit_amount: 0,
  };
  const csv = `${CABECERA}\n1;2;1,5;2,5;3;7,5;49,59;21;60\n2;2;1,5;2,5;3;7,5;49,59;21;60\n`;

  it("nuevo → create; existente igual → skip (reimportar no duplica)", () => {
    const ctx = ctxVacio();
    ctx.existentes.set("1", existente);
    const filas = decidirAcciones(leerFilas(csv).filas, ctx);
    expect(filas.map((f) => f.action)).toEqual(["skip", "create"]);
    expect(resumen(filas)).toMatchObject({ create: 1, skip: 1, update: 0, error: 0 });
  });

  it("existente con otro precio → update con la lista de cambios", () => {
    const ctx = ctxVacio();
    ctx.existentes.set("1", { ...existente, monthly_price: 41.32, monthly_price_gross: 50 });
    const [f] = decidirAcciones(leerFilas(csv).filas, ctx);
    expect(f.action).toBe("update");
    expect(f.cambios).toEqual(expect.arrayContaining(["monthly_price", "monthly_price_gross"]));
  });

  it("sin zona en el CSV ni zona por defecto: los nuevos son error, los existentes conservan la suya", () => {
    const ctx = ctxVacio(null);
    ctx.existentes.set("1", existente);
    const filas = decidirAcciones(leerFilas(csv).filas, ctx);
    expect(filas[0].action).toBe("skip");
    expect(filas[1].action).toBe("error");
  });

  it("zona o tipo que no existen son error", () => {
    const filas = decidirAcciones(leerFilas("numero;zona;tipo;largo;ancho;alto;pvp\n1;Z9;;2;1;2;60\n2;Z1;NOPE;2;1;2;60\n3;z2;box-3;2;1;2;60\n").filas, ctxVacio());
    expect(filas.map((f) => f.action)).toEqual(["error", "error", "create"]);
    expect(filas[2].valores).toMatchObject({ zone_id: "zona-2", unit_type_id: "tipo-3" });
  });
});
