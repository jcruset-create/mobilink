import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La corrección de matrícula en validación NO puede ir por POST /api/jobs.
 *
 * Ese endpoint devuelve 409 ante cualquier cambio de matrícula sobre un id que
 * ya existe —es el guarda contra colisiones de id— y la primera versión de la
 * corrección lo usaba: la matrícula volvía sola y, al autorizar, el 409 tumbaba
 * también la autorización. Dos veces lo intentó el taller antes de avisar.
 */
describe("corregir matrícula en validación", () => {
  const fuente = readFileSync(new URL("../src/SeaTarragonaV1.tsx", import.meta.url), "utf8");
  const ini = fuente.indexOf("function updateValidationPlate(");
  const fin = fuente.indexOf("\nfunction ", ini + 1);
  const cuerpo = fuente.slice(ini, fin);

  it("existe y va por PUT /api/jobs/:id", () => {
    expect(ini).toBeGreaterThan(0);
    expect(cuerpo).toContain("updateJobInBackend(");
  });

  it("no va por POST /api/jobs, que rechaza el cambio con 409", () => {
    expect(cuerpo).not.toContain("saveJobToBackend(");
  });

  it("espera la respuesta antes de dar la matrícula por cambiada", () => {
    expect(cuerpo.indexOf("await updateJobInBackend(")).toBeLessThan(cuerpo.indexOf("Matrícula corregida"));
  });
});
