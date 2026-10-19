import { describe, expect, it } from "vitest";
import { minutosDeLaCita } from "./duracionDeCita";

describe("minutosDeLaCita", () => {
  it("lo tecleado manda sobre la plantilla", () => {
    expect(minutosDeLaCita(180, 30)).toBe(180);
    expect(minutosDeLaCita("180", 30)).toBe(180);
  });

  it("sin nada tecleado, la plantilla; sin plantilla, el valor por defecto", () => {
    expect(minutosDeLaCita("", 30)).toBe(30);
    expect(minutosDeLaCita(undefined, 30)).toBe(30);
    expect(minutosDeLaCita(null, null)).toBe(45);
    expect(minutosDeLaCita("", 0, 60)).toBe(60);
  });

  it("basura o cero no cuentan como tecleado", () => {
    expect(minutosDeLaCita("abc", 30)).toBe(30);
    expect(minutosDeLaCita(0, 30)).toBe(30);
    expect(minutosDeLaCita(-10, 30)).toBe(30);
  });

  it("nunca menos de 15 minutos, y sin decimales", () => {
    expect(minutosDeLaCita(5, 30)).toBe(15);
    expect(minutosDeLaCita("", 5)).toBe(15);
    expect(minutosDeLaCita(47.6, 30)).toBe(48);
  });
});
