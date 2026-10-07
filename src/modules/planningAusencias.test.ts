import { describe, expect, it } from "vitest";
import { DEFAULT_AGENDA_CONFIG, type AgendaConfig } from "./agendaConfig";
import { diasDelAnio, faltanPorDia, filaDeTecnico, picoDeAusencias } from "./planningAusencias";

const config: AgendaConfig = {
  ...DEFAULT_AGENDA_CONFIG,
  holidays: [
    { date: "2026-09-11", label: "Diada de Catalunya", yearly: true },
    { date: "2026-09-23", label: "Santa Tecla", yearly: true },
    { date: "2026-12-07", label: "Puente de la Constitución", yearly: false },
  ],
  closedSaturdaysInAugust: true,
};
const HOY = "2026-10-07";
const dias = diasDelAnio(2026, config, HOY);

describe("diasDelAnio", () => {
  it("son 365 y hoy está marcado", () => {
    expect(dias).toHaveLength(365);
    expect(dias.filter((d) => d.hoy).map((d) => d.fecha)).toEqual([HOY]);
  });
  it("los festivos del calendario salen cerrados y con su nombre", () => {
    const diada = dias.find((d) => d.fecha === "2026-09-11")!;
    expect(diada.cerrado).toBe(true);
    expect(diada.motivo).toBe("Diada de Catalunya");
    expect(dias.find((d) => d.fecha === "2026-12-07")!.motivo).toContain("Puente");
  });
  it("los sábados de agosto cierran y lo dicen", () => {
    const s = dias.find((d) => d.fecha === "2026-08-08")!;
    expect(s.semana).toBe(5);
    expect(s.cerrado).toBe(true);
    expect(s.motivo).toBe("Sábado de agosto");
    // un sábado de otro mes no
    expect(dias.find((d) => d.fecha === "2026-07-11")!.cerrado).toBe(false);
  });
  it("un domingo es finde pero no se marca como cierre", () => {
    const dom = dias.find((d) => d.fecha === "2026-10-04")!;
    expect(dom.finde).toBe(true);
    expect(dom.cerrado).toBe(false);
  });
});

describe("filaDeTecnico", () => {
  const estados = [
    { id: "1", techName: "Ramón", status: "vacaciones", startDate: "2026-10-05", endDate: "2026-10-09", createdAtMs: 1 },
    { id: "2", techName: "Ramón", status: "baja", startDate: "2026-12-20", endDate: "2026-12-22", createdAtMs: 2 },
    { id: "3", techName: "José", status: "disponible", startDate: "2026-10-05", endDate: "2026-10-09", createdAtMs: 3 },
  ] as any[];
  const fila = filaDeTecnico("Ramón", estados, dias, HOY);

  it("pinta el rango con inicio y fin, y lo futuro rayado", () => {
    const c5 = fila.find((c) => c.fecha === "2026-10-05")!;
    const c7 = fila.find((c) => c.fecha === "2026-10-07")!;
    const c9 = fila.find((c) => c.fecha === "2026-10-09")!;
    expect(c5).toMatchObject({ estado: "vacaciones", inicio: true, fin: false, programado: false });
    expect(c7.programado).toBe(false);
    expect(c9).toMatchObject({ fin: true, programado: true, rango: "05/10 → 09/10" });
    expect(fila.find((c) => c.fecha === "2026-10-10")!.estado).toBeNull();
  });
  it("«disponible» no es una ausencia", () => {
    expect(filaDeTecnico("José", estados, dias, HOY).every((c) => c.estado === null)).toBe(true);
  });
  it("cuenta los que faltan y el pico", () => {
    const filas = [fila, filaDeTecnico("José", estados, dias, HOY)];
    const faltan = faltanPorDia(filas, dias.length);
    expect(faltan[dias.findIndex((d) => d.fecha === "2026-10-06")]).toBe(1);
    expect(picoDeAusencias(faltan, dias)).toEqual({ cuantos: 1, desde: "2026-10-05", hasta: "2026-10-09" });
  });
});
