import { describe, it, expect } from "vitest";
import {
  DEFAULT_AGENDA_CONFIG,
  getDayRanges,
  getGridBounds,
  getGridSlots,
  isClosedDate,
  isLunchTime,
  isWorkingTime,
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

  it("festivos concretos bloquean el día", () => {
    const conFestivo: AgendaConfig = { ...cfg, holidays: ["2026-12-25"] };
    expect(isClosedDate(conFestivo, "2026-12-25")).toBe(true);
    expect(isClosedDate(conFestivo, "2026-12-24")).toBe(false);
  });

  it("un día marcado como cerrado bloquea toda la semana", () => {
    const sinSabados: AgendaConfig = {
      ...cfg,
      days: cfg.days.map((d, i) => (i === 5 ? { ...d, closed: true } : d)),
    };
    expect(isClosedDate(sinSabados, "2026-07-25")).toBe(true);
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

  it("descarta festivos con formato inválido y ordena el resto", () => {
    const result = normalizeAgendaConfig({
      holidays: ["2026-12-25", "mañana", "2026-01-01", "2026-12-25"],
    });
    expect(result.holidays).toEqual(["2026-01-01", "2026-12-25"]);
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
