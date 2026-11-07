import { describe, it, expect } from "vitest";
import {
  textoRecorrido, textoRitmo, textoMotivos, textoDecision, textoDecisionContinuidad,
  textoCobertura, etiquetaMotivo,
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
  it("el mismo día NO publica un km/día: no se ha observado ninguno", () => {
    const t = textoRitmo({ ritmo_km_dia: null, limite_km_dia: 2000, dias_intervalo: 0, orden_desconocido: true });
    expect(t).toContain("no se conoce el orden de los trabajos ni la duración");
    expect(t).not.toMatch(/\d+ km\/día en/);
  });
  it("sin ritmo y con días no inventa texto", () => {
    expect(textoRitmo({ ritmo_km_dia: null, limite_km_dia: 2000, dias_intervalo: 10 })).toBe("");
  });
});

describe("el mismo día", () => {
  it("un recorrido positivo se enseña con su cifra y marcado para revisar el orden", () => {
    const r = textoRecorrido({ km_estado: "utilizables", recorrido_km: 300, km_montaje: 500000,
      km_desmontaje: 500300, orden_desconocido: true, uso_estadistico: "pendiente" });
    expect(r.texto).toBe("300 km el mismo día (orden sin revisar)");
    expect(r.aviso).toBe(true);
  });
  it("y deja de avisar cuando alguien lo acepta, sin dejar de ser el mismo dato", () => {
    const r = textoRecorrido({ km_estado: "utilizables", recorrido_km: 300, km_montaje: 1, km_desmontaje: 2,
      orden_desconocido: true, uso_estadistico: "aceptado" });
    expect(r.texto).toContain("300 km el mismo día");
    expect(r.aviso).toBe(false);
  });
  it("un recorrido cero el mismo día es normal y no lleva etiqueta de revisión", () => {
    const r = textoRecorrido({ km_estado: "utilizables", recorrido_km: 0, km_montaje: 1, km_desmontaje: 1,
      orden_desconocido: false });
    expect(r.texto).toBe("0 km (estimado)");
    expect(r.aviso).toBe(false);
  });
});

describe("textoDecisionContinuidad", () => {
  it("es una decisión distinta de la de los kilómetros", () => {
    expect(textoDecision({ uso_estadistico: "aceptado", revisado_at: "2026-10-11T00:00:00Z", revisado_motivo: "x" }))
      .toContain("km: aceptado");
    expect(textoDecisionContinuidad({ continuidad_decision: "pendiente", continuidad_revisada_at: null, continuidad_motivo_revision: null }))
      .toBe("continuidad: pendiente");
  });
  it("con quién y cuándo cuando la hay", () => {
    expect(textoDecisionContinuidad({ continuidad_decision: "aceptada", continuidad_revisada_at: "2026-10-11T08:00:00Z",
      continuidad_motivo_revision: "el bloqueado era un pedido anulado" }))
      .toBe("continuidad: aceptada el 2026-10-11: el bloqueado era un pedido anulado");
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
  it("el mismo día tiene su propio motivo, que no es «ritmo no plausible»", () => {
    expect(etiquetaMotivo("mismo_dia_orden_desconocido")).toBe("mismo día, orden y duración desconocidos");
  });
  it("sin motivos, texto vacío", () => {
    expect(textoMotivos(null)).toBe("");
    expect(textoMotivos([])).toBe("");
  });
});

describe("textoDecision", () => {
  it("pendiente es pendiente", () => {
    expect(textoDecision({ uso_estadistico: "pendiente", revisado_at: null, revisado_motivo: null })).toBe("km: pendiente");
  });
  it("una decisión lleva fecha y motivo", () => {
    expect(textoDecision({ uso_estadistico: "aceptado", revisado_at: "2026-10-11T08:00:00Z", revisado_motivo: "lo confirma el conductor" }))
      .toBe("km: aceptado el 2026-10-11: lo confirma el conductor");
  });
});

describe("textoCobertura", () => {
  const c = {
    incluidos: { n: 50, respaldada: 0, reconstruida: 50, sin_ficha: 0 },
    poblacion: { intervalos: 1452 },
    embudo: { con_recorrido_aritmetico: 52, elegibles_tras_filtros: 50 },
    excluidos: { n: 1402, motivos: [{ motivo: "sin_cierre", n: 1390 }, { motivo: "km_anomalos_pendientes", n: 2 }, { motivo: "continuidad_pendiente", n: 2 }] },
  };
  it("dice sobre cuántos sale la media y cuántos quedan fuera", () => {
    const t = textoCobertura(c);
    expect(t).toContain("Sobre 50 de 1452 intervalos reconstruidos");
    expect(t).toContain("Fuera 1402");
  });
  it("separa los tres grupos de identidad sin confundir «sin identificar» con «sin ficha»", () => {
    expect(textoCobertura(c)).toContain("identidad respaldada: 0 · ficha reconstruida: 50 · sin ficha: 0");
  });
  it("dice cuántos tienen recorrido calculable y cuántos pasan los filtros", () => {
    expect(textoCobertura(c)).toContain("De los 52 con recorrido calculable, 50 pasan todos los filtros");
  });
  it("avisa de que los motivos se solapan y no suman", () => {
    expect(textoCobertura(c)).toContain("no suman");
  });
  it("sin exclusiones no habla de exclusiones", () => {
    expect(textoCobertura({ incluidos: { n: 3, respaldada: 3, reconstruida: 0, sin_ficha: 0 }, poblacion: { intervalos: 3 }, excluidos: { n: 0, motivos: [] } }))
      .not.toContain("Fuera");
  });
});
