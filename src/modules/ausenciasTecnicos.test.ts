import { describe, it, expect } from "vitest";
import {
  aniosConDatos,
  cupoDeTecnico,
  detectaSolapes,
  diasDelEstado,
  diasDelRango,
  diasNaturalesDelRango,
  esDiaLaborable,
  normalizaRango,
  parteHastaHoy,
  partePosteriorAHoy,
  recortaAlAnio,
  resumenPorTecnico,
  type ConfigVacaciones,
} from "./ausenciasTecnicos";
import { DEFAULT_AGENDA_CONFIG, type AgendaConfig } from "./agendaConfig";
import type { ScheduledTechStatus } from "./techStatusScheduleHelpers";

const CONFIG: AgendaConfig = DEFAULT_AGENDA_CONFIG;

function conFestivos(fechas: { date: string; yearly?: boolean }[]): AgendaConfig {
  return {
    ...DEFAULT_AGENDA_CONFIG,
    holidays: fechas.map((f) => ({
      date: f.date,
      label: "Festivo",
      yearly: Boolean(f.yearly),
    })),
  };
}

function estado(
  parcial: Partial<ScheduledTechStatus> & Pick<ScheduledTechStatus, "startDate" | "endDate">
): ScheduledTechStatus {
  return {
    id: parcial.id ?? `e-${parcial.startDate}-${parcial.endDate}`,
    techName: parcial.techName ?? "Ramón",
    status: parcial.status ?? "vacaciones",
    startDate: parcial.startDate,
    endDate: parcial.endDate,
    createdAtMs: parcial.createdAtMs ?? 0,
    label: parcial.label,
    notes: parcial.notes,
    workshopId: parcial.workshopId ?? null,
  };
}

const VACIA: ConfigVacaciones = { modo: "naturales", diasPorDefecto: 30 };

describe("normalizaRango", () => {
  it("descarta fechas con formato inválido", () => {
    expect(normalizaRango({ startDate: "", endDate: "2026-01-02" })).toBeNull();
    expect(normalizaRango({ startDate: "2026-1-2", endDate: "2026-01-03" })).toBeNull();
  });

  it("ordena los extremos si vienen del revés", () => {
    expect(normalizaRango({ startDate: "2026-03-10", endDate: "2026-03-01" })).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-10",
    });
  });
});

describe("diasNaturalesDelRango", () => {
  it("un solo día cuenta 1, no 0", () => {
    expect(diasNaturalesDelRango({ startDate: "2026-05-04", endDate: "2026-05-04" })).toBe(1);
  });

  it("cuenta los extremos incluidos", () => {
    expect(diasNaturalesDelRango({ startDate: "2026-05-01", endDate: "2026-05-10" })).toBe(10);
  });

  it("cuenta el 29 de febrero de un año bisiesto", () => {
    // 2028 es bisiesto: del 28/02 al 01/03 son 3 días.
    expect(diasNaturalesDelRango({ startDate: "2028-02-28", endDate: "2028-03-01" })).toBe(3);
    // 2026 no lo es: son 2.
    expect(diasNaturalesDelRango({ startDate: "2026-02-28", endDate: "2026-03-01" })).toBe(2);
  });

  it("no se descuadra al cruzar el cambio de hora", () => {
    // Cambio de hora peninsular de 2026: madrugada del 29 de marzo.
    expect(diasNaturalesDelRango({ startDate: "2026-03-27", endDate: "2026-03-31" })).toBe(5);
    expect(diasNaturalesDelRango({ startDate: "2026-10-23", endDate: "2026-10-27" })).toBe(5);
  });
});

describe("esDiaLaborable", () => {
  it("excluye sábado y domingo", () => {
    // 2026-05-02 sábado, 2026-05-03 domingo, 2026-05-04 lunes.
    expect(esDiaLaborable("2026-05-02", CONFIG)).toBe(false);
    expect(esDiaLaborable("2026-05-03", CONFIG)).toBe(false);
    expect(esDiaLaborable("2026-05-04", CONFIG)).toBe(true);
  });

  it("excluye los festivos del calendario del taller", () => {
    const config = conFestivos([{ date: "2026-05-04" }]);
    expect(esDiaLaborable("2026-05-04", config)).toBe(false);
  });

  it("aplica los festivos anuales a los años posteriores, no a los anteriores", () => {
    const config = conFestivos([{ date: "2026-09-11", yearly: true }]);
    // 2027-09-11 cae en sábado, así que no sirve; usamos 2028-09-11 (lunes).
    expect(esDiaLaborable("2028-09-11", config)).toBe(false);
    // Un año anterior al que se dio de alta el festivo no queda afectado.
    expect(esDiaLaborable("2025-09-11", config)).toBe(true);
  });
});

