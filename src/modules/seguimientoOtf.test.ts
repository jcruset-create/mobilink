import { describe, expect, it } from "vitest";
import { avisoDeOtf, faseDeOtf, otfSigueEnCurso, pasoDeOtfGps, pasosDeOtf } from "./seguimientoOtf";

const L = { radioTallerM: 300, radioBaseM: 300 };

describe("faseDeOtf y pasos", () => {
  it("planificada recién creada: asignada", () => {
    expect(faseDeOtf({ status: "planificada", createdAtMs: 1 })).toBe("asignada");
  });
  it("con salida del taller: en camino; en la base: en punto; con un trabajo tocado: trabajando", () => {
    expect(faseDeOtf({ status: "planificada", createdAtMs: 1, departedAtMs: 2 })).toBe("en_camino");
    expect(faseDeOtf({ status: "en_curso", createdAtMs: 1, departedAtMs: 2, arrivedAtBaseMs: 3 })).toBe("en_punto");
    expect(faseDeOtf({ status: "en_curso", createdAtMs: 1, arrivedAtBaseMs: 3, primerTrabajoMs: 4 })).toBe("trabajando");
  });
  it("en la base según Assist aunque el GPS no dejara hora", () => {
    expect(faseDeOtf({ status: "en_curso", createdAtMs: 1 })).toBe("en_punto");
  });
  it("finalizada, vuelta y llegada", () => {
    expect(faseDeOtf({ status: "finalizada", createdAtMs: 1, finishedAtMs: 5 })).toBe("finalizada");
    expect(faseDeOtf({ status: "finalizada", createdAtMs: 1, finishedAtMs: 5, enCaminoBaseAtMs: 6 })).toBe("en_camino_base");
    expect(faseDeOtf({ status: "finalizada", createdAtMs: 1, finishedAtMs: 5, enCaminoBaseAtMs: 6, arrivedAtWorkshopMs: 7 })).toBe("llegada_taller");
    // Finalizada desde Assist sin hora de fin: igualmente finalizada.
    expect(faseDeOtf({ status: "finalizada", createdAtMs: 1 })).toBe("finalizada");
  });
  it("la tira tiene los siete pasos con hecho/actual/pendiente", () => {
    const p = pasosDeOtf({ status: "en_curso", createdAtMs: 1, departedAtMs: 2, arrivedAtBaseMs: 3 });
    expect(p.map((x) => x.estado)).toEqual(["hecho", "hecho", "actual", "pendiente", "pendiente", "pendiente", "pendiente"]);
    expect(p.map((x) => x.etiqueta)).toEqual(["Asignada", "En camino", "En punto", "Trabajando", "Finalizada", "En camino a taller", "En taller"]);
  });
});

describe("otfSigueEnCurso", () => {
  it("hasta que entra en el taller", () => {
    expect(otfSigueEnCurso({ status: "planificada" })).toBe(true);
    expect(otfSigueEnCurso({ status: "en_curso" })).toBe(true);
    expect(otfSigueEnCurso({ status: "finalizada" })).toBe(true);
    expect(otfSigueEnCurso({ status: "finalizada", arrivedAtWorkshopMs: 1 })).toBe(false);
    expect(otfSigueEnCurso({ status: "cancelada" })).toBe(false);
  });
});

describe("pasoDeOtfGps", () => {
  it("salida del taller: se arma dentro y dispara fuera", () => {
    const o = { status: "planificada" };
    expect(pasoDeOtfGps(o, { ...L, distTallerM: 100, distBaseM: 9000 }, 10)).toEqual({ salidaArmada: true });
    expect(pasoDeOtfGps({ ...o, salidaArmada: true }, { ...L, distTallerM: 100, distBaseM: 9000 }, 10)).toEqual({});
    expect(pasoDeOtfGps({ ...o, salidaArmada: true }, { ...L, distTallerM: 900, distBaseM: 8000 }, 10)).toMatchObject({ departedAtMs: 10 });
    expect(pasoDeOtfGps(o, { ...L, distTallerM: 900, distBaseM: 8000 }, 10)).toEqual({});
  });
  it("vuelta: sale de la base con margen; llegada: entra en el taller", () => {
    expect(pasoDeOtfGps({ status: "finalizada" }, { ...L, distTallerM: 9000, distBaseM: 400 }, 10)).toEqual({});
    expect(pasoDeOtfGps({ status: "finalizada" }, { ...L, distTallerM: 9000, distBaseM: 500 }, 10)).toMatchObject({ enCaminoBaseAtMs: 10 });
    expect(pasoDeOtfGps({ status: "finalizada", enCaminoBaseAtMs: 5 }, { ...L, distTallerM: 200, distBaseM: 9000 }, 10)).toMatchObject({ arrivedAtWorkshopMs: 10 });
    expect(pasoDeOtfGps({ status: "finalizada", enCaminoBaseAtMs: 5, arrivedAtWorkshopMs: 6 }, { ...L, distTallerM: 200, distBaseM: 9000 }, 10)).toEqual({});
  });
  it("en la base no se toca nada", () => {
    expect(pasoDeOtfGps({ status: "en_curso" }, { ...L, distTallerM: 9000, distBaseM: 50 }, 10)).toEqual({});
  });
});

describe("avisoDeOtf", () => {
  it("solo en camino, ida o vuelta", () => {
    expect(avisoDeOtf({ status: "planificada", departedAtMs: 1 }, { minutos: 6, km: "9.5" })).toMatchObject({ titulo: "El técnico está en camino", tono: "azul" });
    expect(avisoDeOtf({ status: "finalizada", enCaminoBaseAtMs: 1 }, null)).toMatchObject({ titulo: "El técnico vuelve al taller", tono: "teal" });
    expect(avisoDeOtf({ status: "en_curso" }, null)).toBeNull();
  });
});
