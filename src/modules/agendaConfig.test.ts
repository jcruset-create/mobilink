import { describe, it, expect } from "vitest";
import {
  DEFAULT_AGENDA_CONFIG,
  getDayRanges,
  getBridgeSaturday,
  getFridayBridgeStatus,
  getGridBounds,
  getGridSlots,
  getHolidayForDate,
  getScheduleForDate,
  isClosedDate,
  isLunchTime,
  isLunchTimeForDate,
  isWorkingTime,
  isWorkingTimeForDate,
  normalizeAgendaConfig,
  validateAgendaConfig,
  weekdayIndexMonFirst,
  type AgendaConfig,
} from "./agendaConfig";

const cfg = DEFAULT_AGENDA_CONFIG;

describe("weekdayIndexMonFirst", () => {
  it("lunes = 0, sábado = 5", () => {
    expect(weekdayIndexMonFirst("2026-07-27")).toBe(0); // lunes
    expect(weekdayIndexMonFirst("2026-08-01")).toBe(5); // sábado
  });
});

describe("isWorkingTime (horario por defecto)", () => {
  it("lunes: mañana y tarde dentro, mediodía fuera", () => {
    expect(isWorkingTime(cfg, 0, "08:30")).toBe(true);
    expect(isWorkingTime(cfg, 0, "13:15")).toBe(true);
    expect(isWorkingTime(cfg, 0, "13:30")).toBe(false);
    expect(isWorkingTime(cfg, 0, "14:00")).toBe(false);
    expect(isWorkingTime(cfg, 0, "15:00")).toBe(true);
    expect(isWorkingTime(cfg, 0, "18:30")).toBe(false);
  });

  it("sábado: abre a las 9:00 y cierra a las 13:00, sin tarde", () => {
    expect(isWorkingTime(cfg, 5, "08:30")).toBe(false);
    expect(isWorkingTime(cfg, 5, "09:00")).toBe(true);
    expect(isWorkingTime(cfg, 5, "12:45")).toBe(true);
    expect(isWorkingTime(cfg, 5, "13:00")).toBe(false);
    expect(isWorkingTime(cfg, 5, "16:00")).toBe(false);
  });
});

describe("isLunchTime", () => {
  it("solo entre los dos turnos de los días con tarde", () => {
    expect(isLunchTime(cfg, 0, "13:30")).toBe(true);
    expect(isLunchTime(cfg, 0, "14:45")).toBe(true);
    expect(isLunchTime(cfg, 0, "15:00")).toBe(false);
    expect(isLunchTime(cfg, 0, "12:00")).toBe(false);
  });

  it("el sábado no tiene descanso de mediodía (un solo turno)", () => {
    expect(isLunchTime(cfg, 5, "14:00")).toBe(false);
  });
});

describe("isClosedDate", () => {
  it("sábados de agosto cerrados por defecto", () => {
    expect(isClosedDate(cfg, "2026-08-01")).toBe(true);
    expect(isClosedDate(cfg, "2026-08-08")).toBe(true);
    expect(isClosedDate(cfg, "2026-07-25")).toBe(false); // sábado de julio
    expect(isClosedDate(cfg, "2026-08-03")).toBe(false); // lunes de agosto
  });

  it("se puede desactivar el cierre de agosto", () => {
    const abierto: AgendaConfig = { ...cfg, closedSaturdaysInAugust: false };
    expect(isClosedDate(abierto, "2026-08-01")).toBe(false);
  });

  it("festivos concretos bloquean solo ese día", () => {
    const conFestivo: AgendaConfig = {
      ...cfg,
      holidays: [{ date: "2026-12-25", label: "Navidad", yearly: false }],
    };
    expect(isClosedDate(conFestivo, "2026-12-25")).toBe(true);
    expect(isClosedDate(conFestivo, "2026-12-24")).toBe(false);
    // Sin repetición anual, el año siguiente no queda bloqueado
    expect(isClosedDate(conFestivo, "2027-12-25")).toBe(false);
  });

  it("festivos anuales se repiten cada año (Diada de Catalunya)", () => {
    const conDiada: AgendaConfig = {
      ...cfg,
      holidays: [{ date: "2026-09-11", label: "Diada de Catalunya", yearly: true }],
    };
    expect(isClosedDate(conDiada, "2026-09-11")).toBe(true);
    expect(isClosedDate(conDiada, "2027-09-11")).toBe(true);
    expect(isClosedDate(conDiada, "2030-09-11")).toBe(true);
    expect(isClosedDate(conDiada, "2027-09-10")).toBe(false);
    // No se aplica a años anteriores al de alta
    expect(isClosedDate(conDiada, "2025-09-11")).toBe(false);
  });

  it("getHolidayForDate devuelve el motivo del festivo", () => {
    const conDiada: AgendaConfig = {
      ...cfg,
      holidays: [{ date: "2026-09-11", label: "Diada de Catalunya", yearly: true }],
    };
    expect(getHolidayForDate(conDiada, "2028-09-11")?.label).toBe("Diada de Catalunya");
    expect(getHolidayForDate(conDiada, "2028-09-12")).toBeNull();
  });

  it("un día marcado como cerrado bloquea toda la semana", () => {
    const sinSabados: AgendaConfig = {
      ...cfg,
      days: cfg.days.map((d, i) => (i === 5 ? { ...d, closed: true } : d)),
    };
    expect(isClosedDate(sinSabados, "2026-07-25")).toBe(true);
  });
});

