import { describe, expect, it } from "vitest";
import { bloqueoQueChoca, bloqueosDelDia, normalizarBloqueos, textoDeBloqueo, validarBloqueo } from "./bloqueosDeArea";

const jueves = { area: "tacografo", date: "2026-11-26", start: "08:30", end: "13:30", label: "Formación" } as const;

describe("normalizarBloqueos", () => {
  it("acepta lo bueno, tira lo malo y no repite", () => {
    const r = normalizarBloqueos([
      jueves,
      { ...jueves },
      { area: "nave", date: "2026-11-26", start: "08:30", end: "13:30" },
      { area: "camion", date: "26/11/2026", start: "08:30", end: "13:30" },
      { area: "camion", date: "2026-11-26", start: "13:30", end: "08:30" },
      { area: "camion", date: "2026-11-25", start: "15:00", end: "18:30" },
    ]);
    expect(r.map((b) => `${b.date} ${b.area}`)).toEqual(["2026-11-25 camion", "2026-11-26 tacografo"]);
    expect(normalizarBloqueos(undefined)).toEqual([]);
  });
});

describe("bloqueoQueChoca", () => {
  const lista = normalizarBloqueos([jueves]);
  it("el caso pedido: tacógrafo el jueves 26/11 por la mañana", () => {
    expect(bloqueoQueChoca(lista, "tacografo", "2026-11-26", "09:00", "10:00")).toMatchObject({ area: "tacografo" });
    // Empieza antes y acaba dentro, también choca.
    expect(bloqueoQueChoca(lista, "tacografo", "2026-11-26", "08:00", "09:00")).not.toBeNull();
  });
  it("otra área, otro día o por la tarde: libre", () => {
    expect(bloqueoQueChoca(lista, "camion", "2026-11-26", "09:00", "10:00")).toBeNull();
    expect(bloqueoQueChoca(lista, "tacografo", "2026-11-27", "09:00", "10:00")).toBeNull();
    expect(bloqueoQueChoca(lista, "tacografo", "2026-11-26", "15:00", "16:00")).toBeNull();
    // Justo en el borde no choca.
    expect(bloqueoQueChoca(lista, "tacografo", "2026-11-26", "13:30", "14:30")).toBeNull();
  });
  it("bloqueosDelDia y texto", () => {
    expect(bloqueosDelDia(lista, "2026-11-26")).toHaveLength(1);
    expect(bloqueosDelDia(lista, "2026-11-27")).toHaveLength(0);
    expect(textoDeBloqueo(lista[0])).toBe("Tacógrafo bloqueado de 08:30 a 13:30: Formación");
  });
});

describe("validarBloqueo", () => {
  it("pide área, fecha y horas en orden", () => {
    expect(validarBloqueo({})).toBe("Elige el área.");
    expect(validarBloqueo({ area: "tacografo" })).toBe("Elige la fecha.");
    expect(validarBloqueo({ area: "tacografo", date: "2026-11-26", start: "09:00" })).toBe("Pon la hora de inicio y la de fin.");
    expect(validarBloqueo({ area: "tacografo", date: "2026-11-26", start: "13:00", end: "09:00" })).toBe("La hora de fin tiene que ser posterior a la de inicio.");
    expect(validarBloqueo(jueves)).toBeNull();
  });
});
