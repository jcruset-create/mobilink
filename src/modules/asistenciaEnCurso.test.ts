import { describe, expect, it } from "vitest";
import { ETIQUETA_ASISTENCIA_EN_CURSO, asistenciaEnCurso } from "./asistenciaEnCurso";

describe("asistenciaEnCurso", () => {
  it("sigue en curso mientras vuelve al taller", () => {
    for (const s of ["asignada", "en_camino", "en_punto", "inicio_reparacion", "finalizada", "en_camino_base"]) {
      expect(asistenciaEnCurso(s), s).toBe(true);
      expect(ETIQUETA_ASISTENCIA_EN_CURSO[s]).toBeTruthy();
    }
  });
  it("se acaba al llegar al taller; tampoco cuentan las canceladas ni las pendientes", () => {
    for (const s of ["llegada_taller", "cancelada", "redirigida", "pendiente", "", null, undefined]) {
      expect(asistenciaEnCurso(s), String(s)).toBe(false);
    }
  });
});
