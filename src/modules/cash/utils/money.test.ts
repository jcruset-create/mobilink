/**
 * Formato de la fecha contable.
 *
 * Sale aparte porque el fallo fue justo ese: la pantalla de Informes enseñaba
 * «2026-08-18T00:00:00.000Z» en una columna que solo quiere el día, y el
 * Histórico lo recortaba por su cuenta con un `slice` suelto. Una función y una
 * prueba evitan que vuelvan a divergir.
 */

import { describe, expect, it } from "vitest";
import { aCentimos, euros, fechaJornada } from "./money";

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

describe("aCentimos con separador de miles", () => {
  /*
   * EL FALLO QUE ESTO ARREGLA, con el importe real que lo destapó: una factura
   * de 1.797,00 € que no se podía registrar. El campo enseñaba «1.797,00 €», el
   * parseo devolvía null, y el botón decía «Confirmar cobro de 0,00 €».
   *
   * Todo lo que llegaba a MIL euros era incobrable desde la pantalla. Por
   * debajo funcionaba, que es por lo que tardó en salir.
   */
  it("lee lo que la propia pantalla escribe", () => {
    expect(aCentimos(euros(179700))).toBe(179700);
    expect(aCentimos(euros(100000))).toBe(100000);
    expect(aCentimos(euros(123456789))).toBe(123456789);
  });

  it("y lo mismo tecleado a mano, con puntos o sin ellos", () => {
    expect(aCentimos("1.797,00")).toBe(179700);
    expect(aCentimos("1797,00")).toBe(179700);
    expect(aCentimos("1.797")).toBe(179700);
    expect(aCentimos("1.234.567,89")).toBe(123456789);
  });

  it("sin coma, tres cifras tras el punto son MILES", () => {
    /* Un importe no tiene tres decimales, así que no hay ambigüedad que valga. */
    expect(aCentimos("1.000")).toBe(100000);
  });

  it("sin coma, una o dos cifras siguen siendo decimales", () => {
    /* Lo de siempre: en el mostrador se teclea «12.50» y tiene que seguir yendo. */
    expect(aCentimos("12.50")).toBe(1250);
    expect(aCentimos("12.5")).toBe(1250);
  });

  it("el punto de los miles tiene que estar DONDE TOCA", () => {
    /*
     * Sin esta comprobación, «17.97,5» se colaría como 1797,50: un factor de
     * cien sobre lo que alguien quiso escribir.
     */
    expect(aCentimos("17.97,5")).toBeNull();
    expect(aCentimos("1.23.456,00")).toBeNull();
  });

  it("el formato inglés se RECHAZA, no se adivina", () => {
    /*
     * «1,797.00» podrían ser 1797 € o 1,79 €. Devolver null y que alguien lo
     * escriba otra vez es barato; equivocarse por un factor de mil, no.
     */
    expect(aCentimos("1,797.00")).toBeNull();
  });

  it("tres cifras tras la COMA no son un importe", () => {
    /*
     * Quien escribe «1,797» pensando en el formato inglés quiere decir 1797 €.
     * Con tres decimales aceptados, eso se leería como 1 € + 797 céntimos =
     * 8,97 €: un error de doscientas veces, en silencio y en un cobro. Se
     * rechaza y que lo escriba otra vez.
     */
    expect(aCentimos("1,797")).toBeNull();
  });

  it("dos comas no es un importe", () => {
    expect(aCentimos("1,79,50")).toBeNull();
  });

  it("los negativos siguen funcionando con miles", () => {
    expect(aCentimos("-1.797,00")).toBe(-179700);
  });
});
