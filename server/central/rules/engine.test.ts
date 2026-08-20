/**
 * Pruebas del motor de reglas. Sin base de datos: son funciones puras.
 *
 * Lo que se fija aquí es la jerarquía, que es la razón de ser del motor, y el
 * criterio de deduplicación, que es lo que separa una bandeja de incidencias
 * útil de una que nadie mira.
 */

import { describe, expect, it } from "vitest";
import { evaluarCaja, evaluarRed, reglaAplicable, type EstadoCaja, type Regla } from "./engine.ts";

const ZONA = "z1";
const CENTRO = "c1";

const caja: EstadoCaja = { registerId: 7, centroId: CENTRO, zonaId: ZONA };

function regla(over: Partial<Regla> & Pick<Regla, "id" | "ambito">): Regla {
  return {
    tipo: "DESCUADRE",
    ambitoId: null,
    umbral: 2000,
    activa: true,
    ...over,
  } as Regla;
}

describe("jerarquía de reglas", () => {
  it("la regla de la caja tapa a la del centro, la zona y la empresa", () => {
    const reglas = [
      regla({ id: "a", ambito: "EMPRESA", umbral: 1000 }),
      regla({ id: "b", ambito: "ZONA", ambitoId: ZONA, umbral: 2000 }),
      regla({ id: "c", ambito: "CENTRO", ambitoId: CENTRO, umbral: 3000 }),
      regla({ id: "d", ambito: "CAJA", ambitoId: "7", umbral: 9000 }),
    ];
    expect(reglaAplicable(reglas, "DESCUADRE", caja)?.id).toBe("d");
  });

  it("sin regla de caja manda la del centro, y sin ella la de la zona", () => {
    const conCentro = [
      regla({ id: "a", ambito: "EMPRESA", umbral: 1000 }),
      regla({ id: "b", ambito: "ZONA", ambitoId: ZONA }),
      regla({ id: "c", ambito: "CENTRO", ambitoId: CENTRO }),
    ];
    expect(reglaAplicable(conCentro, "DESCUADRE", caja)?.id).toBe("c");

    const sinCentro = conCentro.filter((r) => r.ambito !== "CENTRO");
    expect(reglaAplicable(sinCentro, "DESCUADRE", caja)?.id).toBe("b");
  });

  it("una regla de otra zona u otro centro no alcanza a esta caja", () => {
    const ajenas = [
      regla({ id: "a", ambito: "ZONA", ambitoId: "otra" }),
      regla({ id: "b", ambito: "CENTRO", ambitoId: "otro" }),
      regla({ id: "c", ambito: "CAJA", ambitoId: "99" }),
    ];
    expect(reglaAplicable(ajenas, "DESCUADRE", caja)).toBeNull();
  });

  /*
   * El caso que motiva la jerarquía entera: la empresa avisa a partir de 20 €,
   * pero la gasolinera mueve diez veces más dinero y con ese umbral saltaría
   * cada día, hasta que nadie lo mira.
   */
  it("el umbral del centro se usa en lugar del de la empresa", () => {
    const reglas = [
      regla({ id: "empresa", ambito: "EMPRESA", umbral: 2000 }),
      regla({ id: "gasolinera", ambito: "CENTRO", ambitoId: CENTRO, umbral: 10000 }),
    ];

    // 50 € de descuadre: pasa el umbral de la empresa, no el de la gasolinera.
    const incidencias = evaluarCaja(reglas, { ...caja, descuadreCentimos: -5000, sessionId: 1 });
    expect(incidencias).toHaveLength(0);

    const gordo = evaluarCaja(reglas, { ...caja, descuadreCentimos: -15000, sessionId: 1 });
    expect(gordo).toHaveLength(1);
    expect(gordo[0].reglaId).toBe("gasolinera");
  });

  /*
   * Si desactivar no funcionara hacia abajo, la única manera de callar una caja
   * concreta sería apagar la regla para toda la empresa.
   */
  it("una regla desactivada en la caja apaga el aviso de la empresa", () => {
    const reglas = [
      regla({ id: "empresa", ambito: "EMPRESA", umbral: 1000 }),
      regla({ id: "silencio", ambito: "CAJA", ambitoId: "7", activa: false }),
    ];
    expect(evaluarCaja(reglas, { ...caja, descuadreCentimos: -9999, sessionId: 1 })).toHaveLength(0);
  });

  it("con dos reglas igual de específicas, siempre gana la misma", () => {
    const reglas = [
      regla({ id: "b", ambito: "ZONA", ambitoId: ZONA, umbral: 500 }),
      regla({ id: "a", ambito: "ZONA", ambitoId: ZONA, umbral: 900 }),
    ];
    expect(reglaAplicable(reglas, "DESCUADRE", caja)?.id).toBe("a");
    expect(reglaAplicable([...reglas].reverse(), "DESCUADRE", caja)?.id).toBe("a");
  });
});

