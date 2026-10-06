import { describe, expect, it } from "vitest";
import { claseDeSituacion, situacionDeTecnico } from "./colorEstadoTecnico";

describe("situacionDeTecnico", () => {
  it("libre es gris, no verde", () => {
    expect(claseDeSituacion(situacionDeTecnico("disponible"))).toContain("bg-slate-200");
  });
  it("trabajando es verde", () => {
    expect(claseDeSituacion(situacionDeTecnico("ocupado"))).toContain("bg-green-200");
    expect(claseDeSituacion(situacionDeTecnico("refuerzo"))).toContain("bg-green-200");
    expect(claseDeSituacion(situacionDeTecnico("disponible", { mantenimientoEnTaller: true }))).toContain("bg-green-200");
  });
  it("baja es rojo", () => {
    expect(claseDeSituacion(situacionDeTecnico("baja"))).toContain("bg-red-200");
  });
  it("vacaciones y permiso son naranja", () => {
    expect(claseDeSituacion(situacionDeTecnico("vacaciones"))).toContain("bg-orange-200");
    expect(claseDeSituacion(situacionDeTecnico("permiso"))).toContain("bg-orange-200");
  });
  it("otro taller y mantenimiento fuera son azul", () => {
    expect(claseDeSituacion(situacionDeTecnico("otro_taller"))).toContain("bg-blue-200");
    expect(claseDeSituacion(situacionDeTecnico("disponible", { mantenimientoFuera: true }))).toContain("bg-blue-200");
  });
  it("una asistencia en carretera es trabajar: verde", () => {
    expect(claseDeSituacion(situacionDeTecnico("disponible", { enAsistencia: true }))).toContain("bg-green-200");
  });
  it("un trabajo activo manda sobre una ficha que diga «disponible»", () => {
    expect(situacionDeTecnico("disponible", { trabajando: true })).toBe("trabajando");
  });
});
