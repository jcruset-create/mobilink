import { describe, expect, it } from "vitest";

import { leerPestana, otfDeLaPestana } from "./otfPestanas";

const lista = [
  { id: 1, status: "planificada", fechaProgramadaMs: null, createdAtMs: 1 },
  { id: 2, status: "planificada", fechaProgramadaMs: 500, createdAtMs: 2 },
  { id: 3, status: "en_curso", createdAtMs: 3 },
  { id: 4, status: "finalizada", updatedAtMs: 10 },
  { id: 5, status: "cancelada", updatedAtMs: 20 },
  { id: 6, status: "planificada", fechaProgramadaMs: 100, createdAtMs: 6 },
];

describe("pestañas de OTF", () => {
  it("Programadas: planificadas, la fecha más cercana primero y sin fecha al final", () => {
    expect(otfDeLaPestana(lista, "programadas").map((o) => o.id)).toEqual([6, 2, 1]);
  });

  it("Activas: en curso", () => {
    expect(otfDeLaPestana(lista, "activas").map((o) => o.id)).toEqual([3]);
  });

  it("Últimas cerradas: finalizadas y canceladas, la más reciente primero", () => {
    expect(otfDeLaPestana(lista, "cerradas").map((o) => o.id)).toEqual([5, 4]);
  });

  it("sin pestaña (o Nueva OTF), todas", () => {
    expect(otfDeLaPestana(lista, null)).toHaveLength(6);
    expect(otfDeLaPestana(lista, "nueva")).toHaveLength(6);
  });

  it("una pestaña que no existe en la URL se ignora", () => {
    expect(leerPestana("programadas")).toBe("programadas");
    expect(leerPestana("lo-que-sea")).toBeNull();
    expect(leerPestana(null)).toBeNull();
  });
});
