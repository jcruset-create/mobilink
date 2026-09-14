import { describe, expect, it } from "vitest";
import {
  PESOS_POR_DEFECTO,
  UMBRALES_POR_DEFECTO,
  calcularPrioridad,
  calcularScore,
  diasAbierto,
  prioridadDeScore,
} from "./prioridad.ts";

const hechos = (sobre: Partial<Parameters<typeof calcularScore>[0]> = {}) => ({
  diasAbierto: 0,
  reclamaciones: 0,
  urgente: false,
  tareaVencida: false,
  ...sobre,
});

describe("días abierto", () => {
  it("cuenta días enteros", () => {
    const desde = new Date("2026-09-02T10:00:00Z");
    expect(diasAbierto(desde, new Date("2026-09-14T10:00:00Z"))).toBe(12);
    expect(diasAbierto(desde, new Date("2026-09-14T09:59:00Z"))).toBe(11);
  });

  it("una fecha en el futuro no resta antigüedad", () => {
    const desde = new Date("2026-09-20T10:00:00Z");
    expect(diasAbierto(desde, new Date("2026-09-14T10:00:00Z"))).toBe(0);
  });
});

describe("la fórmula", () => {
  it("suma cada término con su peso", () => {
    // 12 días · 2 + 3 reclamaciones · 10 + urgente 25 + vencida 15 = 94
    expect(
      calcularScore(
        hechos({ diasAbierto: 12, reclamaciones: 3, urgente: true, tareaVencida: true })
      )
    ).toBe(94);
  });

  it("urgente y tarea vencida suman una sola vez", () => {
    expect(calcularScore(hechos({ urgente: true }))).toBe(PESOS_POR_DEFECTO.urgente);
    expect(calcularScore(hechos({ tareaVencida: true }))).toBe(PESOS_POR_DEFECTO.tareaVencida);
  });

  it("un expediente recién llegado y tranquilo puntúa cero", () => {
    expect(calcularScore(hechos())).toBe(0);
  });

  it("los pesos son un parámetro: cambiarlos cambia el resultado", () => {
    const h = hechos({ reclamaciones: 2 });
    expect(calcularScore(h)).toBe(20);
    expect(calcularScore(h, { ...PESOS_POR_DEFECTO, reclamaciones: 30 })).toBe(60);
  });
});

describe("los umbrales", () => {
  it("reparten el score en las cuatro prioridades", () => {
    expect(prioridadDeScore(0)).toBe("BAJA");
    expect(prioridadDeScore(9)).toBe("BAJA");
    expect(prioridadDeScore(10)).toBe("NORMAL");
    expect(prioridadDeScore(39)).toBe("NORMAL");
    expect(prioridadDeScore(40)).toBe("ALTA");
    expect(prioridadDeScore(69)).toBe("ALTA");
    expect(prioridadDeScore(70)).toBe("CRITICA");
  });

  it("se pueden mover sin tocar la fórmula", () => {
    expect(prioridadDeScore(30, { ...UMBRALES_POR_DEFECTO, critica: 25 })).toBe("CRITICA");
  });
});

describe("el caso del encargo", () => {
  /*
   * «estado = PENDIENTE, reclamaciones = 3, prioridad = CRITICA»: las tres
   * cosas a la vez, que es justo lo que no se podría decir si «reclamado»
   * fuera un estado.
   */
  it("tres reclamaciones sobre algo urgente y viejo sale CRÍTICA", () => {
    const r = calcularPrioridad(
      hechos({ diasAbierto: 12, reclamaciones: 3, urgente: true })
    );
    expect(r.score).toBe(79);
    expect(r.prioridad).toBe("CRITICA");
  });
});

describe("prioridad manual", () => {
  it("gana sobre la calculada", () => {
    const r = calcularPrioridad(hechos(), { manual: "CRITICA" });
    expect(r.prioridad).toBe("CRITICA");
    expect(r.manual).toBe(true);
  });

  it("no impide seguir calculando la automática: se enseñan las dos", () => {
    const r = calcularPrioridad(hechos({ reclamaciones: 5 }), { manual: "BAJA" });
    expect(r.prioridad).toBe("BAJA");
    expect(r.calculada).toBe("ALTA");
    expect(r.score).toBe(50);
  });

  it("sin manual, la prioridad es la calculada", () => {
    const r = calcularPrioridad(hechos({ reclamaciones: 5 }));
    expect(r.prioridad).toBe("ALTA");
    expect(r.manual).toBe(false);
  });
});
