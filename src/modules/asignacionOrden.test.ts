import { describe, expect, it } from "vitest";
import { desempatePorArea } from "./assignment";
import { createTech } from "./techConfig";
import { AREA_META } from "./workshopConstants";

/**
 * El desempate por área tenía un fallo silencioso: `indexOf` devuelve -1 para
 * quien no está en la lista de nombres del código, así que un técnico recién
 * dado de alta adelantaba a toda la plantilla en cualquier empate.
 */
describe("desempatePorArea", () => {
  it("respeta el orden de la lista para la plantilla histórica", () => {
    const [primero, segundo] = AREA_META.camion.order;

    expect(desempatePorArea("camion", primero)).toBeLessThan(
      desempatePorArea("camion", segundo)
    );
  });

  it("un técnico nuevo va al final, no al principio", () => {
    const conocido = AREA_META.camion.order[0];

    expect(desempatePorArea("camion", "Fichaje Nuevo")).toBeGreaterThan(
      desempatePorArea("camion", conocido)
    );
  });

  it("dos desconocidos empatan y se resuelve por nombre, no por azar", () => {
    expect(desempatePorArea("movil", "Zoe")).toBe(
      desempatePorArea("movil", "Ana")
    );
  });
});

describe("createTech", () => {
  it("un alta nueva entra sin competencias: las decide el supervisor", () => {
    const nuevo = createTech("Fichaje Nuevo");

    expect(nuevo.competencies.camion.responsable).toBe(false);
    expect(nuevo.competencies.movil.responsable).toBe(false);
    expect(nuevo.priorities.camion.responsable).toBe(99);
  });

  it("no hereda capacidades por llamarse como alguien de la plantilla", () => {
    // Antes, un fichaje que se llamara "David" heredaba las competencias del
    // David histórico solo por el nombre.
    const homonimo = createTech("David");

    expect(homonimo.competencies.movil.responsable).toBe(false);
  });

  it("la plantilla histórica sí conserva su configuración de origen", () => {
    const semilla = createTech("David", "disponible", { semilla: true });

    expect(semilla.competencies.movil.responsable).toBe(true);
  });
});
