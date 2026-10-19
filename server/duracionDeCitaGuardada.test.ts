import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * La agenda guarda la duración tecleada, no la de la plantilla.
 *
 * El cuadro «Duración prevista» se podía cambiar a mano y el cambio se veía
 * en «Fin previsto», pero al guardar se volvían a calcular los minutos desde
 * la plantilla y la cita se quedaba en 30. Si alguien vuelve a escribir ese
 * cálculo, este test lo dice antes que el taller.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const AGENDA = readFileSync(`${RAIZ}src/components/AgendaView.tsx`, "utf8");

describe("la agenda guarda la duración tecleada", () => {
  it("los minutos de la cita salen de lo tecleado en el cuadro", () => {
    const i = AGENDA.indexOf("const safeEstimatedMinutes =");
    expect(i).toBeGreaterThan(0);
    // Dentro de createScheduledJob, que es el guardado de alta y de edición.
    expect(AGENDA.lastIndexOf("async function createScheduledJob(", i)).toBeGreaterThan(0);
    expect(AGENDA.slice(i, i + 200)).toMatch(/minutosDeLaCita\(\s*draft\.estimatedMinutes/);
  });

  it("no se vuelve a calcular solo desde la plantilla", () => {
    expect(AGENDA).not.toContain("normalizeMinutes(v2Fields.estimatedMinutes");
  });
});
