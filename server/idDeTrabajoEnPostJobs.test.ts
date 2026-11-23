import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * POST /api/jobs no puede inventarse el id con `Date.now()`: `jobs.id` es
 * SERIAL (INTEGER de cuatro bytes) y la hora en milisegundos no cabe. Pasó
 * en producción («Error guardando trabajo» desde Partes de trabajo). Cuando
 * no viene un id válido, lo asigna la tabla (server/core/idDeTrabajo.ts).
 */
const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("POST /api/jobs y el id", () => {
  it("no usa Date.now() como id de trabajo", () => {
    const bloque = src.slice(src.indexOf('app.post("/api/jobs"'), src.indexOf('app.post("/api/jobs"') + 2500);
    expect(bloque).not.toMatch(/job\.id \?\? Date\.now\(\)/);
    expect(bloque).toMatch(/siguienteIdDeTrabajo\(db\)/);
    expect(bloque).toMatch(/2147483647/);
  });
});