describe("evaluación", () => {
  it("el descuadre salta por valor absoluto: sobrar también es descuadrar", () => {
    const reglas = [regla({ id: "r", ambito: "EMPRESA", umbral: 1000 })];
    expect(evaluarCaja(reglas, { ...caja, descuadreCentimos: 5000, sessionId: 1 })).toHaveLength(1);
    expect(evaluarCaja(reglas, { ...caja, descuadreCentimos: -5000, sessionId: 1 })).toHaveLength(1);
    expect(evaluarCaja(reglas, { ...caja, descuadreCentimos: 500, sessionId: 1 })).toHaveLength(0);
  });

  it("la calderilla salta por debajo, no por encima", () => {
    const reglas = [
      regla({ id: "r", tipo: "CALDERILLA_MINIMA", ambito: "EMPRESA", umbral: 3000 }),
    ];
    expect(evaluarCaja(reglas, { ...caja, calderillaCentimos: 1000 })).toHaveLength(1);
    expect(evaluarCaja(reglas, { ...caja, calderillaCentimos: 9000 })).toHaveLength(0);
  });

  it("sin dato no hay incidencia: una caja que aún no ha arqueado no descuadra", () => {
    const reglas = [regla({ id: "r", ambito: "EMPRESA", umbral: 1 })];
    expect(evaluarCaja(reglas, caja)).toHaveLength(0);
    expect(evaluarCaja(reglas, { ...caja, descuadreCentimos: null })).toHaveLength(0);
  });

  /*
   * La clave de deduplicación es lo que separa una bandeja útil de uno de esos
   * buzones que se ignoran enteros.
   */
  it("dos descuadres de días distintos son dos incidencias", () => {
    const reglas = [regla({ id: "r", ambito: "EMPRESA", umbral: 100 })];
    const lunes = evaluarCaja(reglas, { ...caja, descuadreCentimos: -500, sessionId: 1 })[0];
    const martes = evaluarCaja(reglas, { ...caja, descuadreCentimos: -500, sessionId: 2 })[0];
    expect(lunes.clave).not.toBe(martes.clave);
  });

  it("un tránsito que sigue fuera es el mismo problema de ayer, no uno nuevo", () => {
    const reglas = [regla({ id: "r", tipo: "TRANSITO_DIAS", ambito: "EMPRESA", umbral: 2 })];
    const ayer = evaluarCaja(reglas, { ...caja, transitoDias: 3 })[0];
    const hoy = evaluarCaja(reglas, { ...caja, transitoDias: 4 })[0];
    expect(ayer.clave).toBe(hoy.clave);
  });

  it("evalúa la red entera y no mezcla las cajas", () => {
    const reglas = [regla({ id: "r", ambito: "EMPRESA", umbral: 100 })];
    const incidencias = evaluarRed(reglas, [
      { ...caja, registerId: 1, descuadreCentimos: -500, sessionId: 1 },
      { ...caja, registerId: 2, descuadreCentimos: 0, sessionId: 2 },
      { ...caja, registerId: 3, descuadreCentimos: 900, sessionId: 3 },
    ]);
    expect(incidencias.map((i) => i.registerId)).toEqual([1, 3]);
  });
});
