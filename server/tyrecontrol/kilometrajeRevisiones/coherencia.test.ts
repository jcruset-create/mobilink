/**
 * Las cotas que decide si un odómetro se escribe o no.
 *
 * Son la segunda barrera: la primera —dos ventanas del proveedor que
 * coincidan— vive en el Hub, y no basta porque las dos salen de la misma API.
 * Si Movertis tiene un mal rato coherente, las dos mienten igual.
 */

import { describe, expect, it } from "vitest";
import { esCoherente, instanteDeRevision, TOLERANCIA_KM } from "./coherencia.ts";

const ANTERIOR = { km: 1_200_000, fecha: "2026-02-10" };
const SIGUIENTE = { km: 1_260_000, fecha: "2026-04-12" };

describe("esCoherente()", () => {
  it("entre las dos vecinas, pasa", () => {
    expect(esCoherente(1_245_311, { anterior: ANTERIOR, siguiente: SIGUIENTE })).toEqual({ estado: "ok" });
  });

  it("un odómetro no retrocede", () => {
    const v = esCoherente(1_150_000, { anterior: ANTERIOR });
    expect(v.estado).toBe("rechazado");
    if (v.estado === "ok") return;
    expect(v.motivo).toContain("no retrocede");
    expect(v.motivo).toContain("2026-02-10");
  });

  it("tampoco adelanta a una revisión posterior", () => {
    expect(esCoherente(1_300_000, { siguiente: SIGUIENTE }).estado).toBe("rechazado");
  });

  it("el mes ya sincronizado es la cota independiente: acota por los dos lados", () => {
    const mes = { inicial: 1_243_917, final: 1_247_500 };
    expect(esCoherente(1_245_311, { mes }).estado).toBe("ok");
    expect(esCoherente(1_200_870, { mes }).estado).toBe("rechazado");
    expect(esCoherente(1_300_000, { mes }).estado).toBe("rechazado");
  });

  it("la respuesta mentirosa medida cae por la cota del mes aunque no haya vecinas", () => {
    // 19/9/2026: la API devolvió 1.200.870,91 km, 65.000 por debajo del día
    // anterior, con pinta de dato bueno. Sin cotas nadie lo habría visto.
    const v = esCoherente(1_200_870.91, { mes: { inicial: 1_264_091, final: 1_266_446 } });
    expect(v.estado).toBe("rechazado");
    if (v.estado === "ok") return;
    expect(v.motivo).toContain("fuera del mes");
  });

  it("sin cotas, solo se exige que sea un odómetro de verdad", () => {
    expect(esCoherente(1_245_311).estado).toBe("ok");
    expect(esCoherente(0).estado).toBe("rechazado");
    expect(esCoherente(-5).estado).toBe("rechazado");
    expect(esCoherente(Number.NaN).estado).toBe("rechazado");
  });

  it("la tolerancia cubre el redondeo y no una discrepancia", () => {
    expect(TOLERANCIA_KM).toBe(1);
    expect(esCoherente(ANTERIOR.km - 0.5, { anterior: ANTERIOR }).estado).toBe("ok");
    expect(esCoherente(ANTERIOR.km - 50, { anterior: ANTERIOR }).estado).toBe("rechazado");
  });
});

describe("instanteDeRevision()", () => {
  it("con `medido_at` hay instante exacto", () => {
    const r = instanteDeRevision({ medido_at: "2026-03-15T13:27:00Z", fecha_revision: "2026-03-15" });
    expect(r?.exacto).toBe(true);
    expect(r?.instante.toISOString()).toBe("2026-03-15T13:27:00.000Z");
  });

  it("sin `medido_at` se coge el PRINCIPIO del día, que es la cota inferior", () => {
    const r = instanteDeRevision({ medido_at: null, fecha_revision: "2026-03-15" });
    expect(r?.exacto).toBe(false);
    expect(r?.instante.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("una fecha ilegible no se adivina", () => {
    expect(instanteDeRevision({ fecha_revision: "" })).toBeNull();
    expect(instanteDeRevision({ fecha_revision: "ayer" })).toBeNull();
  });
});
