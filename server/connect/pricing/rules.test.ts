import { describe, it, expect } from "vitest";
import {
  compararReglas, especificidad, explicarDescarte, porQueNoAplica, resolverRegla,
  type ContextoRegla, type ReglaTarifa,
} from "./rules.ts";

/** Identificadores de franja, para que las reglas se lean como el tarifario. */
const DIURNO = 1;
const NOCTURNO = 2;

const base = {
  serviceTypeCode: "tyres", vehicleTypeCode: "truck",
  zoneId: null, dayClasses: null, active: true,
} as const;

/** Tarifario de referencia, escrito como datos y no como código. */
const proximidad: ReglaTarifa = {
  ...base, id: 10, code: "DIURNO_PROX", name: "Diurno proximidad",
  timeBandId: DIURNO, maxDistanceKm: 30, maxDurationMin: 90, priority: 45,
};
const diurno: ReglaTarifa = {
  ...base, id: 11, code: "DIURNO", name: "Diurno",
  timeBandId: DIURNO, priority: 40,
};
const nocturno: ReglaTarifa = {
  ...base, id: 12, code: "NOCTURNO", name: "Nocturno",
  timeBandId: NOCTURNO, priority: 50,
};
const festivo: ReglaTarifa = {
  ...base, id: 13, code: "FESTIVO", name: "Festivos",
  timeBandId: null, dayClasses: ["holiday"], priority: 90,
};
const festivoExtra: ReglaTarifa = {
  ...base, id: 14, code: "FESTIVO_EXTRA", name: "Festivos extra",
  timeBandId: null, dayClasses: ["christmas", "new_year"], priority: 100,
};
const tarifario = [proximidad, diurno, nocturno, festivo, festivoExtra];

function ctx(p: Partial<ContextoRegla> = {}): ContextoRegla {
  return {
    serviceTypeCode: "tyres", vehicleTypeCode: "truck",
    zoneIds: [], timeBandIds: [DIURNO], dayClasses: ["workday"],
    distanceKm: 50, durationMin: 120,
    ...p,
  };
}

