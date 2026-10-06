import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Al confirmar una llegada se guarda SOLO la cita que cambia.
 *
 * Mandar la agenda entera agotaba los 8 s del fetch con doscientas citas: el
 * trabajo quedaba creado y la cita sin marcar, y al recargar volvía a
 * «Llegadas». Pasó en el taller con un aviso en pantalla.
 */
describe("confirmScheduledArrival", () => {
  const f = readFileSync(new URL("../src/modules/useScheduledJobs.ts", import.meta.url), "utf8");
  const ini = f.indexOf("async function confirmScheduledArrival(");
  const cuerpo = f.slice(ini, f.indexOf("\n  return {", ini));

  it("guarda solo la cita que cambia, y reintenta una vez", () => {
    expect(cuerpo).toContain("filter((s) => s.id === currentScheduled.id)");
    expect(cuerpo).not.toMatch(/saveScheduledJobsToBackend\(\s*updatedScheduledJobs/);
    expect(cuerpo.split("await saveScheduledJobsToBackend(").length - 1).toBe(2);
  });

  it("el guardado de agenda no va con el tiempo límite por defecto", () => {
    const g = f.slice(f.indexOf("async function saveScheduledJobsToBackend("));
    expect(g.slice(0, 1200)).toContain("30_000");
  });
});
