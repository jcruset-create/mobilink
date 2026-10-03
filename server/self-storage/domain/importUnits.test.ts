import { describe, expect, it } from "vitest";
import { decidirAcciones, leerCsv, leerFilas, mapearCabeceras, resumen, ZONA_GENERAL_NUEVA, type ContextoCentro, type TrasteroExistente } from "./importUnits.ts";

/** Cabecera antigua de Reus: «IVA» era la CUOTA en euros (alias deprecado de cuota_iva). */
const CABECERA = "Nº trastero;largo;ancho;alto;m²;m³;precio;IVA;PVP";
/** IVA general de la empresa en las pruebas (sale de la configuración, nunca del CSV). */
const OPC = { ivaGeneral: 21 };

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
    expect(mapa).toMatchObject({ code: 0, length: 1, width: 2, height: 3, area: 4, volume: 5, price: 6, vat: 7, gross: 8 });
    expect(desconocidas).toEqual([]);
  });
});

describe("lectura de filas", () => {
  it("fila buena en metros con coma decimal", () => {
    const { filas, avisos } = leerFilas(`${CABECERA}\n1;2;1,5;2,5;3;7,5;49,59;10,41;60,00\n`, OPC);
    expect(filas[0].errors).toEqual([]);
    expect(avisos.join()).toMatch(/deprecada/);
    expect(filas[0].parsed).toMatchObject({
      code: "1",
      length_cm: 200,
      width_cm: 150,
      height_cm: 250,
      area_m2: 3,
      volume_m3: 7.5,
      monthly_price: 49.59,
      tax_rate: 21,
      vat_amount: 10.41,
      monthly_price_gross: 60,
    });
  });

  it("calcula m² y m³ si faltan, y avisa si los declarados se desvían", () => {
    const { filas } = leerFilas("numero;largo;ancho;alto;m2;pvp\nA1;2;1,5;2,5;;60\nA2;2;1,5;2,5;4;60\n", OPC);
    expect(filas[0].parsed?.area_m2).toBe(3);
    expect(filas[0].parsed?.volume_m3).toBe(7.5);
    expect(filas[1].parsed?.area_m2).toBe(4);
    expect(filas[1].warnings.join()).toMatch(/difieren/);
  });

  it("PVP que no corresponde a precio + cuota es error de la fila", () => {
    const { filas } = leerFilas(`${CABECERA}\n1;2;1,5;2,5;3;7,5;40;10,41;60\n`, OPC);
    expect(filas[0].parsed).toBeNull();
    expect(filas[0].errors.join()).toMatch(/PVP/);
  });

  it("número repetido en el fichero: error en TODAS sus filas", () => {
    const { filas } = leerFilas(`${CABECERA}\n7;2;1;2;;;10;2,1;\n7;2;1;2;;;10;2,1;\n8;2;1;2;;;10;2,1;\n`, OPC);
    expect(filas[0].errors.join()).toMatch(/repetido/);
    expect(filas[1].errors.join()).toMatch(/repetido/);
    expect(filas[2].errors).toEqual([]);
  });

  it("valores no numéricos y medidas a cero", () => {
    const { filas } = leerFilas(`${CABECERA}\n1;dos;1;2;;;10;2,1;\n2;0;1;2;;;10;2,1;\n`, OPC);
    expect(filas[0].errors.join()).toMatch(/Largo/);
    expect(filas[1].errors.join()).toMatch(/mayor que cero/);
  });

  it("faltan columnas obligatorias", () => {
    expect(() => leerFilas("numero;largo\n1;2\n", OPC)).toThrow(/Faltan columnas/);
    expect(() => leerFilas("solo cabecera\n", OPC)).toThrow(/no tiene filas/);
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
    vat_amount: 10.41,
    monthly_price_gross: 60,
    deposit_amount: 0,
  };
  const csv = `${CABECERA}\n1;2;1,5;2,5;3;7,5;49,59;10,41;60\n2;2;1,5;2,5;3;7,5;49,59;10,41;60\n`;

  it("nuevo → create; existente igual → skip (reimportar no duplica)", () => {
    const ctx = ctxVacio();
    ctx.existentes.set("1", existente);
    const filas = decidirAcciones(leerFilas(csv, OPC).filas, ctx);
    expect(filas.map((f) => f.action)).toEqual(["skip", "create"]);
    expect(resumen(filas)).toMatchObject({ create: 1, skip: 1, update: 0, error: 0 });
  });

  it("existente con otro precio → update con la lista de cambios", () => {
    const ctx = ctxVacio();
    ctx.existentes.set("1", { ...existente, monthly_price: 41.32, vat_amount: 8.68, monthly_price_gross: 50 });
    const [f] = decidirAcciones(leerFilas(csv, OPC).filas, ctx);
    expect(f.action).toBe("update");
    expect(f.cambios).toEqual(expect.arrayContaining(["monthly_price", "monthly_price_gross"]));
  });

  it("sin zona en el CSV ni zona por defecto: los nuevos son error, los existentes conservan la suya", () => {
    const ctx = ctxVacio(null);
    ctx.existentes.set("1", existente);
    const filas = decidirAcciones(leerFilas(csv, OPC).filas, ctx);
    expect(filas[0].action).toBe("skip");
    expect(filas[1].action).toBe("error");
  });

  it("zona o tipo que no existen son error", () => {
    const filas = decidirAcciones(leerFilas("numero;zona;tipo;largo;ancho;alto;pvp\n1;Z9;;2;1;2;60\n2;Z1;NOPE;2;1;2;60\n3;z2;box-3;2;1;2;60\n", OPC).filas, ctxVacio());
    expect(filas.map((f) => f.action)).toEqual(["error", "error", "create"]);
    expect(filas[2].valores).toMatchObject({ zone_id: "zona-2", unit_type_id: "tipo-3" });
  });
});

describe("IVA: la cuota del CSV es un importe, no un porcentaje", () => {
  const NUEVO = "codigo,tipo,numero,largo_cm,ancho_cm,alto_cm,m2,m3,precio_base,cuota_iva,pvp";

  it("cuota_iva = 4.34 no se interpreta como 4,34 %: 20,66 + 4,34 = 25,00 se importa", () => {
    const { filas, avisos } = leerFilas(`${NUEVO}\nTaquilla 113,taquilla,113,100,100,100,1.0,1.0,20.66,4.34,25.0\n`, OPC);
    expect(filas[0].errors).toEqual([]);
    expect(filas[0].warnings).toEqual([]);
    expect(avisos).toEqual([]);
    expect(filas[0].parsed).toMatchObject({
      code: "TAQUILLA 113",
      typeCode: "TAQUILLA",
      name: "113",
      width_cm: 100,
      length_cm: 100,
      height_cm: 100,
      monthly_price: 20.66,
      vat_amount: 4.34,
      monthly_price_gross: 25,
      // El tipo es el IVA GENERAL configurado, no 4,34.
      tax_rate: 21,
    });
  });

  it("el tipo sale de la configuración: con IVA general 10, la misma fila guarda 10 (y avisa de que la cuota no cuadra)", () => {
    const { filas } = leerFilas(`${NUEVO}\nT1,,1,100,100,100,,,20.66,4.34,25\n`, { ivaGeneral: 10 });
    expect(filas[0].parsed).toMatchObject({ tax_rate: 10, vat_amount: 4.34, monthly_price_gross: 25 });
    expect(filas[0].warnings.join()).toMatch(/no corresponde al IVA general/);
  });

  it("base + cuota ≠ PVP se rechaza (con tolerancia de 0,01 €)", () => {
    const { filas } = leerFilas(`${NUEVO}\nT1,,1,100,100,100,,,20.66,4.34,26\nT2,,2,100,100,100,,,45.46,9.55,55\n`, OPC);
    expect(filas[0].parsed).toBeNull();
    expect(filas[0].errors.join()).toMatch(/no es el PVP/);
    // 45,46 + 9,55 = 55,01: dentro de la tolerancia.
    expect(filas[1].errors).toEqual([]);
    expect(filas[1].parsed?.monthly_price_gross).toBe(55);
  });

  it("medidas con sufijo _cm se leen en cm aunque sean pequeñas", () => {
    const { filas } = leerFilas(`${NUEVO}\nT1,,1,15,15,150,,,1,0.21,1.21\n`, OPC);
    expect(filas[0].parsed).toMatchObject({ length_cm: 15, width_cm: 15, height_cm: 150 });
  });

  it("una columna con el TIPO de IVA (porcentaje) se rechaza con un mensaje claro", () => {
    expect(() => leerFilas("codigo;largo;ancho;alto;precio_base;tipo_iva;pvp\nT1;1;1;1;10;21;12,1\n", OPC)).toThrow(/porcentaje de IVA/);
  });

  it("tipos que no existen: error, o se crean al aplicar si se pide", () => {
    const leidas = leerFilas(`${NUEVO}\nT1,taquilla,1,100,100,100,,,20.66,4.34,25\n`, OPC).filas;
    expect(decidirAcciones(leidas, ctxVacio())[0].action).toBe("error");
    const [f] = decidirAcciones(leidas, { ...ctxVacio(), crearTiposQueFalten: true });
    expect(f.action).toBe("create");
    expect(f.tipoACrear).toBe("TAQUILLA");
    expect(f.warnings.join()).toMatch(/se creará/);
  });
});

describe("zona", () => {
  const NUEVO = "codigo,largo_cm,ancho_cm,alto_cm,precio_base,cuota_iva,pvp\nT1,100,100,100,20.66,4.34,25\n";
  it("centro sin ninguna zona: se creará «General» (aviso, no error)", () => {
    const [f] = decidirAcciones(leerFilas(NUEVO, OPC).filas, { ...ctxVacio(null), zonasPorCodigo: new Map(), crearZonaGeneral: true });
    expect(f.action).toBe("create");
    expect(f.valores?.zone_id).toBe(ZONA_GENERAL_NUEVA);
    expect(f.warnings.join()).toMatch(/General/);
  });
  it("centro con varias zonas y ninguna elegida: error que dice dónde elegirla", () => {
    const [f] = decidirAcciones(leerFilas(NUEVO, OPC).filas, ctxVacio(null));
    expect(f.action).toBe("error");
    expect(f.errors.join()).toMatch(/Zona para los nuevos/);
  });
});

