/**
 * El mes en curso, que parece trivial hasta que cambia el huso.
 *
 * Lo que se fija aquí es que el tramo no se desplace un día. Un informe de
 * gasto que empieza el 31 de agosto en vez del 1 de septiembre no falla: da un
 * número creíble y equivocado, y solo se descubre cuando alguien lo cuadra
 * contra los arqueos.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mesEnCurso } from "./periodo";

/*
 * El tsconfig del frontend no trae los tipos de Node —aquí no hay ninguno— y
 * `process` solo existe cuando corre vitest. Se declara lo justo en vez de
 * arrastrar `@types/node` a la compilación del navegador por una prueba.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * Se prueba con el huso español puesto a propósito.
 *
 * Con `TZ=UTC` —lo que usa la CI si nadie dice nada— el fallo que esto vigila
 * NO aparece: la medianoche local y la UTC son la misma, y la versión mala
 * pasaría todas las pruebas. Hay que ponerse en el huso de quien usa el
 * programa, que es donde el error existe.
 */
const TZ = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Madrid";
});
afterAll(() => {
  process.env.TZ = TZ;
});

it("el huso de la prueba es el que creemos", () => {
  /*
   * Sin esto, un Node que ignorase `process.env.TZ` dejaría el resto del
   * fichero pasando en verde sin comprobar nada de lo que dice comprobar.
   */
  expect(new Date("2026-09-01T06:00:00Z").getTimezoneOffset()).toBe(-120);
  // Y la versión ingenua, en este huso, se come el primer día:
  expect(new Date(2026, 8, 1).toISOString().slice(0, 10)).toBe("2026-08-31");
});

describe("el mes en curso", () => {
  it("va del día 1 al último, sin comerse el primero", () => {
    // 15 de septiembre de 2026, media mañana.
    expect(mesEnCurso(new Date("2026-09-15T10:00:00Z"))).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-30",
    });
  });

  it("el día 1 a primera hora sigue siendo ese mes, no el anterior", () => {
    /*
     * Este es el caso que rompe la versión ingenua: en Madrid (UTC+2) la
     * medianoche local del 1 de septiembre es el 31 de agosto a las 22:00 UTC.
     */
    expect(mesEnCurso(new Date("2026-09-01T06:00:00Z"))).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-30",
    });
  });

  it("el último día por la noche tampoco se pasa al mes siguiente", () => {
    expect(mesEnCurso(new Date("2026-09-30T20:00:00Z"))).toEqual({
      desde: "2026-09-01",
      hasta: "2026-09-30",
    });
  });

  it("acierta el último día de un mes de 31 y de uno de 30", () => {
    expect(mesEnCurso(new Date("2026-07-10T10:00:00Z")).hasta).toBe("2026-07-31");
    expect(mesEnCurso(new Date("2026-11-10T10:00:00Z")).hasta).toBe("2026-11-30");
  });

  it("y el de febrero, bisiesto o no", () => {
    expect(mesEnCurso(new Date("2026-02-10T10:00:00Z")).hasta).toBe("2026-02-28");
    expect(mesEnCurso(new Date("2028-02-10T10:00:00Z")).hasta).toBe("2028-02-29");
  });

  it("diciembre no se lleva el tramo al año siguiente", () => {
    /* `mes + 1` es 12: el que se olvida de esto acaba pidiendo enero. */
    expect(mesEnCurso(new Date("2026-12-20T10:00:00Z"))).toEqual({
      desde: "2026-12-01",
      hasta: "2026-12-31",
    });
  });
});
