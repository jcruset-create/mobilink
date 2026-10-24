import { describe, expect, it } from "vitest";
import { barraDeEstado, barrasARecolocar, estadosSinBarra, type BarraEstado } from "./barrasDeEstadoEnAgenda";
import type { ScheduledTechStatus } from "./techStatusScheduleHelpers";

const estado = (extra: Partial<ScheduledTechStatus>): ScheduledTechStatus => ({
  id: "s1",
  techName: "Alejandro",
  status: "vacaciones",
  startDate: "2026-11-09",
  endDate: "2026-11-22",
  createdAtMs: 1,
  workshopId: "sea-tarragona",
  ...extra,
});

describe("estadosSinBarra", () => {
  it("el caso de Alejandro: estado sin barra → hay que reconstruirla", () => {
    const barras: BarraEstado[] = [
      { id: 1, kind: "tech_status", title: "ANDRÉS · VACACIONES", startDate: "2026-11-02", endDate: "2026-12-06", color: "orange", techStatusId: "s2", techName: "Andrés", techStatus: "vacaciones" },
    ];
    expect(estadosSinBarra(barras, [estado({}), estado({ id: "s2", techName: "Andrés", startDate: "2026-11-02", endDate: "2026-12-06" })]).map((e) => e.id)).toEqual(["s1"]);
  });

  it("una barra con el id del estado lo cubre, aunque el taller sea otro", () => {
    const barras: BarraEstado[] = [
      { id: 1, kind: "tech_status", title: "x", startDate: "2026-11-09", endDate: "2026-11-22", color: "orange", techStatusId: "s1", workshopId: "sea-reus" },
    ];
    expect(estadosSinBarra(barras, [estado({})])).toEqual([]);
  });

  it("una barra antigua sin id cubre por nombre, estado y fechas", () => {
    const barras: BarraEstado[] = [
      { id: 1, kind: "tech_status", title: "x", startDate: "2026-11-09", endDate: "2026-11-22", color: "orange", techName: "Alejandro", techStatus: "vacaciones" },
    ];
    expect(estadosSinBarra(barras, [estado({})])).toEqual([]);
    // Con otras fechas ya no la cubre.
    expect(estadosSinBarra(barras, [estado({ endDate: "2026-11-23" })])).toHaveLength(1);
  });

  it("un recordatorio normal no cuenta como barra de estado", () => {
    const barras: BarraEstado[] = [
      { id: 1, kind: "normal", title: "ITV", startDate: "2026-11-09", endDate: "2026-11-22", color: "red", techName: "Alejandro", techStatus: "vacaciones" },
    ];
    expect(estadosSinBarra(barras, [estado({})])).toHaveLength(1);
  });

  it("un estado a medio guardar (sin nombre o sin fechas) no genera barra", () => {
    expect(estadosSinBarra([], [estado({ techName: "" }), estado({ endDate: "" })])).toEqual([]);
  });
});

describe("barraDeEstado", () => {
  it("mismo texto y color que si se hubiera creado desde la agenda", () => {
    expect(barraDeEstado(estado({}), 77)).toMatchObject({
      id: 77,
      kind: "tech_status",
      title: "ALEJANDRO · VACACIONES",
      color: "orange",
      techStatusId: "s1",
      techName: "Alejandro",
      techStatus: "vacaciones",
      workshopId: "sea-tarragona",
    });
    expect(barraDeEstado(estado({ status: "baja" }), 1).color).toBe("red");
    expect(barraDeEstado(estado({ status: "otro_taller" }), 1).title).toBe("ALEJANDRO · EN OTRO TALLER");
  });
});

describe("barrasARecolocar", () => {
  const norm = (t: unknown) => (t ? String(t) : "sea-tarragona");
  it("la barra en otro taller que su estado se devuelve con el taller del estado", () => {
    const barras: BarraEstado[] = [
      { id: 1, kind: "tech_status", title: "x", startDate: "2026-11-09", endDate: "2026-11-22", color: "orange", techStatusId: "s1", workshopId: "sea-reus" },
    ];
    expect(barrasARecolocar(barras, [estado({ workshopId: "sea-tarragona" })], norm)).toEqual([
      { ...barras[0], workshopId: "sea-tarragona" },
    ]);
  });
  it("sin taller en los dos (= Tarragona) no hay nada que recolocar", () => {
    const barras: BarraEstado[] = [
      { id: 1, kind: "tech_status", title: "x", startDate: "2026-11-09", endDate: "2026-11-22", color: "orange", techStatusId: "s1", workshopId: null },
    ];
    expect(barrasARecolocar(barras, [estado({ workshopId: "sea-tarragona" })], norm)).toEqual([]);
  });
});
