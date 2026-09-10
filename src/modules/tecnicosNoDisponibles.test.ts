import { describe, it, expect } from "vitest";
import {
  estadoProgramadoDeHoy,
  tecnicosNoDisponibles,
} from "./tecnicosNoDisponibles";
import type { ScheduledTechStatus } from "./techStatusScheduleHelpers";
import type { Tech, TechStatus } from "./workshopTypes";

function tech(name: string, status: TechStatus, extra: Partial<Tech> = {}): Tech {
  return {
    name,
    status,
    currentJobId: null,
    blocked: false,
    competencies: {} as Tech["competencies"],
    priorities: {} as Tech["priorities"],
    ...extra,
  };
}

function programado(
  techName: string,
  startDate: string,
  endDate: string,
  status: TechStatus = "vacaciones"
): ScheduledTechStatus {
  return {
    id: `${techName}-${startDate}`,
    techName,
    status,
    startDate,
    endDate,
    createdAtMs: 0,
    workshopId: null,
  };
}

const HOY = "2026-09-09";

describe("estadoProgramadoDeHoy", () => {
  it("encuentra el estado que cubre hoy, extremos incluidos", () => {
    const estados = [programado("Jesús", "2026-09-09", "2026-09-09")];
    expect(estadoProgramadoDeHoy(estados, "Jesús", HOY)?.id).toBe("Jesús-2026-09-09");
  });

  it("ignora los estados de otros días y de otros técnicos", () => {
    const estados = [
      programado("Jesús", "2026-10-01", "2026-10-05"),
      programado("Ramón", "2026-09-01", "2026-09-30"),
    ];
    expect(estadoProgramadoDeHoy(estados, "Jesús", HOY)).toBeNull();
  });

  it("con dos estados solapados se queda con el que acaba más tarde", () => {
    const estados = [
      programado("Iván", "2026-09-01", "2026-09-10"),
      programado("Iván", "2026-09-05", "2026-09-20", "permiso"),
    ];
    expect(estadoProgramadoDeHoy(estados, "Iván", HOY)?.endDate).toBe("2026-09-20");
  });
});

describe("tecnicosNoDisponibles", () => {
  it("lista los estados manuales con su motivo legible", () => {
    const lista = tecnicosNoDisponibles({
      techs: [
        tech("Albert", "vacaciones"),
        tech("Andrés", "baja"),
        tech("Iván", "permiso"),
        tech("David", "otro_taller"),
        tech("Sergio", "nodisponible"),
      ],
      trabajando: [],
      hoy: HOY,
    });

    expect(lista.map((t) => [t.name, t.motivo])).toEqual([
      ["Albert", "Vacaciones"],
      ["Andrés", "Baja"],
      ["David", "En otro taller"],
      ["Iván", "Permiso"],
      ["Sergio", "No disponible"],
    ]);
  });

  it("no incluye a quien está disponible ni ocupado en un trabajo", () => {
    const lista = tecnicosNoDisponibles({
      techs: [tech("Ramón", "ocupado"), tech("José", "disponible"), tech("Anthoni", "refuerzo")],
      trabajando: ["Ramón"],
      hoy: HOY,
    });

    expect(lista).toEqual([]);
  });

  it("un técnico que está trabajando no sale aunque su estado diga otra cosa", () => {
    const lista = tecnicosNoDisponibles({
      techs: [tech("Albert", "vacaciones")],
      trabajando: ["Albert"],
      hoy: HOY,
    });

    expect(lista).toEqual([]);
  });

  it("añade las fechas del estado programado que lo cubre hoy", () => {
    const lista = tecnicosNoDisponibles({
      techs: [tech("Albert", "vacaciones")],
      trabajando: [],
      estadosProgramados: [programado("Albert", "2026-08-31", "2026-09-13")],
      hoy: HOY,
    });

    expect(lista[0].desde).toBe("2026-08-31");
    expect(lista[0].hasta).toBe("2026-09-13");
  });

  it("sin estado programado no inventa fechas", () => {
    const lista = tecnicosNoDisponibles({
      techs: [tech("Albert", "vacaciones")],
      trabajando: [],
      estadosProgramados: [programado("Albert", "2026-10-01", "2026-10-05")],
      hoy: HOY,
    });

    expect(lista[0].hasta).toBeUndefined();
  });

  it("marca el bloqueo por mantenimiento en otro taller", () => {
    const lista = tecnicosNoDisponibles({
      techs: [tech("David", "disponible")],
      trabajando: [],
      hoy: HOY,
      bloqueadoEnOtroTaller: (n) => n === "David",
    });

    expect(lista[0].motivo).toBe("Mantenimiento en otro taller");
  });

  it("marca a un técnico bloqueado a mano", () => {
    const lista = tecnicosNoDisponibles({
      techs: [tech("José", "disponible", { blocked: true })],
      trabajando: [],
      hoy: HOY,
    });

    expect(lista[0].motivo).toBe("Bloqueado");
  });

  it("el estado manual manda sobre el bloqueo, que es información menos útil", () => {
    const lista = tecnicosNoDisponibles({
      techs: [tech("Andrés", "baja", { blocked: true })],
      trabajando: [],
      hoy: HOY,
    });

    expect(lista).toHaveLength(1);
    expect(lista[0].motivo).toBe("Baja");
  });

  it("descarta nombres vacíos", () => {
    const lista = tecnicosNoDisponibles({
      techs: [tech("   ", "vacaciones")],
      trabajando: [],
      hoy: HOY,
    });

    expect(lista).toEqual([]);
  });
});
