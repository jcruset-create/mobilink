import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Horarios y turnos: solo el superadministrador.
 *
 * Es control de la empresa entera, no operación de un taller: ni el
 * administrador del panel ni el admin de Administración entran. Esconder la
 * entrada del menú no es la cerradura; la cerradura es que TODAS las rutas
 * de /api/horarios pasen por el guarda y que el guarda exija es_superadmin.
 */
const RAIZ = new URL("../", import.meta.url).pathname;
const SERVIDOR = readFileSync(`${RAIZ}server/index.ts`, "utf8");

describe("horarios: solo superadministrador", () => {
  it("todas las rutas de /api/horarios llevan requireSuperadminApp", () => {
    const rutas = [...SERVIDOR.matchAll(/app\.(get|put|post|delete)\("\/api\/horarios[^"]*",\s*([A-Za-z]+)/g)];
    expect(rutas.length).toBeGreaterThanOrEqual(6);
    for (const r of rutas) expect(r[2]).toBe("requireSuperadminApp");
  });

  it("el guarda exige esSuperadmin, no solo administrador", () => {
    const i = SERVIDOR.indexOf("async function requireSuperadminApp(");
    expect(i).toBeGreaterThan(0);
    const bloque = SERVIDOR.slice(i, i + 700);
    expect(bloque).toContain("verificarAdminApp(req)");
    expect(bloque).toContain("if (!admin.esSuperadmin)");
    expect(bloque).toContain("403");
  });
});
