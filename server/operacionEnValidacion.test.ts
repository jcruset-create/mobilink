import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Corregir la operación cambia la operación ENTERA, no el rótulo.
 *
 * El riesgo de esta pantalla es dejar un trabajo que dice una cosa y por
 * dentro es otra: contaría los minutos de la vieja, pediría su competencia y
 * facturaría su precio. Por eso los campos salen de `camposDeOperacion`, que
 * reutiliza los ayudantes de la entrada rápida, y no se escriben a mano aquí.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const PANEL = readFileSync(`${RAIZ}src/SeaTarragonaV1.tsx`, "utf8");

const cuerpo = (() => {
  const i = PANEL.indexOf("async function updateValidationOperacion(");
  const j = PANEL.indexOf("\nfunction updateValidationResponsible(", i);
  return PANEL.slice(i, j);
})();

describe("corregir la operación en validación", () => {
  it("existe y solo toca trabajos en validación", () => {
    expect(cuerpo.length).toBeGreaterThan(0);
    expect(cuerpo).toContain('job.status !== "validacion"');
  });

  it("cambia la operación entera, con el módulo compartido", () => {
    expect(cuerpo).toContain("camposDeOperacion(plantilla, job.quantity)");
  });

  it("retira al técnico que ya no tiene competencia", () => {
    expect(cuerpo).toContain("propuestosQueSiguenValiendo(");
    expect(cuerpo).toContain("canSelectTechManuallyForJob(");
  });

  it("espera al servidor antes de darlo por cambiado", () => {
    expect(cuerpo.indexOf("await updateJobInBackend(")).toBeGreaterThan(0);
    expect(cuerpo.indexOf("await updateJobInBackend(")).toBeLessThan(
      cuerpo.indexOf("Operación corregida en validación")
    );
  });
});