describe("diasDelRango en modo laborable", () => {
  it("cuenta solo de lunes a viernes", () => {
    // 2026-05-04 lunes → 2026-05-10 domingo: 5 laborables.
    expect(
      diasDelRango({ startDate: "2026-05-04", endDate: "2026-05-10" }, "laborables", CONFIG)
    ).toBe(5);
  });

  it("descuenta un festivo que cae dentro", () => {
    const config = conFestivos([{ date: "2026-05-06" }]);
    expect(
      diasDelRango({ startDate: "2026-05-04", endDate: "2026-05-08" }, "laborables", config)
    ).toBe(4);
  });

  it("un único día en sábado cuenta 0 laborables pero 1 natural", () => {
    const rango = { startDate: "2026-05-02", endDate: "2026-05-02" };
    expect(diasDelRango(rango, "laborables", CONFIG)).toBe(0);
    expect(diasDelRango(rango, "naturales", CONFIG)).toBe(1);
  });
});

describe("diasDelEstado", () => {
  it("el modo laborable solo se aplica a vacaciones", () => {
    const rango = { startDate: "2026-05-04", endDate: "2026-05-10" };

    expect(diasDelEstado({ ...rango, status: "vacaciones" }, "laborables", CONFIG)).toBe(5);
    // Una baja se cuenta siempre en días naturales.
    expect(diasDelEstado({ ...rango, status: "baja" }, "laborables", CONFIG)).toBe(7);
    expect(diasDelEstado({ ...rango, status: "permiso" }, "laborables", CONFIG)).toBe(7);
  });
});

describe("recortaAlAnio", () => {
  it("parte un rango que cruza el fin de año", () => {
    const rango = { startDate: "2026-12-28", endDate: "2027-01-05" };

    expect(recortaAlAnio(rango, 2026)).toEqual({
      startDate: "2026-12-28",
      endDate: "2026-12-31",
    });
    expect(recortaAlAnio(rango, 2027)).toEqual({
      startDate: "2027-01-01",
      endDate: "2027-01-05",
    });
  });

  it("devuelve null si el rango no toca ese año", () => {
    expect(recortaAlAnio({ startDate: "2026-03-01", endDate: "2026-03-05" }, 2027)).toBeNull();
  });
});

describe("reparto disfrutado / programado", () => {
  it("un rango que contiene hoy se reparte, hoy cuenta como disfrutado", () => {
    const rango = { startDate: "2026-05-04", endDate: "2026-05-08" };
    const hoy = "2026-05-06";

    expect(parteHastaHoy(rango, hoy)).toEqual({
      startDate: "2026-05-04",
      endDate: "2026-05-06",
    });
    expect(partePosteriorAHoy(rango, hoy)).toEqual({
      startDate: "2026-05-07",
      endDate: "2026-05-08",
    });
  });

  it("un rango enteramente pasado no tiene parte futura, y al revés", () => {
    const pasado = { startDate: "2026-01-01", endDate: "2026-01-05" };
    const futuro = { startDate: "2026-12-01", endDate: "2026-12-05" };
    const hoy = "2026-06-15";

    expect(partePosteriorAHoy(pasado, hoy)).toBeNull();
    expect(parteHastaHoy(futuro, hoy)).toBeNull();
    expect(parteHastaHoy(pasado, hoy)).toEqual(pasado);
    expect(partePosteriorAHoy(futuro, hoy)).toEqual(futuro);
  });
});

describe("cupoDeTecnico", () => {
  it("usa el valor por defecto y el override por técnico", () => {
    const config: ConfigVacaciones = {
      modo: "naturales",
      diasPorDefecto: 30,
      diasPorTecnico: { Ramón: 25 },
    };

    expect(cupoDeTecnico("Ramón", config)).toBe(25);
    expect(cupoDeTecnico("José", config)).toBe(30);
  });

  it("ignora un override que no sea un número", () => {
    const config = {
      modo: "naturales",
      diasPorDefecto: 30,
      diasPorTecnico: { Ramón: Number.NaN },
    } as ConfigVacaciones;

    expect(cupoDeTecnico("Ramón", config)).toBe(30);
  });
});

