import { describe, expect, it } from "vitest";

import { hitosDeAsistencia, lineaDeTiempo, resumenMovimientos, ventanaDeAsistencia, type Trayecto } from "./movimientos.ts";

const t = (ini: string, fin: string, km: number, hasta: string, extra: Partial<Trayecto> = {}): Trayecto => ({
  start_time: `2026-11-24T${ini}:00Z`,
  end_time: `2026-11-24T${fin}:00Z`,
  start_latitude: 41_100_000, start_longitude: 1_200_000,
  end_latitude: 41_150_000, end_longitude: 1_250_000,
  end_postext: hasta, distance: km * 1000, duration: 0, ...extra,
});
const ms = (hhmm: string) => Date.parse(`2026-11-24T${hhmm}:00Z`);

describe("movimientos de la furgoneta en una asistencia", () => {
  const trayectos = [
    t("09:10", "09:40", 28.4, "AP-7 km 148"),
    t("09:41", "09:43", 0.3, "AP-7 km 148"), // 1 min parado: no es parada
    t("10:30", "11:05", 30.2, "Taller Tarragona"),
  ];

  it("trayectos y paradas intercalados; un hueco corto no es parada", () => {
    const tramos = lineaDeTiempo(trayectos);
    expect(tramos.map((x) => x.tipo)).toEqual(["trayecto", "trayecto", "parada", "trayecto"]);
    const parada = tramos[2];
    expect(parada).toMatchObject({ tipo: "parada", n: 1, lugar: "AP-7 km 148", segundos: 47 * 60 });
    expect(parada.tipo === "parada" && parada.lat).toBeCloseTo(41.15);
  });

  it("los hitos de la asistencia caen en su parada", () => {
    const tramos = lineaDeTiempo(trayectos, [
      { etiqueta: "Llegada al punto", ms: ms("09:45") },
      { etiqueta: "Finalizada", ms: ms("10:25") },
      { etiqueta: "Llegada al taller", ms: ms("11:06") },
    ]);
    const parada = tramos.find((x) => x.tipo === "parada");
    expect(parada?.tipo === "parada" && parada.hitos).toEqual(["Llegada al punto", "Finalizada"]);
  });

  it("los totales", () => {
    expect(resumenMovimientos(lineaDeTiempo(trayectos))).toEqual({
      km: 58.9, conduccionSeg: (30 + 2 + 35) * 60, paradoSeg: 47 * 60, trayectos: 3, paradas: 1,
    });
  });

  it("sin trayectos, nada", () => {
    expect(lineaDeTiempo([])).toEqual([]);
    expect(resumenMovimientos([])).toMatchObject({ km: 0, paradas: 0 });
  });

  it("la ventana: de la salida a la llegada al taller, o lo que haya", () => {
    expect(ventanaDeAsistencia({ departedAtMs: 100, arrivedAtWorkshopMs: 900 })).toEqual({ desdeMs: 100, hastaMs: 900 });
    expect(ventanaDeAsistencia({ assignedAtMs: 50, finishedAtMs: 500 })).toEqual({ desdeMs: 50, hastaMs: 500 });
    expect(ventanaDeAsistencia({ createdAtMs: 10 }, 70)).toEqual({ desdeMs: 10, hastaMs: 70 });
  });

  it("los hitos con hora, en orden", () => {
    expect(hitosDeAsistencia({ finishedAtMs: 30, departedAtMs: 10, arrivedAtPointMs: null }).map((h) => h.etiqueta))
      .toEqual(["Salida", "Finalizada"]);
  });
});
