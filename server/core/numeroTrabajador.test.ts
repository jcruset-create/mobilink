import { describe, expect, it } from "vitest";

import { errorDeNumeroTrabajador, normalizarNumeroTrabajador } from "./numeroTrabajador.ts";

describe("normalizarNumeroTrabajador", () => {
  it("quita espacios y pasa a mayúsculas", () => {
    expect(normalizarNumeroTrabajador(" a 15 ")).toBe("A15");
    expect(normalizarNumeroTrabajador("tg-007")).toBe("TG-007");
  });

  it("respeta los ceros a la izquierda: 007 y 7 son números distintos", () => {
    expect(normalizarNumeroTrabajador("007")).toBe("007");
    expect(normalizarNumeroTrabajador(7)).toBe("7");
  });

  it("vacío, espacios o null es quitar el número", () => {
    expect(normalizarNumeroTrabajador("")).toBeNull();
    expect(normalizarNumeroTrabajador("   ")).toBeNull();
    expect(normalizarNumeroTrabajador(null)).toBeNull();
    expect(normalizarNumeroTrabajador(undefined)).toBeNull();
  });
});

describe("errorDeNumeroTrabajador", () => {
  it("acepta letras, cifras, punto, barra y guion", () => {
    for (const ok of ["15", "007", "A15", "TG-15", "2024/3", "R.12"]) {
      expect(errorDeNumeroTrabajador(ok)).toBeNull();
    }
  });

  it("rechaza símbolos raros y que empiece por separador", () => {
    expect(errorDeNumeroTrabajador("15#")).toMatch(/solo admite/);
    expect(errorDeNumeroTrabajador("-15")).toMatch(/solo admite/);
    expect(errorDeNumeroTrabajador("Ñ1")).toMatch(/solo admite/);
  });

  it("rechaza los demasiado largos", () => {
    expect(errorDeNumeroTrabajador("1".repeat(21))).toMatch(/como mucho 20/);
    expect(errorDeNumeroTrabajador("1".repeat(20))).toBeNull();
  });
});