describe("días con horario especial", () => {
  // 24/12/2026 es jueves: normalmente 08:30-13:30 y 15:00-18:30.
  const nochebuena: AgendaConfig = {
    ...cfg,
    specialDays: [
      {
        date: "2026-12-24",
        label: "Nochebuena",
        yearly: true,
        closed: false,
        morningStart: "08:30",
        morningEnd: "14:00",
        afternoonStart: "",
        afternoonEnd: "",
      },
    ],
  };

  it("aplica el horario especial en lugar del semanal", () => {
    expect(isWorkingTimeForDate(nochebuena, "2026-12-24", "13:45")).toBe(true);
    expect(isWorkingTimeForDate(nochebuena, "2026-12-24", "14:00")).toBe(false);
    // Por la tarde ya no se trabaja, aunque el jueves normal sí
    expect(isWorkingTimeForDate(nochebuena, "2026-12-24", "16:00")).toBe(false);
    expect(isWorkingTimeForDate(nochebuena, "2026-12-23", "16:00")).toBe(true);
  });

  it("sin turno de tarde no hay descanso de mediodía", () => {
    expect(isLunchTimeForDate(nochebuena, "2026-12-24", "14:30")).toBe(false);
    expect(isLunchTimeForDate(nochebuena, "2026-12-23", "14:30")).toBe(true);
  });

  it("se repite cada año si está marcado", () => {
    expect(isWorkingTimeForDate(nochebuena, "2027-12-24", "13:45")).toBe(true);
    expect(isWorkingTimeForDate(nochebuena, "2027-12-24", "16:00")).toBe(false);
  });

  it("no se repite si no está marcado como anual", () => {
    const soloUnAnyo: AgendaConfig = {
      ...cfg,
      specialDays: [{ ...nochebuena.specialDays[0], yearly: false }],
    };
    // En 2027 vuelve el horario normal del viernes (tarde incluida)
    expect(isWorkingTimeForDate(soloUnAnyo, "2027-12-24", "16:00")).toBe(true);
  });

  it("getScheduleForDate devuelve la jornada especial", () => {
    expect(getScheduleForDate(nochebuena, "2026-12-24")?.morningEnd).toBe("14:00");
    expect(getScheduleForDate(nochebuena, "2026-12-23")?.morningEnd).toBe("13:30");
  });

  it("una jornada especial cerrada bloquea el día", () => {
    const cerrado: AgendaConfig = {
      ...cfg,
      specialDays: [{ ...nochebuena.specialDays[0], closed: true }],
    };
    expect(isClosedDate(cerrado, "2026-12-24")).toBe(true);
  });

  it("la rejilla se amplía si una jornada especial empieza antes", () => {
    const madrugador: AgendaConfig = {
      ...cfg,
      specialDays: [
        { ...nochebuena.specialDays[0], morningStart: "07:00", morningEnd: "14:00" },
      ],
    };
    expect(getGridBounds(madrugador).start).toBe(7 * 60);
  });

  it("normalizeAgendaConfig conserva las jornadas especiales", () => {
    const result = normalizeAgendaConfig({
      specialDays: [
        { date: "2026-12-24", label: "Nochebuena", yearly: true, morningEnd: "14:00" },
        { date: "no-valida" },
      ],
    });
    expect(result.specialDays).toHaveLength(1);
    expect(result.specialDays[0].morningEnd).toBe("14:00");
    expect(result.specialDays[0].afternoonStart).toBe("");
  });

  it("config sin specialDays (formato antiguo) no rompe", () => {
    expect(normalizeAgendaConfig({ days: [] }).specialDays).toEqual([]);
  });
});

