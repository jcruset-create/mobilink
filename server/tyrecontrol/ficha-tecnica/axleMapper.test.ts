import { describe, it, expect } from "vitest";
import { calcularConfiguracion, avisosCoherencia } from "./axleMapper.ts";
import type { EjeDetectado, ResultadoOcr } from "./ocrService.ts";

/** Construye un ResultadoOcr mínimo con solo los ejes y la nomenclatura que interesan al test. */
function ocr(ejes: EjeDetectado[], configConvencional: string | null = null): ResultadoOcr {
  return { campos: [], ejes, config_convencional: configConvencional, observaciones: null, confianza: 0.9 };
}

describe("calcularConfiguracion — casos obligatorios", () => {
  it("tractora 2 ejes (4x2 fabricante) → 2x4", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 2, directriz: true, motriz: false },
        { posicion: 2, ruedas: 4, directriz: false, motriz: true },
      ], "4x2"),
      "tractora",
    );
    expect(r.configuracion).toBe("2x4");
    expect(r.motivoPendiente).toBeUndefined();
  });

  it("tractora 3 ejes con elevable (6x2 fabricante) → 2x2x4", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 2, directriz: true, motriz: false },
        { posicion: 2, ruedas: 2, directriz: false, motriz: false, elevable: true },
        { posicion: 3, ruedas: 4, directriz: false, motriz: true },
      ], "6x2"),
      "tractora",
    );
    expect(r.configuracion).toBe("2x2x4");
  });

  it("tractora 3 ejes doble tracción (6x4 fabricante) → 2x4x4", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 2, directriz: true, motriz: false },
        { posicion: 2, ruedas: 4, directriz: false, motriz: true },
        { posicion: 3, ruedas: 4, directriz: false, motriz: true },
      ], "6x4"),
    );
    expect(r.configuracion).toBe("2x4x4");
  });

  it("semirremolque 3 ejes rueda simple → 2x2x2", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 2 },
        { posicion: 2, ruedas: 2 },
        { posicion: 3, ruedas: 2 },
      ]),
      "semirremolque",
    );
    expect(r.configuracion).toBe("2x2x2");
  });

  it("semirremolque 3 ejes rueda gemela → 4x4x4", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 4 },
        { posicion: 2, ruedas: 4 },
        { posicion: 3, ruedas: 4 },
      ]),
      "semirremolque",
    );
    expect(r.configuracion).toBe("4x4x4");
  });

  it("rígido de 4 ejes → 2x2x4x4", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 2, directriz: true },
        { posicion: 2, ruedas: 2, directriz: true },
        { posicion: 3, ruedas: 4, motriz: true },
        { posicion: 4, ruedas: 4, motriz: true },
      ]),
    );
    expect(r.configuracion).toBe("2x2x4x4");
  });
});

describe("calcularConfiguracion — no inventa datos", () => {
  it("sin ejes en el documento → pendiente de validar, no null por sorpresa silenciosa", () => {
    const r = calcularConfiguracion(ocr([]));
    expect(r.configuracion).toBeNull();
    expect(r.motivoPendiente).toMatch(/no indica los ejes/i);
  });

  it("eje sin ruedas legibles → pendiente, no se infiere un valor a ciegas", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 2, directriz: true },
        { posicion: 2, ruedas: null, motriz: true },
      ]),
      "tractora",
    );
    expect(r.configuracion).toBeNull();
    expect(r.motivoPendiente).toMatch(/eje 2/i);
  });

  it("valor de ruedas no estándar (ej. 3) se descarta a 0 y queda pendiente", () => {
    const r = calcularConfiguracion(ocr([{ posicion: 1, ruedas: 3 as any }]));
    expect(r.configuracion).toBeNull();
  });

  it("semirremolque sin dato explícito de ruedas infiere simple (única deducción segura)", () => {
    const r = calcularConfiguracion(
      ocr([{ posicion: 1, ruedas: null }, { posicion: 2, ruedas: null }]),
      "semirremolque",
    );
    expect(r.configuracion).toBe("2x2");
  });

  it("tractora sin dato explícito de ruedas NO infiere nada (solo semirremolque/remolque lo hacen)", () => {
    const r = calcularConfiguracion(
      ocr([{ posicion: 1, ruedas: null }, { posicion: 2, ruedas: null }]),
      "tractora",
    );
    expect(r.configuracion).toBeNull();
  });
});

describe("calcularConfiguracion — orden y datos por eje", () => {
  it("ordena los ejes de delante hacia atrás aunque el OCR los devuelva desordenados", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 2, ruedas: 4 },
        { posicion: 1, ruedas: 2 },
      ]),
    );
    expect(r.configuracion).toBe("2x4");
    expect(r.ejes.map((e) => e.posicion)).toEqual([1, 2]);
  });

  it("conserva medida, índice de carga y código de velocidad de cada eje", () => {
    const r = calcularConfiguracion(
      ocr([{ posicion: 1, ruedas: 2, medida: "315/70R22.5", indice_carga: "154", codigo_velocidad: "L" }]),
    );
    expect(r.ejes[0]).toMatchObject({ medida: "315/70R22.5", indice_carga: "154", codigo_velocidad: "L" });
  });

  it("conserva la nomenclatura convencional tal cual, aunque no se pueda calcular la configuración", () => {
    const r = calcularConfiguracion(ocr([], "6x2"));
    expect(r.configuracionConvencional).toBe("6x2");
    expect(r.configuracion).toBeNull();
  });
});

describe("avisosCoherencia", () => {
  it("sin discrepancias no genera avisos", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 2, motriz: false },
        { posicion: 2, ruedas: 4, motriz: true },
      ], "4x2"),
    );
    expect(avisosCoherencia(r)).toEqual([]);
  });

  it("avisa si el número de ejes leído no cuadra con la nomenclatura del fabricante", () => {
    const r = calcularConfiguracion(
      ocr([{ posicion: 1, ruedas: 2 }, { posicion: 2, ruedas: 4 }], "6x2"), // 6x2 sugiere 3 ejes
    );
    const avisos = avisosCoherencia(r);
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos[0]).toMatch(/3 ejes/);
  });

  it("avisa si el número de ejes motrices no cuadra", () => {
    const r = calcularConfiguracion(
      ocr([
        { posicion: 1, ruedas: 2, motriz: false },
        { posicion: 2, ruedas: 4, motriz: true },
        { posicion: 3, ruedas: 4, motriz: false }, // fabricante dice 6x4 (2 motrices), solo hay 1
      ], "6x4"),
    );
    const avisos = avisosCoherencia(r);
    expect(avisos.some((a) => /motriz/i.test(a))).toBe(true);
  });

  it("sin nomenclatura convencional no hay nada que comparar", () => {
    const r = calcularConfiguracion(ocr([{ posicion: 1, ruedas: 2 }]));
    expect(avisosCoherencia(r)).toEqual([]);
  });
});
