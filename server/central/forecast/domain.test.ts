/**
 * Tesorería predictiva. Funciones puras, sin base de datos.
 *
 * Lo que se fija aquí es sobre todo **cuándo NO hay que predecir** y que el día
 * de la semana pese, que es lo que separa una predicción útil de una que se
 * equivoca justo los sábados.
 */

import { describe, expect, it } from "vitest";
import { predecir, MINIMO_JORNADAS, type JornadaConsumo } from "./domain.ts";

/** Genera jornadas hacia atrás desde una fecha, con el consumo que se le diga. */
function historial(
  hasta: string,
  dias: number,
  calderillaPorDia: (fecha: string, diaSemana: number) => number
): JornadaConsumo[] {
  const out: JornadaConsumo[] = [];
  for (let i = dias; i >= 1; i--) {
    const t = Date.parse(`${hasta}T00:00:00Z`) - i * 86_400_000;
    const fecha = new Date(t).toISOString().slice(0, 10);
    const c = calderillaPorDia(fecha, new Date(t).getUTCDay());
    out.push({ fecha, salidaCentimos: c * 2, calderillaCentimos: c });
  }
  return out;
}

describe("cuándo no se predice", () => {
  /*
   * Una predicción con dos días detrás parece igual de firme que una con dos
   * meses, y ahí está el peligro: es la regla del módulo entero, un número
   * inventado es peor que un hueco declarado.
   */
  it("con poca historia dice que no hay datos, no predice", () => {
    const r = predecir(historial("2026-06-01", 3, () => 5000), 20000, "2026-06-01");
    expect(r.confianza).toBe("SIN_DATOS");
    expect(r.porDia).toEqual([]);
    expect(r.faltaCentimos).toBe(0);
    expect(r.explicacion).toContain(String(MINIMO_JORNADAS));
  });

  it("con historia corta predice, pero lo dice", () => {
    const r = predecir(historial("2026-06-01", 6, () => 5000), 100000, "2026-06-01");
    expect(r.confianza).toBe("MEDIA");
  });

  it("con dos meses detrás, confianza alta", () => {
    const r = predecir(historial("2026-06-01", 40, () => 5000), 100000, "2026-06-01");
    expect(r.confianza).toBe("ALTA");
  });
});

describe("el día de la semana pesa", () => {
  /*
   * El caso que motiva todo: si el sábado se gasta el triple, la media plana
   * dice que aguanta y el sábado a mediodía no hay cambio.
   */
  it("usa el patrón del sábado en vez de la media", () => {
    // 8 semanas: sábados 30 €, resto 5 €.
    const h = historial("2026-06-01", 56, (_f, d) => (d === 6 ? 3000 : 500));
    // 2026-06-06 es sábado.
    const r = predecir(h, 100000, "2026-06-05", 3);

    const sabado = r.porDia.find((d) => d.fecha === "2026-06-06")!;
    expect(sabado.diaSemana).toBe(6);
    expect(sabado.base).toBe("DIA");
    expect(sabado.esperadoCentimos).toBe(3000);

    const viernes = r.porDia.find((d) => d.fecha === "2026-06-05")!;
    expect(viernes.esperadoCentimos).toBe(500);
  });

  /*
   * Con una sola muestra, «los sábados se gastan 80 €» no es un patrón: es un
   * sábado. Se cae a la media general.
   */
  it("con un solo sábado en la historia no se fía de él", () => {
    const h = historial("2026-06-01", 7, (_f, d) => (d === 6 ? 9000 : 1000));
    const r = predecir(h, 100000, "2026-06-05", 3);
    const sabado = r.porDia.find((d) => d.diaSemana === 6)!;
    expect(sabado.base).toBe("MEDIA");
    expect(sabado.esperadoCentimos).toBeLessThan(9000);
  });
});

describe("autonomía y aviso", () => {
  it("dice cuántos días aguanta y cuánto falta", () => {
    const h = historial("2026-06-01", 30, () => 1000); // 10 € al día
    // Le quedan 25 €: aguanta 2 días completos de los 7.
    const r = predecir(h, 2500, "2026-06-02", 7);

    expect(r.diasDeAutonomia).toBe(2);
    // Necesita 70 € para la semana y tiene 25: faltan 45.
    expect(r.faltaCentimos).toBe(4500);
  });

  /*
   * Quedarse sin cambio a media tarde ya es quedarse sin cambio, así que el día
   * en el que el saldo no llega no cuenta como día aguantado.
   */
  it("un día a medias no cuenta como día aguantado", () => {
    const h = historial("2026-06-01", 30, () => 1000);
    const r = predecir(h, 1500, "2026-06-02", 7); // 15 € para días de 10 €
    expect(r.diasDeAutonomia).toBe(1);
  });

  /*
   * Avisar el mismo día es avisar tarde: el banco tiene horario y la caja
   * también.
   */
  it("avisa el día antes de quedarse sin", () => {
    const h = historial("2026-06-01", 30, () => 1000);
    const r = predecir(h, 2500, "2026-06-02", 7);
    expect(r.irAlBancoAntesDe).toBe("2026-06-03");
  });

  it("si cubre el horizonte, no manda a nadie al banco", () => {
    const h = historial("2026-06-01", 30, () => 1000);
    const r = predecir(h, 500000, "2026-06-02", 7);
    expect(r.faltaCentimos).toBe(0);
    expect(r.irAlBancoAntesDe).toBeNull();
    expect(r.diasDeAutonomia).toBe(7);
  });

  it("la explicación dice el porqué en euros, no en jerga", () => {
    const h = historial("2026-06-01", 30, () => 1000);
    const r = predecir(h, 2500, "2026-06-02", 7);
    expect(r.explicacion).toContain("10,00 €");
    expect(r.explicacion).toContain("25,00 €");
  });
});
