import { describe, expect, it } from "vitest";
import {
  TODOS_LOS_TALLERES,
  estadoCuentaEnTaller,
  tecnicosDelTaller,
} from "./tecnicosPorTaller";
import { DEFAULT_WORKSHOP_ID, WORKSHOPS } from "./workshops";

const OTRO = WORKSHOPS.find((w) => w.id !== DEFAULT_WORKSHOP_ID)!;

const fichas = [
  { name: "Ramón", workshopId: DEFAULT_WORKSHOP_ID },
  { name: "José", workshopId: OTRO.id },
  { name: "Iván" },                                   // sin taller
  { name: "Albert", workshopId: OTRO.id, activo: false }, // de baja en la empresa
  { name: "PROVA", workshopId: OTRO.id },             // de prueba
];

describe("tecnicosDelTaller", () => {
  it("en un taller solo salen los suyos", () => {
    expect(tecnicosDelTaller(fichas, OTRO.id).map((t) => t.nombre)).toEqual(["José"]);
  });

  it("quien no tiene taller cuenta en el de por defecto, no en los dos", () => {
    expect(tecnicosDelTaller(fichas, DEFAULT_WORKSHOP_ID).map((t) => t.nombre)).toEqual(["Ramón", "Iván"]);
    expect(tecnicosDelTaller(fichas, OTRO.id).map((t) => t.nombre)).not.toContain("Iván");
  });

  it("con «todos» salen los de los dos, cada uno con el suyo", () => {
    const todos = tecnicosDelTaller(fichas, TODOS_LOS_TALLERES);
    expect(todos.map((t) => t.nombre)).toEqual(["Ramón", "José", "Iván"]);
    expect(todos.find((t) => t.nombre === "José")!.taller).toBe(OTRO.shortName);
  });

  it("los dados de baja y los de prueba no salen en ningún caso", () => {
    for (const taller of [DEFAULT_WORKSHOP_ID, OTRO.id, TODOS_LOS_TALLERES]) {
      const nombres = tecnicosDelTaller(fichas, taller).map((t) => t.nombre);
      expect(nombres, taller).not.toContain("Albert");
      expect(nombres, taller).not.toContain("PROVA");
    }
  });
});

describe("estadoCuentaEnTaller", () => {
  it("con «todos» cuentan todos", () => {
    expect(estadoCuentaEnTaller({ workshopId: OTRO.id }, TODOS_LOS_TALLERES)).toBe(true);
  });

  it("un estado de otro taller no cuenta aquí", () => {
    expect(estadoCuentaEnTaller({ workshopId: OTRO.id }, DEFAULT_WORKSHOP_ID)).toBe(false);
  });

  it("un estado viejo sin taller cuenta donde se mire, como antes", () => {
    expect(estadoCuentaEnTaller({}, DEFAULT_WORKSHOP_ID)).toBe(true);
    expect(estadoCuentaEnTaller({ workshopId: null }, OTRO.id)).toBe(true);
  });
});
