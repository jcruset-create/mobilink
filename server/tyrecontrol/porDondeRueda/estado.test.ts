import { describe, expect, it } from "vitest";
import { estadoSinDatos } from "./resumen.ts";

const V = { desde: 6, hasta: 10 };
const d = (x: Partial<{ ok: number; sinPuntos: number; errores: number; ultimoError: string | null }> = {}) =>
  ({ ok: 0, sinPuntos: 0, errores: 0, ultimoError: null, ...x });

describe("por qué un vehículo marcado no tiene datos", () => {
  it("con algún día bueno, se enseña el reparto", () => {
    expect(estadoSinDatos(d({ ok: 3, errores: 1 }), null, V)).toBeNull();
  });
  it("un error se dice con su motivo", () => {
    const e = estadoSinDatos(d({ errores: 2, ultimoError: "Movertis: 401" }), null, V);
    expect(e).toEqual({ tono: "error", texto: "error en 2 días: Movertis: 401" });
  });
  it("sin posiciones GPS, se avisa", () => {
    expect(estadoSinDatos(d({ sinPuntos: 1 }), null, V)?.texto).toContain("sin posiciones GPS");
  });
  it("sin ningún día y la última vuelta esperando el mapa: cargando el mapa", () => {
    const e = estadoSinDatos(d(), { at: "2026-11-27T08:00:00Z", resumen: "", esperandoMapa: true }, V);
    expect(e?.texto).toContain("cargando el mapa");
  });
  it("sin ningún día ni vuelta: pendiente, con el horario", () => {
    expect(estadoSinDatos(d(), null, V)?.texto).toBe("pendiente: se analiza cada mañana entre las 6:00 y las 10:00");
  });
});
