import { describe, expect, it } from "vitest";
import { chipDeSituacion, claseDeSituacion, emojiDeSituacion, situacionDeTecnico } from "./colorEstadoTecnico";

describe("situacionDeTecnico", () => {
  it("libre es verde", () => {
    expect(claseDeSituacion(situacionDeTecnico("disponible"))).toContain("bg-green-200");
  });
  it("trabajando como responsable es rojo subido; como apoyo, rojo claro", () => {
    expect(claseDeSituacion(situacionDeTecnico("ocupado"))).toContain("bg-red-400");
    expect(claseDeSituacion(situacionDeTecnico("refuerzo"))).toContain("bg-red-400");
    expect(claseDeSituacion(situacionDeTecnico("disponible", { mantenimientoEnTaller: true }))).toContain("bg-red-400");
    expect(situacionDeTecnico("ocupado", { trabajando: true, apoyo: true })).toBe("apoyo");
    expect(claseDeSituacion("apoyo")).toContain("bg-red-100");
    expect(chipDeSituacion("trabajando")).toBe("bg-red-900 text-white");
    expect(chipDeSituacion("apoyo")).toBe("bg-red-600 text-white");
  });
  it("baja es rojo fuerte con la fila entera maciza y letras blancas", () => {
    expect(claseDeSituacion(situacionDeTecnico("baja"))).toContain("bg-red-600");
    expect(claseDeSituacion(situacionDeTecnico("baja"))).toContain("text-white");
  });
  it("vacaciones y permiso son amarillo, y su chip lleva letras oscuras", () => {
    expect(claseDeSituacion(situacionDeTecnico("vacaciones"))).toContain("bg-yellow-200");
    expect(claseDeSituacion(situacionDeTecnico("permiso"))).toContain("bg-yellow-200");
    expect(chipDeSituacion("ausente")).toContain("text-slate-900");
  });
  it("todos los chips macizos llevan letras blancas salvo el amarillo", () => {
    for (const s of ["libre", "trabajando", "apoyo", "baja", "fuera", "formacion", "reservado", "otro"] as const) {
      expect(chipDeSituacion(s), s).toContain("text-white");
    }
  });
  it("otro taller y mantenimiento fuera son azul", () => {
    expect(claseDeSituacion(situacionDeTecnico("otro_taller"))).toContain("bg-blue-200");
    expect(claseDeSituacion(situacionDeTecnico("disponible", { mantenimientoFuera: true }))).toContain("bg-blue-200");
  });
  it("una asistencia en carretera es trabajar de responsable: rojo subido", () => {
    expect(claseDeSituacion(situacionDeTecnico("disponible", { enAsistencia: true }))).toContain("bg-red-400");
  });
  it("un trabajo activo manda sobre una ficha que diga «disponible»", () => {
    expect(situacionDeTecnico("disponible", { trabajando: true })).toBe("trabajando");
  });
});

describe("emojiDeSituacion", () => {
  it("las tres caras que pidió el taller", () => {
    expect(emojiDeSituacion(situacionDeTecnico("disponible"))).toBe("😀");
    expect(emojiDeSituacion(situacionDeTecnico("ocupado"))).toBe("😅");
    expect(emojiDeSituacion(situacionDeTecnico("baja"))).toBe("🥵");
  });

  it("una asistencia en carretera es trabajar, también en la cara", () => {
    expect(emojiDeSituacion(situacionDeTecnico("disponible", { enAsistencia: true }))).toBe("😅");
  });

  it("ninguna situación se queda sin cara", () => {
    for (const estado of ["disponible", "ocupado", "baja", "vacaciones", "permiso", "otro_taller", "formacion", "refuerzo", "supervisor"]) {
      expect(emojiDeSituacion(situacionDeTecnico(estado)), estado).not.toBe("");
    }
    expect(emojiDeSituacion(situacionDeTecnico("disponible", { reservadoParaValidar: true }))).not.toBe("");
  });
});
