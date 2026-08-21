/**
 * Casador de extracto contra ingresos. Funciones puras.
 *
 * Lo que se fija aquí es sobre todo **cuándo NO hay que dar por buena una
 * pareja**, que es donde una conciliación automática se equivoca sin que nadie
 * lo note.
 */

import { describe, expect, it } from "vitest";
import { proponer, resumir, type ApunteBanco, type IngresoRegistrado } from "./matcher.ts";

const apunte = (over: Partial<ApunteBanco> = {}): ApunteBanco => ({
  id: "a1",
  fecha: "2026-05-03",
  importeCentimos: 150000,
  concepto: "INGRESO EFECTIVO",
  referencia: "",
  ...over,
});

const ingreso = (over: Partial<IngresoRegistrado> = {}): IngresoRegistrado => ({
  depositId: 1,
  numero: "TAR1-IB-26-001",
  fecha: "2026-05-03",
  importeCentimos: 150000,
  referencia: null,
  ...over,
});

describe("propuestas de conciliación", () => {
  it("importe y fecha únicos: propuesta de confianza alta", () => {
    const [p] = proponer([apunte()], [ingreso()]);
    expect(p.confianza).toBe("ALTA");
    expect(p.candidatos).toHaveLength(1);
    expect(p.candidatos[0].depositId).toBe(1);
  });

  /*
   * El caso que impide conciliar automáticamente: dos ingresos iguales el mismo
   * día. Elegir uno sería acertar la mitad de las veces sin que nadie lo sepa.
   */
  it("dos ingresos iguales el mismo día son ambiguos, y se enseñan los dos", () => {
    const [p] = proponer([apunte()], [ingreso(), ingreso({ depositId: 2, numero: "TAR1-IB-26-002" })]);
    expect(p.confianza).toBe("AMBIGUA");
    expect(p.candidatos.map((c) => c.depositId)).toEqual([1, 2]);
  });

  /*
   * Si alguien escribió el número del ingreso al hacerlo, eso no es una
   * coincidencia: es una identificación. Gana aunque el importe no cuadre al
   * céntimo, porque una comisión descontada es más probable que dos números
   * iguales por azar.
   */
  it("el número del ingreso en el concepto manda sobre el importe", () => {
    const [p] = proponer(
      [apunte({ concepto: "TRANSFERENCIA TAR1-IB-26-007", importeCentimos: 149850 })],
      [
        ingreso({ depositId: 7, numero: "TAR1-IB-26-007", importeCentimos: 150000 }),
        ingreso({ depositId: 8, numero: "TAR1-IB-26-008", importeCentimos: 149850 }),
      ]
    );
    expect(p.confianza).toBe("ALTA");
    expect(p.candidatos[0].depositId).toBe(7);
  });

  it("el importe suelto, con la fecha lejos, no pasa de confianza baja", () => {
    const [p] = proponer([apunte({ fecha: "2026-06-20" })], [ingreso()]);
    expect(p.confianza).toBe("BAJA");
    expect(p.candidatos).toHaveLength(1);
  });

  it("sin ninguna pareja, se dice: no se fuerza la más parecida", () => {
    const [p] = proponer([apunte({ importeCentimos: 999 })], [ingreso()]);
    expect(p.confianza).toBe("BAJA");
    expect(p.candidatos).toEqual([]);
  });

  /*
   * Un ingreso de caja siempre ENTRA en la cuenta. Mirar las salidas solo
   * produciría propuestas absurdas contra comisiones y recibos domiciliados.
   */
  it("las salidas de dinero del banco ni se miran", () => {
    const propuestas = proponer([apunte({ importeCentimos: -150000 })], [ingreso()]);
    expect(propuestas).toHaveLength(0);
  });

  it("unos días de margen sí, un mes no", () => {
    expect(proponer([apunte({ fecha: "2026-05-06" })], [ingreso()])[0].confianza).toBe("ALTA");
    expect(proponer([apunte({ fecha: "2026-05-30" })], [ingreso()])[0].confianza).toBe("BAJA");
  });

  it("un ingreso sin fecha no se casa por fecha", () => {
    const [p] = proponer([apunte()], [ingreso({ fecha: null })]);
    expect(p.confianza).toBe("BAJA");
  });

  it("el resumen cuenta lo que se puede confirmar de un golpe", () => {
    const propuestas = proponer(
      [apunte(), apunte({ id: "a2", importeCentimos: 999 })],
      [ingreso()]
    );
    expect(resumir(propuestas)).toEqual({ total: 2, altas: 1, ambiguas: 0, sinPareja: 1 });
  });
});
