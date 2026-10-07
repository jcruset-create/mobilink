import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * El uuid de una central no puede salir solo del reloj.
 *
 * `cc-${now}-${now % 100000}` tenía las dos mitades sacadas del MISMO
 * `Date.now()`: la segunda no añadía entropía, y dos centrales creadas en el
 * mismo milisegundo chocaban contra el UNIQUE de la columna. La CI lo cazaba
 * de vez en cuando —la prueba crea dos centrales seguidas— y en producción
 * serían dos altas simultáneas con un 500 para la segunda.
 */
describe("uuid de una central", () => {
  const fuente = readFileSync(new URL("./onboarding.ts", import.meta.url), "utf8");

  it("lleva algo que no es la hora", () => {
    expect(fuente).toContain("randomUUID()");
    expect(fuente).not.toContain("Math.floor(now % 100000)");
  });

  it("dos seguidos en el mismo milisegundo no se repiten", () => {
    // La misma forma que usa el módulo, con el reloj congelado a propósito.
    const ahora = 1_791_404_887_146;
    const hacer = () => `cc-${ahora}-${crypto.randomUUID().slice(0, 8)}`;
    const vistos = new Set(Array.from({ length: 500 }, hacer));
    expect(vistos.size).toBe(500);
  });
});
