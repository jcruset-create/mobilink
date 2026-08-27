import { describe, expect, it } from "vitest";
import { colaIban, formatearIban, ibanValido, normalizarIban } from "./bankaccount.ts";

describe("cuenta bancaria", () => {
  it("normaliza como se dicta, no como se teclea", () => {
    expect(normalizarIban("es91 2100 0418 4502 0005 1332")).toBe("ES9121000418450200051332");
    expect(normalizarIban("ES91-2100-0418-4502-0005-1332")).toBe("ES9121000418450200051332");
  });

  it("acepta IBAN español correcto", () => {
    expect(ibanValido("ES91 2100 0418 4502 0005 1332")).toBe(true);
    expect(ibanValido("ES9121000418450200051332")).toBe(true);
  });

  it("caza el dígito bailado, que es lo que de verdad pasa", () => {
    // Mismo IBAN con un número cambiado: misma pinta, control roto.
    expect(ibanValido("ES91 2100 0418 4502 0005 1333")).toBe(false);
    expect(ibanValido("ES92 2100 0418 4502 0005 1332")).toBe(false);
  });

  it("rechaza longitudes y formas imposibles", () => {
    expect(ibanValido("ES91 2100 0418 4502 0005")).toBe(false); // corto
    expect(ibanValido("ES91 2100 0418 4502 0005 1332 99")).toBe(false); // largo
    expect(ibanValido("2100 0418 4502 0005 1332")).toBe(false); // sin país
    expect(ibanValido("")).toBe(false);
    expect(ibanValido("ESPAÑA")).toBe(false);
  });

  it("vale para otros países, que alguna empresa los tiene", () => {
    expect(ibanValido("PT50 0002 0123 1234 5678 9015 4")).toBe(true);
    expect(ibanValido("DE89 3704 0044 0532 0130 00")).toBe(true);
  });

  it("se enseña en grupos de cuatro y se resume por la cola", () => {
    expect(formatearIban("ES9121000418450200051332")).toBe("ES91 2100 0418 4502 0005 1332");
    expect(colaIban("ES9121000418450200051332")).toBe("···1332");
    expect(colaIban("123")).toBe("123");
  });
});
