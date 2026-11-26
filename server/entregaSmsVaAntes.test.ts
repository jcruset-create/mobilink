/**
 * `/api/core/alta/entregas` tiene que montarse ANTES que `/api/core/alta`.
 *
 * El router del encargado tiene un `/:employeeId`: si va primero, se queda con
 * «entregas», contesta «Ese empleado no existe» y la lista de empleados deja de
 * enseñar si el SMS llegó —sin que nada falle a la vista—.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const INDEX = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

describe("el aviso de entrega del SMS del enlace", () => {
  it("se monta, y antes que el router del alta", () => {
    const entregas = INDEX.indexOf('app.use("/api/core/alta/entregas", createEntregaSmsRouter())');
    const alta = INDEX.indexOf('app.use("/api/core/alta", createAltaOperarioAdminRouter())');
    expect(entregas).toBeGreaterThan(-1);
    expect(alta).toBeGreaterThan(-1);
    expect(entregas).toBeLessThan(alta);
  });
});
