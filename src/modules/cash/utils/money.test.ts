/**
 * Formato de la fecha contable.
 *
 * Sale aparte porque el fallo fue justo ese: la pantalla de Informes enseñaba
 * «2026-08-18T00:00:00.000Z» en una columna que solo quiere el día, y el
 * Histórico lo recortaba por su cuenta con un `slice` suelto. Una función y una
 * prueba evitan que vuelvan a divergir.
 */

import { describe, expect, it } from "vitest";
import { fechaJornada } from "./money";

describe("fecha de la jornada", () => {
  it("recorta el timestamp que devuelve el driver y lo escribe como se lee aquí", () => {
    expect(fechaJornada("2026-08-18T00:00:00.000Z")).toBe("18/08/2026");
  });

  it("acepta la fecha ya recortada", () => {
    expect(fechaJornada("2026-08-18")).toBe("18/08/2026");
  });

  it("no la pasa por la zona horaria: un día del calendario no es un instante", () => {
    // Con `new Date("2026-01-01")` y un navegador en UTC−3 esto daría el 31/12.
    expect(fechaJornada("2026-01-01T00:00:00.000Z")).toBe("01/01/2026");
  });

  it("sin fecha, o con basura, no revienta", () => {
    expect(fechaJornada(null)).toBe("");
    expect(fechaJornada(undefined)).toBe("");
    expect(fechaJornada("")).toBe("");
    expect(fechaJornada("mañana")).toBe("mañana");
  });
});
