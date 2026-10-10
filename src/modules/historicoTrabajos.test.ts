import { describe, expect, it } from "vitest";
import {
  agrupaPorDia,
  coincideTexto,
  estadoHistorico,
  fechaDelHistorico,
  filtraHistorico,
  minutosDelHistorico,
  rangoUltimoMes,
  resumenHistorico,
} from "./historicoTrabajos";
import type { Job } from "./workshopTypes";

const DIA = 24 * 60 * 60 * 1000;
const HOY = new Date(2026, 9, 10, 12, 0, 0).getTime();

/*
 * `status` va suelto a propósito: en ejecución un trabajo puede estar
 * "cancelado" —la vista de terminados lo filtra así desde siempre— pero el
 * tipo `JobStatus` no lo recoge. Se escribe aquí como llega de la base, que es
 * lo que el módulo tiene que saber tragar.
 */
function job(extra: Record<string, unknown> = {}): Job {
  return {
    id: 1, area: "tacografo", plate: "8690GHK", status: "cerrado",
    assignedNames: ["José"], reason: "", createdAtMs: HOY - DIA, closedAtMs: HOY,
    workedAccumulatedMinutes: 105, customerName: "Autocares Plana",
    ...extra,
  } as unknown as Job;
}

describe("estadoHistorico", () => {
  it("cerrado es realizado; cancelado y eliminado, cancelado", () => {
    expect(estadoHistorico(job({ status: "cerrado" }))).toBe("realizado");
    expect(estadoHistorico(job({ status: "cancelado" }))).toBe("cancelado");
    expect(estadoHistorico(job({ status: "eliminado" }))).toBe("cancelado");
  });

  it("lo que está en marcha no es histórico", () => {
    for (const s of ["activo", "espera", "validacion", "parado"]) {
      expect(estadoHistorico(job({ status: s })), s).toBeNull();
    }
  });
});

describe("fechaDelHistorico", () => {
  it("manda la de cierre", () => {
    expect(fechaDelHistorico(job())).toBe(HOY);
  });

  it("un cancelado no tiene cierre y cae por la de creación, no desaparece", () => {
    const c = job({ status: "cancelado", closedAtMs: undefined });
    expect(fechaDelHistorico(c)).toBe(HOY - DIA);
    expect(filtraHistorico([c], { estado: "todos" })).toHaveLength(1);
  });
});

describe("minutosDelHistorico", () => {
  it("cuenta los trabajados, y un valor roto no resta", () => {
    expect(minutosDelHistorico(job())).toBe(105);
    expect(minutosDelHistorico(job({ workedAccumulatedMinutes: null }))).toBe(0);
    expect(minutosDelHistorico(job({ workedAccumulatedMinutes: -5 }))).toBe(0);
  });
});

describe("coincideTexto", () => {
  const j = job({ plate: "8690-GHK", customerName: "Autocares Plana", ptNumero: "25-04567" });

  it("busca por matrícula con y sin guiones", () => {
    expect(coincideTexto(j, "8690GHK")).toBe(true);
    expect(coincideTexto(j, "8690-ghk")).toBe(true);
  });
  it("por cliente, sin acentos ni mayúsculas", () => {
    expect(coincideTexto(j, "autocares")).toBe(true);
  });
  it("y por número de parte", () => {
    expect(coincideTexto(j, "04567")).toBe(true);
  });
  it("sin texto entra todo; con texto que no está, nada", () => {
    expect(coincideTexto(j, "   ")).toBe(true);
    expect(coincideTexto(j, "ZZZZ")).toBe(false);
  });
});

describe("filtraHistorico", () => {
  const viejo = job({ id: 2, closedAtMs: HOY - 60 * DIA });
  const hoy = job({ id: 3 });
  const cancelado = job({ id: 4, status: "cancelado", closedAtMs: undefined, createdAtMs: HOY });
  const enMarcha = job({ id: 5, status: "activo" });
  const todos = [viejo, hoy, cancelado, enMarcha];

  it("deja fuera lo que está en marcha", () => {
    expect(filtraHistorico(todos, {}).map((j) => j.id)).not.toContain(5);
  });

  it("respeta el rango de fechas", () => {
    const { desdeMs, hastaMs } = rangoUltimoMes(HOY);
    const ids = filtraHistorico(todos, { desdeMs, hastaMs }).map((j) => j.id);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
  });

  it("filtra por estado y por área", () => {
    expect(filtraHistorico(todos, { estado: "cancelado" }).map((j) => j.id)).toEqual([4]);
    expect(filtraHistorico(todos, { area: "camion" })).toHaveLength(0);
  });

  it("ordena del más reciente al más viejo", () => {
    const ids = filtraHistorico(todos, {}).map((j) => j.id);
    expect(ids.indexOf(2)).toBe(ids.length - 1);
  });
});

describe("agrupaPorDia y resumen", () => {
  it("junta por día y suma sus minutos", () => {
    const a = job({ id: 1, closedAtMs: new Date(2026, 9, 10, 9, 0).getTime(), workedAccumulatedMinutes: 60 });
    const b = job({ id: 2, closedAtMs: new Date(2026, 9, 10, 18, 0).getTime(), workedAccumulatedMinutes: 30 });
    const c = job({ id: 3, closedAtMs: new Date(2026, 9, 9, 10, 0).getTime(), workedAccumulatedMinutes: 15 });

    const dias = agrupaPorDia(filtraHistorico([a, b, c], {}));
    expect(dias.map((d) => d.dia)).toEqual(["2026-10-10", "2026-10-09"]);
    expect(dias[0].minutos).toBe(90);
    expect(dias[0].trabajos).toHaveLength(2);
  });

  it("el resumen cuenta cancelados aparte", () => {
    const r = resumenHistorico([job(), job({ id: 2, status: "cancelado" })]);
    expect(r).toMatchObject({ total: 2, cancelados: 1 });
  });
});

describe("rangoUltimoMes", () => {
  it("va de hace un mes a hoy, de punta a punta del día", () => {
    const { desdeMs, hastaMs } = rangoUltimoMes(HOY);
    expect(new Date(desdeMs).getMonth()).toBe(8);
    expect(new Date(desdeMs).getHours()).toBe(0);
    expect(new Date(hastaMs).getHours()).toBe(23);
    expect(hastaMs).toBeGreaterThan(HOY);
  });
});
