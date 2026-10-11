import { describe, it, expect } from "vitest";
import {
  textoRecorrido, textoRitmo, textoMotivos, textoDecision, textoCobertura, etiquetaMotivo,
} from "./recorridoEstimado";

describe("textoRecorrido", () => {
  it("un recorrido plausible se enseña como estimado", () => {
    expect(textoRecorrido({ km_estado: "utilizables", recorrido_km: 30000, km_montaje: 1, km_desmontaje: 2 }))
      .toEqual({ texto: "30.000 km (estimado)", aviso: false });
  });
  it("un recorrido anómalo pendiente se enseña con su recorrido y avisa", () => {
    const r = textoRecorrido({ km_estado: "anomalos", recorrido_km: 626290, km_montaje: 127424, km_desmontaje: 753714, uso_estadistico: "pendiente" });
    expect(r.texto).toBe("626.290 km (estimado, pendiente de validar)");
    expect(r.aviso).toBe(true);
  });
  it("aceptado a mano deja de avisar, pero sigue siendo estimado", () => {
    const r = textoRecorrido({ km_estado: "anomalos", recorrido_km: 626290, km_montaje: 1, km_desmontaje: 2, uso_estadistico: "aceptado" });
    expect(r.texto).toContain("estimado, aceptado a mano");
    expect(r.aviso).toBe(false);
  });
  it("rechazar NO borra el recorrido ni convierte los km en ausentes", () => {
    const r = textoRecorrido({ km_estado: "anomalos", recorrido_km: 626290, km_montaje: 1, km_desmontaje: 2, uso_estadistico: "rechazado" });
    expect(r.texto).toContain("626.290 km");
    expect(r.texto).toContain("rechazado a mano");
  });
  it("un kilometraje decreciente conserva los dos valores a la vista", () => {
    expect(textoRecorrido({ km_estado: "incompatibles", recorrido_km: null, km_montaje: 200000, km_desmontaje: 180000 }).texto)
      .toBe("incompatible (200.000 → 180.000)");
  });
  it("los ausentes no se interpretan como cero", () => {
    expect(textoRecorrido({ km_estado: "ausentes", recorrido_km: null, km_montaje: null, km_desmontaje: 1 }).texto).toBe("ausentes");
  });
});

describe("textoRitmo", () => {
  it("da el ritmo, los días y el límite", () => {
    // En español CLDR no agrupa los números de cuatro dígitos: 2000, no 2.000.
    expect(textoRitmo({ ritmo_km_dia: 6390.71, limite_km_dia: 2000, dias_intervalo: 98 }))
      .toBe("6390,71 km/día en 98 día(s) · límite 2000 km/día");
  });
  it("con cero días dice que no se divide entre cero", () => {
    expect(textoRitmo({ ritmo_km_dia: 126290, limite_km_dia: 2000, dias_intervalo: 0 }))
      .toContain("no se divide entre cero");
  });
  it("sin ritmo no inventa texto", () => {
    expect(textoRitmo({ ritmo_km_dia: null, limite_km_dia: 2000, dias_intervalo: 10 })).toBe("");
  });
});

describe("motivos", () => {
  it("traduce cada código", () => {
    expect(etiquetaMotivo("continuidad_pendiente")).toBe("continuidad pendiente");
    expect(etiquetaMotivo("km_anomalos_pendientes")).toBe("ritmo anómalo pendiente de validar");
  });
  it("un código desconocido se enseña tal cual en vez de desaparecer", () => {
    expect(etiquetaMotivo("lo_que_sea")).toBe("lo_que_sea");
  });
  it("un intervalo puede llevar varios motivos", () => {
    expect(textoMotivos(["km_anomalos_pendientes", "continuidad_pendiente"]))
      .toBe("ritmo anómalo pendiente de validar · continuidad pendiente");
  });
  it("sin motivos, texto vacío", () => {
    expect(textoMotivos(null)).toBe("");
    expect(textoMotivos([])).toBe("");
  });
});

describe("textoDecision", () => {
  it("pendiente es pendiente", () => {
    expect(textoDecision({ uso_estadistico: "pendiente", revisado_at: null, revisado_motivo: null })).toBe("pendiente");
  });
  it("una decisión lleva fecha y motivo", () => {
    expect(textoDecision({ uso_estadistico: "aceptado", revisado_at: "2026-10-11T08:00:00Z", revisado_motivo: "lo confirma el conductor" }))
      .toBe("aceptado el 2026-10-11: lo confirma el conductor");
  });
});

describe("textoCobertura", () => {
  const c = {
    incluidos: { n: 50, identificadas: 0, ocupaciones: 50 },
    poblacion: { intervalos: 1452 },
    excluidos: { n: 1402, motivos: [{ motivo: "sin_cierre", n: 1390 }, { motivo: "km_anomalos_pendientes", n: 2 }, { motivo: "continuidad_pendiente", n: 2 }] },
  };
  it("dice sobre cuántos sale la media y cuántos quedan fuera", () => {
    const t = textoCobertura(c);
    expect(t).toContain("Sobre 50 de 1452 intervalos reconstruidos");
    expect(t).toContain("Fuera 1402");
  });
  it("separa gomas identificadas de ocupaciones de posición", () => {
    expect(textoCobertura(c)).toContain("0 de gomas identificadas y 50 ocupaciones de posición");
  });
  it("avisa de que los motivos se solapan y no suman", () => {
    expect(textoCobertura(c)).toContain("no suman");
  });
  it("sin exclusiones no habla de exclusiones", () => {
    expect(textoCobertura({ incluidos: { n: 3, identificadas: 3, ocupaciones: 0 }, poblacion: { intervalos: 3 }, excluidos: { n: 0, motivos: [] } }))
      .not.toContain("Fuera");
  });
});
