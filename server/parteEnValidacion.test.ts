import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Enganchar un parte AÑADE; no reescribe el trabajo.
 *
 * El riesgo de esta pantalla es que un papel escaneado por una IA pise lo que
 * decidió una persona: la operación, el área, la matrícula o el técnico
 * propuesto. Este guarda comprueba que el camino de guardado pasa por el
 * módulo que solo devuelve los campos del parte, y que no se cuela nada más.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const PANEL = readFileSync(`${RAIZ}src/SeaTarragonaV1.tsx`, "utf8");
const MODULO = readFileSync(`${RAIZ}src/modules/parteParaTrabajo.ts`, "utf8");
const MODAL = readFileSync(`${RAIZ}src/components/ParteDeTrabajoModal.tsx`, "utf8");

const cuerpo = (() => {
  const i = PANEL.indexOf("async function adjuntarParteAValidacion(");
  const j = PANEL.indexOf("\n/**", i + 10);
  return PANEL.slice(i, j);
})();

describe("enganchar un parte a una entrada en validación", () => {
  it("solo toca trabajos en validación", () => {
    expect(cuerpo.length).toBeGreaterThan(0);
    expect(cuerpo).toContain('job.status !== "validacion"');
  });

  it("espera al servidor antes de darlo por hecho", () => {
    expect(cuerpo.indexOf("await updateJobInBackend(")).toBeGreaterThan(0);
    expect(cuerpo.indexOf("await updateJobInBackend(")).toBeLessThan(cuerpo.indexOf("setJobs("));
  });

  it("el módulo del parte no devuelve nada que pise la decisión de una persona", () => {
    // Solo lo que `camposDeParte` DEVUELVE: el resto del fichero lee esos
    // campos (p. ej. la matrícula para sugerir línea) y eso no escribe nada.
    const i = MODULO.indexOf("export function camposDeParte(");
    const j = MODULO.indexOf("\n}", MODULO.indexOf("return {", i));
    const devuelve = MODULO.slice(MODULO.indexOf("return {", i), j);
    expect(devuelve.length).toBeGreaterThan(0);

    for (const prohibida of ["area:", "template:", "quickEntryLabel:", "quickEntryMode:", "plate:", "assignedNames:", "status:"]) {
      expect(devuelve, prohibida).not.toContain(prohibida);
    }
    // Y sí devuelve lo que es del parte.
    expect(devuelve).toContain("ptNumero");
    expect(devuelve).toContain("materiales");
  });

  it("lo leído por la IA se enseña antes de guardar", () => {
    expect(MODAL).toContain("Lo que ha leído la IA");
    // Y el lector es el de siempre, no una segunda interpretación del papel.
    expect(MODAL).toContain("/api/partes-trabajo/leer");
    expect(MODAL).toContain("parteATrabajos({");
  });
});
