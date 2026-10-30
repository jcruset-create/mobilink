import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * «Formación» también está protegido en el servidor: un técnico en un curso
 * queda bloqueado al guardar, como con vacaciones. La lista del navegador
 * (src/modules/estadoFormacion.test.ts) y esta tienen que ir a la par.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const SERVIDOR = readFileSync(`${RAIZ}server/index.ts`, "utf8");

describe("formación en el servidor", () => {
  it("está entre los estados protegidos del PUT /api/techs", () => {
    const i = SERVIDOR.indexOf("const protectedStatuses = new Set([");
    expect(i).toBeGreaterThan(0);
    expect(SERVIDOR.slice(i, i + 220)).toContain('"formacion"');
  });
});