describe("resolución de la regla tarifaria", () => {
  it("viernes por la noche: gana el nocturno", () => {
    const r = resolverRegla(tarifario, ctx({ timeBandIds: [NOCTURNO], distanceKm: 76 }));
    expect(r.regla?.code).toBe("NOCTURNO");
    expect(r.avisos).toEqual([]);
  });

  it("martes a 22 km: gana la de proximidad", () => {
    const r = resolverRegla(tarifario, ctx({ distanceKm: 22, durationMin: 60 }));
    expect(r.regla?.code).toBe("DIURNO_PROX");
  });

  it("martes a 76 km: la proximidad no aplica y queda el diurno", () => {
    const r = resolverRegla(tarifario, ctx({ distanceKm: 76 }));
    expect(r.regla?.code).toBe("DIURNO");
    const descarte = r.descartadas.find((d) => d.regla.code === "DIURNO_PROX")!;
    expect(descarte.motivo).toBe("distance");
    // El operador pregunta justo esto cuando el precio no es el que esperaba
    expect(explicarDescarte(descarte, ctx({ distanceKm: 76 })))
      .toBe("Diurno proximidad: 76 km fuera de su rango (máximo 30 km)");
  });

  it("festivo a las 10:00: el festivo gana al diurno por prioridad", () => {
    const r = resolverRegla(tarifario, ctx({ dayClasses: ["holiday_local", "holiday"] }));
    expect(r.regla?.code).toBe("FESTIVO");
  });

  it("Navidad a las 22:00: gana el festivo extra, no el nocturno", () => {
    // Prioridad 100 contra 50. Sale de la configuración, no de un `if`.
    const r = resolverRegla(tarifario, ctx({
      timeBandIds: [NOCTURNO],
      dayClasses: ["christmas", "holiday_national", "holiday"],
    }));
    expect(r.regla?.code).toBe("FESTIVO_EXTRA");
  });

  it("sin ninguna regla aplicable no se inventa precio", () => {
    const r = resolverRegla(tarifario, ctx({ serviceTypeCode: "tow_truck" }));
    expect(r.regla).toBeNull();
    expect(r.avisos).toContain("NO_MATCHING_RULE");
  });

  it("una regla con límite de distancia no se aplica sin conocer la distancia", () => {
    // Aplicar la de proximidad a ciegas facturaría 110 € donde tocan 198 €
    const r = resolverRegla(tarifario, ctx({ distanceKm: null }));
    expect(r.regla?.code).toBe("DIURNO");
    expect(r.avisos).toContain("DISTANCE_NOT_AVAILABLE");
  });

  it("a igual prioridad gana la regla más específica", () => {
    const generica: ReglaTarifa = {
      ...base, id: 20, code: "GEN", name: "Genérica",
      vehicleTypeCode: null, timeBandId: null, priority: 40,
    };
    const r = resolverRegla([generica, diurno], ctx());
    expect(r.regla?.code).toBe("DIURNO");
    expect(especificidad(diurno)).toBeGreaterThan(especificidad(generica));
  });

  it("el empate total se resuelve igual siempre, y se avisa", () => {
    // El resultado tiene que ser reproducible, pero esto es un error de
    // configuración y no puede quedarse callado detrás de un número plausible.
    const a: ReglaTarifa = { ...base, id: 31, code: "A", name: "A", timeBandId: DIURNO, priority: 40 };
    const b: ReglaTarifa = { ...base, id: 30, code: "B", name: "B", timeBandId: DIURNO, priority: 40 };
    const r1 = resolverRegla([a, b], ctx());
    const r2 = resolverRegla([b, a], ctx());
    expect(r1.regla?.code).toBe("B");
    expect(r2.regla?.code).toBe("B");
    expect(r1.avisos).toContain("AMBIGUOUS_RULES");
  });

  it("el orden de llegada nunca decide el precio", () => {
    const alReves = [...tarifario].reverse();
    const contexto = ctx({ timeBandIds: [NOCTURNO], distanceKm: 76 });
    expect(resolverRegla(tarifario, contexto).regla?.id)
      .toBe(resolverRegla(alReves, contexto).regla?.id);
  });

  it("una regla desactivada no se aplica", () => {
    const r = resolverRegla([{ ...nocturno, active: false }], ctx({ timeBandIds: [NOCTURNO] }));
    expect(r.regla).toBeNull();
  });

  it("el comodín encaja con cualquier valor de esa dimensión", () => {
    const cualquierVehiculo: ReglaTarifa = {
      ...base, id: 40, code: "ANY", name: "Cualquiera",
      vehicleTypeCode: null, timeBandId: null, priority: 1,
    };
    expect(porQueNoAplica(cualquierVehiculo, ctx({ vehicleTypeCode: "car" }))).toBeNull();
    expect(porQueNoAplica(diurno, ctx({ vehicleTypeCode: "car" }))).toBe("vehicle_type");
  });

  it("la zona se comprueba contra todas las zonas del punto", () => {
    const enEspana: ReglaTarifa = { ...base, id: 50, code: "ES", name: "España", zoneId: 7, timeBandId: null, priority: 10 };
    expect(porQueNoAplica(enEspana, ctx({ zoneIds: [7, 9] }))).toBeNull();
    expect(porQueNoAplica(enEspana, ctx({ zoneIds: [9] }))).toBe("zone");
  });

  it("basta con que coincida una de las clases de día de la regla", () => {
    expect(porQueNoAplica(festivoExtra, ctx({ dayClasses: ["new_year", "holiday"] }))).toBeNull();
    expect(porQueNoAplica(festivoExtra, ctx({ dayClasses: ["holiday"] }))).toBe("day_class");
  });

  it("el comparador es un orden total", () => {
    const ordenadas = [...tarifario].sort(compararReglas).map((r) => r.code);
    expect(ordenadas).toEqual(["FESTIVO_EXTRA", "FESTIVO", "NOCTURNO", "DIURNO_PROX", "DIURNO"]);
  });
});
