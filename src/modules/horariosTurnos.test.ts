import { describe, expect, it } from "vitest";
import { DEFAULT_AGENDA_CONFIG, type AgendaConfig } from "./agendaConfig";
import {
  TURNO_TALLER,
  asignacionVigente,
  celdaDelDia,
  diasDeLaSemana,
  filaDeLaSemana,
  lunesDe,
  minutosDeTramos,
  personasEnTurnoPorDia,
  posicionEnLaSecuencia,
  turnoDeLaSemana,
  validarAsignacion,
  validarTurno,
  type AsignacionHorario,
  type Turno,
} from "./horariosTurnos";

const CONFIG: AgendaConfig = {
  ...DEFAULT_AGENDA_CONFIG,
  holidays: [{ date: "2026-10-12", label: "Hispanidad", yearly: true }],
};

const TURNOS: Turno[] = [
  { id: "m", nombre: "Mañana", tramos: [{ inicio: "06:00", fin: "14:00" }], dias: [1, 2, 3, 4, 5], activo: true },
  { id: "t", nombre: "Tarde", tramos: [{ inicio: "14:00", fin: "22:00" }], dias: [1, 2, 3, 4, 5], activo: true },
  { id: "n", nombre: "Noche", tramos: [{ inicio: "22:00", fin: "06:00" }], dias: [1, 2, 3, 4, 5], activo: true },
  { id: "viejo", nombre: "Antiguo", tramos: [{ inicio: "08:00", fin: "16:00" }], dias: [], activo: false },
];

const fijo = (turno: string, desde = "2026-01-01"): AsignacionHorario => ({
  employeeId: "e1", tipo: "fijo", turnoIds: [turno], semanaInicio: desde, vigenteDesde: desde,
});
const rotativo: AsignacionHorario = {
  employeeId: "e1", tipo: "rotativo", turnoIds: ["m", "t", "n"], semanaInicio: "2026-10-12", vigenteDesde: "2026-10-12",
};

describe("fechas", () => {
  it("lunes de la semana y los siete días", () => {
    expect(lunesDe("2026-10-20")).toBe("2026-10-19");
    expect(lunesDe("2026-10-19")).toBe("2026-10-19");
    expect(lunesDe("2026-10-25")).toBe("2026-10-19");
    expect(diasDeLaSemana("2026-10-21")).toEqual([
      "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25",
    ]);
  });
});

describe("minutos", () => {
  it("un turno de noche que acaba al día siguiente son ocho horas", () => {
    expect(minutosDeTramos([{ inicio: "22:00", fin: "06:00" }])).toBe(480);
    expect(minutosDeTramos([{ inicio: "08:30", fin: "13:30" }, { inicio: "15:00", fin: "18:30" }])).toBe(510);
  });
});

describe("turnoDeLaSemana", () => {
  it("rotativo: semana 1 Mañana, 2 Tarde, 3 Noche, y vuelta a empezar", () => {
    expect(turnoDeLaSemana(rotativo, "2026-10-12")).toBe("m");
    expect(turnoDeLaSemana(rotativo, "2026-10-21")).toBe("t"); // semana del 19
    expect(turnoDeLaSemana(rotativo, "2026-10-26")).toBe("n");
    expect(turnoDeLaSemana(rotativo, "2026-11-02")).toBe("m");
    expect(posicionEnLaSecuencia(rotativo, "2026-10-21")).toEqual({ i: 2, n: 3 });
  });

  it("antes del arranque sigue la secuencia hacia atrás", () => {
    expect(turnoDeLaSemana(rotativo, "2026-10-05")).toBe("n");
    expect(turnoDeLaSemana(rotativo, "2026-09-28")).toBe("t");
  });

  it("fijo: siempre el mismo", () => {
    expect(turnoDeLaSemana(fijo("t"), "2026-10-21")).toBe("t");
    expect(posicionEnLaSecuencia(fijo("t"), "2026-10-21")).toBeNull();
  });
});

describe("asignacionVigente", () => {
  it("la última cuyo «desde» no pasa la fecha; la anterior sigue para antes", () => {
    const lista = [fijo("m", "2026-01-01"), fijo("t", "2026-10-19")];
    expect(asignacionVigente(lista, "2026-10-18")?.turnoIds).toEqual(["m"]);
    expect(asignacionVigente(lista, "2026-10-19")?.turnoIds).toEqual(["t"]);
    expect(asignacionVigente(lista, "2025-12-31")).toBeNull();
  });
});

