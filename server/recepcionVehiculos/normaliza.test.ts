import { describe, expect, it } from "vitest";

import { normalizeRecepcionRow } from "./normaliza.ts";

describe("normalizeRecepcionRow", () => {
  /*
   * El motivo de que esto exista: `pg` serializa BIGINT como cadena. Sin esta
   * conversión, `recepcion.id === job.recepcionId` es false para dos números
   * iguales y no salta ningún error. Se busca el fallo en la lógica durante
   * horas y estaba en el driver.
   */
  it("convierte los BIGINT que pg devuelve como cadena", () => {
    const fila = normalizeRecepcionRow({
      id: "1700000000000",
      creadaAtMs: "1700000000000",
      jobId: "42",
      confianzaOcr: "0.91",
    });
    expect(fila.id).toBe(1_700_000_000_000);
    expect(fila.creadaAtMs).toBe(1_700_000_000_000);
    expect(fila.jobId).toBe(42);
    expect(fila.confianzaOcr).toBeCloseTo(0.91);
  });

  it("deja en null lo que no hay, sin convertirlo en 0", () => {
    const fila = normalizeRecepcionRow({ id: "1", jobId: null, resueltaAtMs: "" });
    expect(fila.jobId).toBeNull();
    expect(fila.resueltaAtMs).toBeNull();
  });

  it("las fotos salen como lista tanto si vienen en JSONB como en texto", () => {
    expect(normalizeRecepcionRow({ fotos: [{ url: "a" }] }).fotos).toHaveLength(1);
    expect(normalizeRecepcionRow({ fotos: '[{"url":"a"}]' }).fotos).toHaveLength(1);
    expect(normalizeRecepcionRow({ fotos: "no es json" }).fotos).toEqual([]);
    expect(normalizeRecepcionRow({}).fotos).toEqual([]);
  });

  it("el booleano aguanta la cadena 'true' que a veces llega del driver", () => {
    expect(normalizeRecepcionRow({ urgente: "true" }).urgente).toBe(true);
    expect(normalizeRecepcionRow({ urgente: false }).urgente).toBe(false);
  });
});