describe("getBridgeSaturday (puente cuando el festivo cae en viernes)", () => {
  it("propone el sábado siguiente si el festivo es viernes", () => {
    // 2027-09-10 es viernes
    expect(getBridgeSaturday(cfg, "2027-09-10")).toBe("2027-09-11");
  });

  it("no propone nada si el festivo no cae en viernes", () => {
    // 2026-09-11 es viernes; 2026-09-10 es jueves
    expect(getBridgeSaturday(cfg, "2026-09-10")).toBeNull();
  });

  it("no propone el puente si ese sábado ya está cerrado por ser de agosto", () => {
    // 2026-08-07 es viernes y el 08-08 es sábado de agosto (ya cerrado)
    expect(getBridgeSaturday(cfg, "2026-08-07")).toBeNull();
  });

  it("no propone el puente si ese sábado ya es festivo", () => {
    const conSabadoFestivo: AgendaConfig = {
      ...cfg,
      holidays: [{ date: "2027-09-11", label: "Diada", yearly: false }],
    };
    expect(getBridgeSaturday(conSabadoFestivo, "2027-09-10")).toBeNull();
  });

  it("no propone el puente si los sábados están cerrados en el horario", () => {
    const sinSabados: AgendaConfig = {
      ...cfg,
      days: cfg.days.map((d, i) => (i === 5 ? { ...d, closed: true } : d)),
    };
    expect(getBridgeSaturday(sinSabados, "2027-09-10")).toBeNull();
  });

  it("cruza correctamente el cambio de mes y de año", () => {
    // 2027-12-31 es viernes → sábado 2028-01-01
    expect(getBridgeSaturday(cfg, "2027-12-31")).toBe("2028-01-01");
  });
});

describe("getFridayBridgeStatus", () => {
  it("no aplica si el festivo no cae en viernes", () => {
    expect(getFridayBridgeStatus(cfg, "2026-09-10").state).toBe("none");
  });

  it("pendiente si cae en viernes y el sábado sigue abierto", () => {
    const status = getFridayBridgeStatus(cfg, "2027-09-10");
    expect(status.state).toBe("pending");
    expect(status.state === "pending" && status.saturday).toBe("2027-09-11");
  });

  it("hecho si el sábado siguiente ya es festivo", () => {
    const conPuente: AgendaConfig = {
      ...cfg,
      holidays: [
        { date: "2027-09-10", label: "Diada", yearly: false },
        { date: "2027-09-11", label: "Puente (Diada)", yearly: false },
      ],
    };
    const status = getFridayBridgeStatus(conPuente, "2027-09-10");
    expect(status.state).toBe("done");
    expect(status.state === "done" && status.saturday).toBe("2027-09-11");
  });

  it("hecho también si el sábado ya está cerrado por ser de agosto", () => {
    expect(getFridayBridgeStatus(cfg, "2026-08-07").state).toBe("done");
  });
});

describe("getGridBounds / getGridSlots", () => {
  it("cubre de la apertura más temprana al cierre más tardío", () => {
    expect(getGridBounds(cfg)).toEqual({ start: 8 * 60 + 30, end: 18 * 60 + 30 });
  });

  it("genera los slots de 15 minutos alineados", () => {
    const slots = getGridSlots(cfg, 15);
    expect(slots[0]).toBe("08:30");
    expect(slots[slots.length - 1]).toBe("18:15");
  });
});

describe("normalizeAgendaConfig", () => {
  it("rellena con los valores por defecto si falta información", () => {
    expect(normalizeAgendaConfig(null)).toEqual(cfg);
    expect(normalizeAgendaConfig({ days: [] }).days).toHaveLength(6);
  });

  it("descarta festivos con formato inválido, quita duplicados y ordena", () => {
    const result = normalizeAgendaConfig({
      holidays: [
        { date: "2026-12-25", label: "Navidad", yearly: true },
        "mañana",
        { date: "2026-01-01", label: "Año nuevo", yearly: true },
        { date: "2026-12-25", label: "duplicado", yearly: false },
      ],
    });
    expect(result.holidays.map((h) => h.date)).toEqual(["2026-01-01", "2026-12-25"]);
    expect(result.holidays[1].label).toBe("Navidad");
  });

  it("acepta el formato antiguo (lista de fechas) sin motivo ni repetición", () => {
    const result = normalizeAgendaConfig({ holidays: ["2026-12-25"] });
    expect(result.holidays).toEqual([{ date: "2026-12-25", label: "", yearly: false }]);
  });
});

describe("validateAgendaConfig", () => {
  it("la configuración por defecto es válida", () => {
    expect(validateAgendaConfig(cfg)).toEqual([]);
  });

  it("detecta un día abierto sin horario", () => {
    const roto: AgendaConfig = {
      ...cfg,
      days: cfg.days.map((d, i) =>
        i === 0
          ? { ...d, morningStart: "", morningEnd: "", afternoonStart: "", afternoonEnd: "" }
          : d
      ),
    };
    expect(validateAgendaConfig(roto)[0]).toContain("Lunes");
  });

  it("un día cerrado no necesita horario", () => {
    const cerrado: AgendaConfig = {
      ...cfg,
      days: cfg.days.map((d, i) => (i === 5 ? { ...d, closed: true } : d)),
    };
    expect(validateAgendaConfig(cerrado)).toEqual([]);
  });
});

describe("getDayRanges", () => {
  it("día cerrado no tiene franjas", () => {
    const cerrado: AgendaConfig = {
      ...cfg,
      days: cfg.days.map((d, i) => (i === 0 ? { ...d, closed: true } : d)),
    };
    expect(getDayRanges(cerrado, 0)).toEqual([]);
  });
});
