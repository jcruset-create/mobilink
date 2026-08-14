import { describe, it, expect } from "vitest";
import { aDinero, formatear } from "./money.ts";
import {
  calcularExtra, debeCobrarse, esError, sumarExtras, unidadesExcedidas, type Extra,
} from "./extras.ts";

const kmAdicional: Extra = {
  id: 1, code: "EXTRA_KM", name: "Kilómetro adicional",
  calculationType: "PER_KM", amount: "1.25", unit: "km",
};
const tiempoDiurno: Extra = {
  id: 2, code: "EXTRA_TIME_DAY", name: "Tiempo extra diurno",
  calculationType: "PER_HOUR", amount: "50", unit: "h",
};
const neumaticoAdicional: Extra = {
  id: 3, code: "ADDITIONAL_TIRE", name: "Neumático adicional",
  calculationType: "PER_UNIT", amount: "60", unit: "ud",
};
const anulacion: Extra = {
  id: 4, code: "CANCELLATION", name: "Anulación con salida",
  calculationType: "PERCENTAGE", percentage: "50",
};

describe("suplementos", () => {
  describe("la regla del umbral, que es configuración y no una excepción", () => {
    it("con umbral del 20 % y 100 km incluidos, 115 km no se cobran", () => {
      expect(debeCobrarse("THRESHOLD_PERCENT", 20, 100, 115)).toBe(false);
    });

    it("y 121 km sí", () => {
      expect(debeCobrarse("THRESHOLD_PERCENT", 20, 100, 121)).toBe(true);
    });

    it("justo en el 20 % no se cobra: el umbral hay que superarlo", () => {
      expect(debeCobrarse("THRESHOLD_PERCENT", 20, 100, 120)).toBe(false);
    });

    it("otro tarifario puede cobrar siempre, sin tocar código", () => {
      expect(debeCobrarse("ALWAYS", null, 100, 101)).toBe(true);
      expect(debeCobrarse("ALWAYS", null, 100, 100)).toBe(false);
    });

    it("o poner un umbral en unidades en vez de en porcentaje", () => {
      expect(debeCobrarse("THRESHOLD_ABSOLUTE", 15, 100, 114)).toBe(false);
      expect(debeCobrarse("THRESHOLD_ABSOLUTE", 15, 100, 116)).toBe(true);
    });

    it("sin nada incluido, un umbral porcentual no significa nada y se cobra el exceso", () => {
      // El 20 % de cero es cero: si no, no se cobraría nunca
      expect(debeCobrarse("THRESHOLD_PERCENT", 20, 0, 5)).toBe(true);
      expect(debeCobrarse("THRESHOLD_PERCENT", 20, null, 5)).toBe(true);
    });

    it("sin dato real no se cobra nada: no se inventa un exceso", () => {
      expect(debeCobrarse("ALWAYS", null, 100, null)).toBe(false);
    });

    it("se factura todo el exceso, no solo lo que pasa del umbral", () => {
      // 100 incluidos y 130 reales: se cobran 30, no 10
      expect(unidadesExcedidas(100, 130)).toBe(30);
      expect(unidadesExcedidas(100, 90)).toBe(0);
      expect(unidadesExcedidas(null, 30)).toBe(30);
    });
  });

  it("kilómetros adicionales: 25 km a 1,25 €", () => {
    const r = calcularExtra(kmAdicional, { unidades: 25 });
    expect(esError(r)).toBe(false);
    if (esError(r)) return;
    expect(r.cantidad).toBe(25);
    expect(r.unidad).toBe("km");
    expect(formatear(r.total)).toBe("31.25");
  });

  it("el tiempo por horas convierte los minutos", () => {
    // 90 minutos de más a 50 €/h = 75 €
    const r = calcularExtra(tiempoDiurno, { unidades: 90 });
    if (esError(r)) throw new Error(r.error);
    expect(r.cantidad).toBe(1.5);
    expect(formatear(r.total)).toBe("75.00");
  });

  it("neumáticos adicionales: dos a 60 €", () => {
    const r = calcularExtra(neumaticoAdicional, { unidades: 2 });
    if (esError(r)) throw new Error(r.error);
    expect(formatear(r.total)).toBe("120.00");
  });

  it("la anulación es un porcentaje del forfait", () => {
    const r = calcularExtra(anulacion, { baseParaPorcentaje: aDinero("331")! });
    if (esError(r)) throw new Error(r.error);
    expect(formatear(r.total)).toBe("165.50");
  });

  it("un porcentaje sin base no se inventa: da error", () => {
    const r = calcularExtra(anulacion, {});
    expect(esError(r) && r.error).toBe("EXTRA_BASE_MISSING");
  });

  it("un extra sin importe configurado da error, no cero", () => {
    const roto: Extra = { ...kmAdicional, amount: null };
    const r = calcularExtra(roto, { unidades: 10 });
    expect(esError(r) && r.error).toBe("EXTRA_AMOUNT_MISSING");
  });

  it("las fórmulas se declaran pero no se evalúan todavía", () => {
    // Un intérprete a medio hacer en algo que calcula facturas es peor que
    // no tenerlo: se avisa y el servicio va a revisión manual.
    const r = calcularExtra({ ...kmAdicional, calculationType: "FORMULA" });
    expect(esError(r) && r.error).toBe("FORMULA_NOT_SUPPORTED");
  });

  it("un extra fijo no depende de las unidades", () => {
    const gestion: Extra = {
      id: 9, code: "ADMIN_FEE", name: "Gastos administrativos",
      calculationType: "FIXED", amount: "12.50",
    };
    const r = calcularExtra(gestion, { unidades: 99 });
    if (esError(r)) throw new Error(r.error);
    expect(r.cantidad).toBe(1);
    expect(formatear(r.total)).toBe("12.50");
  });

  it("las líneas se suman sin arrastrar error", () => {
    const lineas = [
      calcularExtra(kmAdicional, { unidades: 25 }),
      calcularExtra(neumaticoAdicional, { unidades: 1 }),
      calcularExtra(tiempoDiurno, { unidades: 30 }),
    ].filter((l) => !esError(l)) as any[];
    expect(formatear(sumarExtras(lineas))).toBe("116.25"); // 31,25 + 60 + 25
  });
});
