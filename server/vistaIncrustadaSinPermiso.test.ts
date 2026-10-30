import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Dentro de WorkPlanner, una pantalla sin permiso lo DICE.
 *
 * Antes la rama `if (view === "agenda2" && canView(…))` no entraba y la
 * ejecución seguía hasta la pantalla operativa de abajo: salía el bloque de
 * entradas rápidas y nada más. Parecía la agenda rota, y era un permiso que
 * faltaba. El guarda comprueba que el corte sigue puesto y ANTES de las ramas.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const PANEL = readFileSync(`${RAIZ}src/SeaTarragonaV1.tsx`, "utf8");

describe("vista incrustada sin permiso", () => {
  it("hay un corte que avisa en vez de caer a otra pantalla", () => {
    expect(PANEL).toContain("if (embebido && !puedeAbrirVistaIncrustada(view, canView)) {");
    expect(PANEL).toContain("No tienes acceso a esta pantalla");
  });

  it("el corte va antes de las ramas que se quedaban a medias", () => {
    const corte = PANEL.indexOf("!puedeAbrirVistaIncrustada(view, canView)");
    expect(corte).toBeGreaterThan(0);
    for (const rama of [
      'if (view === "tecnicos" && canView("tecnicos"))',
      'if (view === "operarios" && canView("operarios"))',
      'if (view === "agenda2" && (canView("agenda2") || canView("agenda")))',
    ]) {
      expect(PANEL.indexOf(rama), rama).toBeGreaterThan(corte);
    }
  });
});
