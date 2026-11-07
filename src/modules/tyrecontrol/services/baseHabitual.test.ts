import { describe, expect, it } from "vitest";
import { motivoSinBase } from "./baseHabitual";
import type { BaseHabitual } from "./data";

/**
 * Lo que se fija aquí es que la lista diga POR QUÉ falta la base y no un
 * «no hay datos» para todo. Los tres casos mandan a sitios distintos: uno se
 * arregla volviendo a pasar el cálculo, otro lo decide una persona y el
 * tercero hay que escribirlo a mano.
 */
const fila = (p: Partial<BaseHabitual>): BaseHabitual => ({
  vehiculo_id: "v", matricula: "1234ABC",
  base_actual_id: null, base_actual: null,
  base_propuesta_id: null, base_propuesta: null,
  horas: null, horas_en_bases: null, cuota: null, estancias: null,
  segunda_id: null, segunda: null, horas_segunda: null,
  decision: "sin_datos",
  ...p,
});

describe("motivoSinBase", () => {
  it("sin fila que mirar no se inventa un motivo", () => {
    expect(motivoSinBase(undefined)).toBeNull();
  });

  it("sin datos de presencia lo dice tal cual", () => {
    const m = motivoSinBase(fila({ decision: "sin_datos" }))!;
    expect(m.texto).toBe("Sin datos de presencia");
    expect(m.clase).toBe("sin_datos");
    expect(m.detalle).toContain("a mano");
  });

  it("decisión clara: dice cuál se le puede poner y con qué respaldo", () => {
    const m = motivoSinBase(fila({
      decision: "clara", base_propuesta: "Reus", base_propuesta_id: "b1",
      horas: 92.4, horas_en_bases: 100, cuota: 0.924,
    }))!;
    expect(m.texto).toBe("Se le puede poner Reus (92 %)");
    expect(m.clase).toBe("propuesta");
    expect(m.detalle).toContain("92 h");
  });

  it("dudosa entre dos bases: dice entre cuáles duda, que es lo que decide la persona", () => {
    const m = motivoSinBase(fila({
      decision: "dudosa",
      base_propuesta: "Reus", horas: 45, cuota: 0.45,
      segunda: "Vilanova", horas_segunda: 38, horas_en_bases: 100,
    }))!;
    expect(m.texto).toBe("Base dudosa: Reus 45 % · Vilanova 38 %");
    expect(m.clase).toBe("dudosa");
    expect(m.detalle).toContain("60 %");
  });

  it("dudosa por pocas horas: dice que faltan horas, no que haya empate", () => {
    const m = motivoSinBase(fila({
      decision: "dudosa", base_propuesta: "Calafell", horas: 9, horas_en_bases: 9, cuota: 1,
    }))!;
    expect(m.texto).toBe("Base dudosa: Calafell, solo 9 h");
    expect(m.detalle).toContain("24");
    // No se habla de una segunda base que no existe.
    expect(m.texto).not.toContain("·");
  });

  it("dudosa sin ninguna base con horas se trata como sin datos", () => {
    const m = motivoSinBase(fila({ decision: "dudosa" }))!;
    expect(m.clase).toBe("sin_datos");
  });

  it("los números se redondean: en una fila no caben tres decimales", () => {
    const m = motivoSinBase(fila({
      decision: "clara", base_propuesta: "Reus", horas: 24.4999, cuota: 0.6049,
    }))!;
    expect(m.texto).toBe("Se le puede poner Reus (60 %)");
    expect(m.detalle).toContain("24 h");
  });
});