describe("celdaDelDia", () => {
  const base = { turnos: TURNOS, config: CONFIG };

  it("la ausencia pisa todo", () => {
    expect(celdaDelDia({ ...base, asignaciones: [fijo("m")], fecha: "2026-10-20", ausencia: "baja" }))
      .toEqual({ tipo: "ausencia", estado: "baja" });
  });

  it("sin asignación no se inventa horario", () => {
    expect(celdaDelDia({ ...base, asignaciones: [], fecha: "2026-10-20" })).toEqual({ tipo: "sin_horario" });
  });

  it("el taller cerrado cierra para todos: festivo y domingo", () => {
    expect(celdaDelDia({ ...base, asignaciones: [fijo("m")], fecha: "2026-10-12" })).toEqual({ tipo: "cerrado" });
    expect(celdaDelDia({ ...base, asignaciones: [fijo("m")], fecha: "2026-10-25" })).toEqual({ tipo: "cerrado" });
  });

  it("turno de la empresa: sus tramos, sus minutos y si cruza medianoche", () => {
    expect(celdaDelDia({ ...base, asignaciones: [fijo("n")], fecha: "2026-10-20" })).toMatchObject({
      tipo: "turno", nombre: "Noche", minutos: 480, cruzaMedianoche: true,
    });
  });

  it("sábado: libre para un turno de L–V, y horario de sábado para el del taller", () => {
    expect(celdaDelDia({ ...base, asignaciones: [fijo("m")], fecha: "2026-10-24" })).toEqual({ tipo: "libre" });
    expect(celdaDelDia({ ...base, asignaciones: [fijo(TURNO_TALLER)], fecha: "2026-10-24" })).toMatchObject({
      tipo: "turno", nombre: "Taller", tramos: [{ inicio: "09:00", fin: "13:00" }], minutos: 240,
    });
  });

  it("horario del taller entre semana: partido", () => {
    expect(celdaDelDia({ ...base, asignaciones: [fijo(TURNO_TALLER)], fecha: "2026-10-20" })).toMatchObject({
      tipo: "turno", minutos: 510, tramos: [{ inicio: "08:30", fin: "13:30" }, { inicio: "15:00", fin: "18:30" }],
    });
  });

  it("un turno desactivado o inexistente deja a la persona sin horario", () => {
    expect(celdaDelDia({ ...base, asignaciones: [fijo("viejo")], fecha: "2026-10-20" })).toEqual({ tipo: "sin_horario" });
    expect(celdaDelDia({ ...base, asignaciones: [fijo("nada")], fecha: "2026-10-20" })).toEqual({ tipo: "sin_horario" });
  });
});

describe("filaDeLaSemana", () => {
  it("suma solo las horas de turno; la ausencia y el cierre no cuentan", () => {
    const fila = filaDeLaSemana({
      empleado: { id: "e1", nombre: "Iván", centro: "Tarragona" },
      asignaciones: [rotativo],
      turnos: TURNOS,
      fecha: "2026-10-21",
      config: CONFIG,
      ausenciaDe: (_, f) => (f === "2026-10-23" ? "vacaciones" : null),
    });
    expect(fila.resumen).toBe("rotativo · semana 2 de 3");
    expect(fila.celdas.map((c) => c.tipo)).toEqual([
      "turno", "turno", "turno", "turno", "ausencia", "libre", "cerrado",
    ]);
    expect(fila.minutos).toBe(4 * 480);
  });

  it("personas en turno por día", () => {
    const f1 = filaDeLaSemana({ empleado: { id: "e1", nombre: "A" }, asignaciones: [fijo("m")], turnos: TURNOS, fecha: "2026-10-21", config: CONFIG });
    const f2 = filaDeLaSemana({ empleado: { id: "e2", nombre: "B" }, asignaciones: [], turnos: TURNOS, fecha: "2026-10-21", config: CONFIG });
    expect(personasEnTurnoPorDia([f1, f2])).toEqual([1, 1, 1, 1, 1, 0, 0]);
  });
});

describe("validaciones", () => {
  it("turno: nombre, tramos y orden", () => {
    expect(validarTurno({ nombre: "", tramos: [] })).toHaveLength(2);
    expect(validarTurno({ nombre: "X", tramos: [{ inicio: "08:00", fin: "08:00" }] })).toHaveLength(1);
    expect(validarTurno({ nombre: "X", tramos: [{ inicio: "08:00", fin: "13:00" }, { inicio: "12:00", fin: "18:00" }] })).toHaveLength(1);
    expect(validarTurno({ nombre: "Noche", tramos: [{ inicio: "22:00", fin: "06:00" }], dias: [1, 2, 3, 4, 5] })).toEqual([]);
  });

  it("asignación: turnos, fechas y rotación con al menos dos", () => {
    expect(validarAsignacion({ tipo: "fijo", turnoIds: [], vigenteDesde: "" })).toHaveLength(2);
    expect(validarAsignacion({ tipo: "rotativo", turnoIds: ["m"], vigenteDesde: "2026-10-19", semanaInicio: "" })).toHaveLength(2);
    expect(validarAsignacion({ tipo: "rotativo", turnoIds: ["m", "t"], vigenteDesde: "2026-10-19", semanaInicio: "2026-10-19" })).toEqual([]);
  });
});
