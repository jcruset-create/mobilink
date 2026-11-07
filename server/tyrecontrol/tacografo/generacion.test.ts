import { describe, expect, it } from "vitest";

import { generacionDeTacografo } from "./generacion.ts";

/**
 * Las versiones de abajo no son inventadas: son las que hay en las 1.744
 * intervenciones de producción, con el número de veces que aparece cada una.
 */
describe("generacionDeTacografo()", () => {
  describe("digital, el reglamento viejo", () => {
    it.each([
      ["12013", "DTCO 1.2 · digital"],
      ["13043", "DTCO 1.3 · digital"],
      ["14020", "DTCO 1.4 · digital"],
      ["20030", "DTCO 2.0 · digital"],
      ["21010", "DTCO 2.1 · digital"],
      ["22023", "DTCO 2.2 · digital"],
      ["30037", "DTCO 3.0 · digital"],
      ["30041", "DTCO 3.0 · digital"],
    ])("%s es %s", (version, etiqueta) => {
      const g = generacionDeTacografo(version, "VDO");
      expect(g.generacion).toBe("digital");
      expect(g.etiqueta).toBe(etiqueta);
    });
  });

  /*
   * La frontera. De 962 intervenciones de VDO con versión, el GNSS y el DSRC
   * solo aparecen en las 4.x: 23 de 23. En las 905 de 0.x a 3.x, ninguna.
   */
  describe("inteligente, que es lo que lleva GNSS y DSRC", () => {
    it("40xxx es de primera generación (desde 15/06/2019)", () => {
      const g = generacionDeTacografo("40042", "VDO");
      expect(g.generacion).toBe("inteligente_v1");
      expect(g.etiqueta).toBe("DTCO 4.0 · inteligente 1.ª gen.");
      expect(g.detalle).toContain("15/06/2019");
    });

    it("41xxx es de segunda (desde 21/08/2023)", () => {
      const g = generacionDeTacografo("41026", "VDO");
      expect(g.generacion).toBe("inteligente_v2");
      expect(g.etiqueta).toBe("DTCO 4.1 · inteligente 2.ª gen.");
      expect(g.detalle).toContain("21/08/2023");
    });

    it("y 40073 y 41041 caen donde tienen que caer", () => {
      expect(generacionDeTacografo("40073", "VDO").generacion).toBe("inteligente_v1");
      expect(generacionDeTacografo("41041", "VDO").generacion).toBe("inteligente_v2");
    });
  });

  /*
   * El caso que dio pie a esto: `1381.4521402002` tiene un 4 detrás de 1381 y
   * NO es inteligente. La referencia es el número de pieza, no la generación,
   * así que aquí solo entra la versión.
   */
  it("la referencia no pinta nada: 1381.4521402002 es un 3.0", () => {
    expect(generacionDeTacografo("30037", "VDO").etiqueta).toBe("DTCO 3.0 · digital");
  });

  describe("lo que no se adivina", () => {
    /*
     * Stoneridge numera distinto —`PABF.S0L`, `2424.S0L`, `1214.s09`— y ahí
     * el primer dígito no significa lo mismo. Decir «2.ª generación» porque
     * una versión empieza por 2 sería inventárselo.
     */
    it.each(["PABF.S0L", "2424.S0L", "1214.s09", "012.00E"])(
      "«%s» no se clasifica con la regla de VDO", (version) => {
        const g = generacionDeTacografo(version, "STONERIDGE");
        expect(g.generacion).toBe("desconocida");
        expect(g.etiqueta).toContain(version);
      });

    it("ni aunque no se sepa el fabricante, si la versión no tiene su forma", () => {
      expect(generacionDeTacografo("2424.S0L", null).generacion).toBe("desconocida");
    });

    it("sin versión no se inventa nada", () => {
      for (const v of [null, undefined, "", "   "]) {
        const g = generacionDeTacografo(v, "VDO");
        expect(g.generacion).toBe("desconocida");
        expect(g.etiqueta).toBe("—");
      }
    });

    // Un VDO con cinco dígitos se clasifica aunque el fabricante venga con el
    // nombre nuevo: el impreso de hoy pone «Aumovio».
    it("«Aumovio» y «Continental» son VDO a estos efectos", () => {
      expect(generacionDeTacografo("41026", "Aumovio Germany GmbH").generacion).toBe("inteligente_v2");
      expect(generacionDeTacografo("30041", "Continental").generacion).toBe("digital");
    });
  });
});
