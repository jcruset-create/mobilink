/**
 * Los meses en Europe/Madrid.
 *
 * Lo que se fija: que el corte cae a la medianoche LOCAL (22:00 o 23:00 UTC
 * según la estación), que los meses con cambio de hora encajan sin hueco ni
 * solape, y que «cerrado» respeta el margen.
 */

import { describe, expect, it } from "vitest";
import {
  claveDeMes, compararMeses, limitesDelMes, medianocheEn, mesAnterior, mesCerrado, mesDe,
  mesesEntre, mesSiguiente, MARGEN_CIERRE_MS,
} from "./meses.ts";

const MADRID = "Europe/Madrid";

describe("limitesDelMes() en Europe/Madrid", () => {
  it("septiembre de 2026 empieza a las 22:00 UTC del 31 de agosto (verano, UTC+2)", () => {
    const l = limitesDelMes({ year: 2026, month: 9 }, MADRID);
    expect(l.desde.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(l.desde.getTime()).toBe(1788213600000);
    expect(l.hasta.toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });

  it("enero empieza a las 23:00 UTC del 31 de diciembre (invierno, UTC+1)", () => {
    const l = limitesDelMes({ year: 2026, month: 1 }, MADRID);
    expect(l.desde.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(l.hasta.toISOString()).toBe("2026-01-31T23:00:00.000Z");
  });

  it("marzo cruza el cambio a verano: empieza en UTC+1 y acaba en UTC+2, sin hueco", () => {
    // Último domingo de marzo de 2026: día 29. Marzo dura 31 días menos una hora.
    const marzo = limitesDelMes({ year: 2026, month: 3 }, MADRID);
    const abril = limitesDelMes({ year: 2026, month: 4 }, MADRID);
    expect(marzo.desde.toISOString()).toBe("2026-02-28T23:00:00.000Z");
    expect(marzo.hasta.toISOString()).toBe("2026-03-31T22:00:00.000Z");
    expect(marzo.hasta.getTime()).toBe(abril.desde.getTime());
    expect(marzo.hasta.getTime() - marzo.desde.getTime()).toBe((31 * 24 - 1) * 3_600_000);
  });

  it("octubre cruza el cambio a invierno: dura 31 días y una hora", () => {
    const oct = limitesDelMes({ year: 2026, month: 10 }, MADRID);
    expect(oct.desde.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(oct.hasta.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(oct.hasta.getTime() - oct.desde.getTime()).toBe((31 * 24 + 1) * 3_600_000);
  });

  it("en UTC el corte es a medianoche UTC, que NO es lo que quiere Plana", () => {
    const l = limitesDelMes({ year: 2026, month: 9 }, "UTC");
    expect(l.desde.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("una zona que no existe revienta en vez de cortar en UTC en silencio", () => {
    expect(() => limitesDelMes({ year: 2026, month: 9 }, "Europe/Madrit")).toThrow(RangeError);
  });

  it("un mes fuera de rango se rechaza", () => {
    expect(() => limitesDelMes({ year: 2026, month: 13 }, MADRID)).toThrow(RangeError);
    expect(() => limitesDelMes({ year: 2026, month: 0 }, MADRID)).toThrow(RangeError);
  });
});

describe("medianocheEn()", () => {
  it("el día del cambio de hora también cae en la medianoche local", () => {
    // 29/03/2026 00:00 Madrid es antes del cambio (a las 02:00): sigue en UTC+1.
    expect(medianocheEn(2026, 3, 29, MADRID).toISOString()).toBe("2026-03-28T23:00:00.000Z");
    // 30/03/2026 00:00 ya es UTC+2.
    expect(medianocheEn(2026, 3, 30, MADRID).toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
});

describe("mesDe()", () => {
  it("las 23:30 UTC del 31 de agosto ya son septiembre en Madrid", () => {
    expect(mesDe(new Date("2026-08-31T23:30:00Z"), MADRID)).toEqual({ year: 2026, month: 9 });
    expect(mesDe(new Date("2026-08-31T23:30:00Z"), "UTC")).toEqual({ year: 2026, month: 8 });
  });
});

describe("aritmética de meses", () => {
  it("siguiente y anterior cruzan el año", () => {
    expect(mesSiguiente({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 });
    expect(mesAnterior({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 });
  });

  it("mesesEntre() devuelve todos, los dos extremos incluidos, un mes por entrada", () => {
    const l = mesesEntre({ year: 2025, month: 11 }, { year: 2026, month: 2 });
    expect(l.map(claveDeMes)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("mesesEntre() con hasta < desde es vacío, no infinito", () => {
    expect(mesesEntre({ year: 2026, month: 5 }, { year: 2026, month: 3 })).toEqual([]);
  });

  it("compararMeses() ordena por año y luego por mes", () => {
    expect(compararMeses({ year: 2025, month: 12 }, { year: 2026, month: 1 })).toBeLessThan(0);
    expect(compararMeses({ year: 2026, month: 3 }, { year: 2026, month: 3 })).toBe(0);
  });
});

describe("mesCerrado()", () => {
  it("un mes no está cerrado hasta pasado el margen tras su fin", () => {
    const fin = limitesDelMes({ year: 2026, month: 8 }, MADRID).hasta.getTime();
    expect(mesCerrado({ year: 2026, month: 8 }, MADRID, new Date(fin))).toBe(false);
    expect(mesCerrado({ year: 2026, month: 8 }, MADRID, new Date(fin + MARGEN_CIERRE_MS - 1))).toBe(false);
    expect(mesCerrado({ year: 2026, month: 8 }, MADRID, new Date(fin + MARGEN_CIERRE_MS))).toBe(true);
  });

  it("el mes en curso nunca está cerrado", () => {
    expect(mesCerrado({ year: 2026, month: 9 }, MADRID, new Date("2026-09-12T12:00:00Z"))).toBe(false);
  });
});