describe("resumenPorTecnico", () => {
  const hoy = "2026-06-15";

  it("reparte vacaciones en disfrutadas y programadas y calcula las pendientes", () => {
    const estados = [
      estado({ startDate: "2026-01-05", endDate: "2026-01-14" }), // 10 pasados
      estado({ startDate: "2026-08-01", endDate: "2026-08-05" }), // 5 futuros
    ];

    const [ramon] = resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy);

    expect(ramon.vacacionesDisfrutadas).toBe(10);
    expect(ramon.vacacionesProgramadas).toBe(5);
    expect(ramon.vacacionesPendientes).toBe(15);
    expect(ramon.cupo).toBe(30);
  });

  it("cuenta baja y permiso aparte, sin tocar el cupo de vacaciones", () => {
    const estados = [
      estado({ startDate: "2026-02-02", endDate: "2026-02-06", status: "baja" }),
      estado({ startDate: "2026-03-02", endDate: "2026-03-03", status: "permiso" }),
    ];

    const [ramon] = resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy);

    expect(ramon.porEstado.baja).toBe(5);
    expect(ramon.porEstado.permiso).toBe(2);
    expect(ramon.vacacionesDisfrutadas).toBe(0);
    expect(ramon.vacacionesPendientes).toBe(30);
  });

  it("devuelve fila para un técnico sin ninguna ausencia", () => {
    const [jose] = resumenPorTecnico([], ["José"], 2026, VACIA, CONFIG, hoy);

    expect(jose.techName).toBe("José");
    expect(jose.vacacionesPendientes).toBe(30);
    expect(jose.detalles).toEqual([]);
  });

  it("mantiene a un técnico que ya no está en el plantel pero tuvo ausencias", () => {
    const estados = [estado({ techName: "Jesús", startDate: "2026-02-02", endDate: "2026-02-06" })];

    const resumenes = resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy);
    const nombres = resumenes.map((r) => r.techName);

    expect(nombres).toContain("Jesús");
    expect(nombres).toContain("Ramón");
  });

  it("solo cuenta la parte del rango que cae en el año consultado", () => {
    const estados = [estado({ startDate: "2026-12-28", endDate: "2027-01-05" })];

    const [en2026] = resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy);
    const [en2027] = resumenPorTecnico(estados, ["Ramón"], 2027, VACIA, CONFIG, hoy);

    expect(en2026.vacacionesProgramadas).toBe(4); // 28, 29, 30, 31
    expect(en2027.vacacionesProgramadas).toBe(5); // 1 al 5
  });

  it("las pendientes salen negativas si se pasa del cupo", () => {
    const estados = [estado({ startDate: "2026-01-01", endDate: "2026-02-15" })]; // 46 días

    const [ramon] = resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy);

    expect(ramon.vacacionesDisfrutadas).toBe(46);
    expect(ramon.vacacionesPendientes).toBe(-16);
  });

  it("en modo laborable el mismo rango consume menos cupo", () => {
    const estados = [estado({ startDate: "2026-05-04", endDate: "2026-05-15" })];

    const [naturales] = resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy);
    const [laborables] = resumenPorTecnico(
      estados,
      ["Ramón"],
      2026,
      { modo: "laborables", diasPorDefecto: 22 },
      CONFIG,
      hoy
    );

    expect(naturales.vacacionesDisfrutadas).toBe(12);
    expect(laborables.vacacionesDisfrutadas).toBe(10);
  });

  it("ordena los detalles por fecha de inicio", () => {
    const estados = [
      estado({ id: "b", startDate: "2026-08-01", endDate: "2026-08-05" }),
      estado({ id: "a", startDate: "2026-01-05", endDate: "2026-01-06" }),
    ];

    const [ramon] = resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy);

    expect(ramon.detalles.map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("detectaSolapes", () => {
  const hoy = "2026-06-15";

  it("encuentra dos rangos del mismo técnico que se pisan", () => {
    const estados = [
      estado({ id: "a", startDate: "2026-08-01", endDate: "2026-08-10" }),
      estado({ id: "b", startDate: "2026-08-05", endDate: "2026-08-12", status: "permiso" }),
    ];

    const solapes = detectaSolapes(
      resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy)
    );

    expect(solapes).toHaveLength(1);
    expect(solapes[0].techName).toBe("Ramón");
  });

  it("no marca solape entre técnicos distintos ni entre rangos que solo se tocan de lejos", () => {
    const estados = [
      estado({ techName: "Ramón", startDate: "2026-08-01", endDate: "2026-08-10" }),
      estado({ techName: "José", startDate: "2026-08-05", endDate: "2026-08-12" }),
      estado({ techName: "Ramón", id: "c", startDate: "2026-09-01", endDate: "2026-09-02" }),
    ];

    const solapes = detectaSolapes(
      resumenPorTecnico(estados, ["Ramón", "José"], 2026, VACIA, CONFIG, hoy)
    );

    expect(solapes).toHaveLength(0);
  });

  it("marca solape cuando comparten un único día", () => {
    const estados = [
      estado({ id: "a", startDate: "2026-08-01", endDate: "2026-08-05" }),
      estado({ id: "b", startDate: "2026-08-05", endDate: "2026-08-09" }),
    ];

    const solapes = detectaSolapes(
      resumenPorTecnico(estados, ["Ramón"], 2026, VACIA, CONFIG, hoy)
    );

    expect(solapes).toHaveLength(1);
  });
});

describe("aniosConDatos", () => {
  it("incluye siempre el año en curso y ordena de más reciente a más antiguo", () => {
    const estados = [
      estado({ startDate: "2024-05-01", endDate: "2024-05-05" }),
      estado({ startDate: "2026-12-28", endDate: "2027-01-05" }),
    ];

    expect(aniosConDatos(estados, 2026)).toEqual([2027, 2026, 2024]);
  });
});
