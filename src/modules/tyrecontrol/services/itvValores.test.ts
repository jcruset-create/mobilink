import { describe, expect, it } from "vitest";
import {
  hasRealValue, numeroEspanol, fechaIsoItv, partesPorEje, normalizarValor,
  nivelConfianza, seleccionarPorDefecto, hayCambio,
} from "./itvValores";

describe("hasRealValue: que no se guarde lo que no es un dato", () => {
  it("null no es un dato", () => expect(hasRealValue(null)).toBe(false));
  it("undefined no es un dato", () => expect(hasRealValue(undefined)).toBe(false));
  it("la cadena vacia no es un dato", () => expect(hasRealValue("")).toBe(false));
  it("solo espacios no es un dato", () => expect(hasRealValue("   ")).toBe(false));
  it("un guion no es un dato", () => expect(hasRealValue("-")).toBe(false));
  it("dos guiones no son un dato", () => expect(hasRealValue("--")).toBe(false));
  it("una tira de guiones no es un dato", () => expect(hasRealValue("------------")).toBe(false));
  it("guiones separados por barras no son un dato", () => expect(hasRealValue("----------- / ----------------")).toBe(false));
  it("solo barras y espacios no son un dato", () => expect(hasRealValue(" / / ")).toBe(false));
  it("puntos suspensivos no son un dato", () => expect(hasRealValue("......")).toBe(false));
  it("un tramo con cifra SI es un dato", () => expect(hasRealValue("3900 / ------------")).toBe(true));
  it("N/A no es un dato", () => expect(hasRealValue("N/A")).toBe(false));
  it("NO CONSTA no es un dato", () => expect(hasRealValue("no consta")).toBe(false));
  it("SIN DATOS no es un dato", () => expect(hasRealValue(" Sin Datos ")).toBe(false));

  it('el texto "0" SI es un dato', () => expect(hasRealValue("0")).toBe(true));
  it("el numero 0 SI es un dato", () => expect(hasRealValue(0)).toBe(true));
  it('"EURO 6" es un dato', () => expect(hasRealValue("EURO 6")).toBe(true));
  it("false es un dato", () => expect(hasRealValue(false)).toBe(true));

  it("un array vacio no es un dato", () => expect(hasRealValue([])).toBe(false));
  it("un array solo de guiones no es un dato", () => expect(hasRealValue(["-", "  "])).toBe(false));
  it("un array con algo dentro es un dato", () => expect(hasRealValue(["-", "8000"])).toBe(true));
  it("un objeto sin nada util no es un dato", () => expect(hasRealValue({ eje_1: "", eje_2: "-" })).toBe(false));
  it("un objeto con un eje informado es un dato", () => expect(hasRealValue({ eje_1: 8000 })).toBe(true));
});

describe("numeroEspanol: el punto es separador de miles", () => {
  it('"18.000 kg" son dieciocho mil', () => expect(numeroEspanol("18.000 kg")).toBe(18000));
  it('"12.419 cm3" son doce mil cuatrocientos diecinueve', () => expect(numeroEspanol("12.419 cm³")).toBe(12419));
  it('"46,8" es un decimal', () => expect(numeroEspanol("46,8")).toBe(46.8));
  it('"1.234,56" mezcla miles y decimales', () => expect(numeroEspanol("1.234,56")).toBe(1234.56));
  it('"368 kW" ignora la unidad', () => expect(numeroEspanol("368 kW")).toBe(368));
  it('"16.5" con un solo decimal NO son dieciseis mil quinientos', () => expect(numeroEspanol("16.5")).toBe(16.5));
  it("un texto sin cifras no da numero", () => expect(numeroEspanol("EURO 6")).toBe(6));
  it("un texto sin ninguna cifra da null", () => expect(numeroEspanol("DIESEL")).toBeNull());
});

describe("fechaIsoItv", () => {
  it('"09/02/2017" pasa a ISO', () => expect(fechaIsoItv("09/02/2017")).toBe("2017-02-09"));
  it('"9-2-2017" pasa a ISO', () => expect(fechaIsoItv("9-2-2017")).toBe("2017-02-09"));
  it("una fecha ya ISO se respeta", () => expect(fechaIsoItv("2017-02-09")).toBe("2017-02-09"));
  it("lo que no es fecha da null", () => expect(fechaIsoItv("MAN")).toBeNull());
});

describe("partesPorEje: los ejes vacios no se guardan", () => {
  it("reparte las masas por eje", () => {
    expect(partesPorEje("8000 / 13000 /  / ", "kg")).toEqual({ eje_1: 8000, eje_2: 13000, unidad: "kg" });
  });
  it("un solo eje informado", () => {
    expect(partesPorEje("3900 / --------- / ---------", "mm")).toEqual({ eje_1: 3900, unidad: "mm" });
  });
  it("todo vacio da null", () => expect(partesPorEje(" --- / --- ")).toBeNull());
});

describe("normalizarValor", () => {
  it("integer redondea", () => expect(normalizarValor("2", "integer").numero).toBe(2));
  it("decimal conserva el decimal", () => expect(normalizarValor("46,8", "decimal").numero).toBe(46.8));
  it("decimal con miles", () => expect(normalizarValor("18.000 kg", "decimal").numero).toBe(18000));
  it("date normaliza a ISO", () => expect(normalizarValor("09/02/2017", "date").fecha).toBe("2017-02-09"));
  it("json reparte por ejes", () => {
    expect(normalizarValor("8000 / 11500 / /", "json", "kg").json).toEqual({ eje_1: 8000, eje_2: 11500, unidad: "kg" });
  });
  it("text deja el texto tal cual", () => expect(normalizarValor(" EURO 6 ", "text").texto).toBe("EURO 6"));
  it("el cero se guarda", () => {
    const v = normalizarValor("0", "integer");
    expect(v.numero).toBe(0);
    expect(v.texto).toBe("0");
  });
  it("un guion no produce ningun valor", () => {
    expect(normalizarValor("---", "decimal")).toEqual({ texto: null, numero: null, fecha: null, booleano: null, json: null });
  });
  it("decimal_array parte y descarta vacios", () => {
    expect(normalizarValor("8000 / - / 11500", "decimal_array").json).toEqual([8000, 11500]);
  });
});

describe("confianza", () => {
  it("0.96 es alta y se marca sola", () => {
    expect(nivelConfianza(0.96)).toBe("alta");
    expect(seleccionarPorDefecto(0.96)).toBe(true);
  });
  it("0.80 es media y avisa, pero no se marca sola", () => {
    expect(nivelConfianza(0.8)).toBe("media");
    expect(seleccionarPorDefecto(0.8)).toBe(false);
  });
  it("0.55 es baja", () => {
    expect(nivelConfianza(0.55)).toBe("baja");
    expect(seleccionarPorDefecto(0.55)).toBe(false);
  });
});

describe("hayCambio", () => {
  it("mismo valor con distinto formato no es cambio", () => expect(hayCambio(" MAN ", "man")).toBe(false));
  it("valor distinto es cambio", () => expect(hayCambio("18000", "19000")).toBe(true));
  it("de vacio a valor es cambio", () => expect(hayCambio(null, "TGX")).toBe(true));
});
