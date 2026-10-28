import { describe, expect, it } from "vitest";
import { FLUJO_SALIDA, destinoDeSalida, esMotivoDeSalida, esSalida, etiquetaDeMotivo, pasoDeSalida, siguientePasoForzable, validarSalida } from "./salidasTaller";

describe("pasoDeSalida: en camino → en el punto", () => {
  it("dentro del radio y parada: llega", () => {
    expect(pasoDeSalida({ status: "en_camino", distDestinoM: 120, moving: false, enPuntoVisto: false })).toMatchObject({ status: "en_punto" });
  });
  it("dentro pero en marcha: se apunta; la segunda vez dentro cuenta como llegada", () => {
    const primera = pasoDeSalida({ status: "en_camino", distDestinoM: 200, moving: true, enPuntoVisto: false });
    expect(primera).toEqual({ enPuntoVisto: true });
    const segunda = pasoDeSalida({ status: "en_camino", distDestinoM: 250, moving: true, enPuntoVisto: true });
    expect(segunda).toMatchObject({ status: "en_punto" });
  });
  it("pasa de largo: se borra el apunte y no llega", () => {
    expect(pasoDeSalida({ status: "en_camino", distDestinoM: 900, moving: true, enPuntoVisto: true })).toEqual({ enPuntoVisto: false });
    expect(pasoDeSalida({ status: "en_camino", distDestinoM: 900, moving: true, enPuntoVisto: false })).toEqual({});
  });
  it("sin dato de movimiento, dentro dos veces también llega", () => {
    expect(pasoDeSalida({ status: "en_camino", distDestinoM: 100, moving: null, enPuntoVisto: false })).toEqual({ enPuntoVisto: true });
    expect(pasoDeSalida({ status: "en_camino", distDestinoM: 100, moving: null, enPuntoVisto: true })).toMatchObject({ status: "en_punto" });
  });
});

describe("pasoDeSalida: en el punto → vuelve al taller", () => {
  it("sale del radio con margen: vuelve", () => {
    expect(pasoDeSalida({ status: "en_punto", distDestinoM: 460, moving: true, enPuntoVisto: true })).toMatchObject({ status: "en_camino_base" });
  });
  it("bailando en el borde no sale", () => {
    expect(pasoDeSalida({ status: "en_punto", distDestinoM: 380, moving: true, enPuntoVisto: true })).toEqual({});
  });
});

describe("otros estados no se tocan", () => {
  it("asignada, en_camino_base y llegada_taller los llevan los vigilantes de siempre", () => {
    for (const status of ["asignada", "en_camino_base", "llegada_taller", "cancelada"]) {
      expect(pasoDeSalida({ status, distDestinoM: 10, moving: false, enPuntoVisto: false })).toEqual({});
    }
  });
});

describe("motivos y flujo", () => {
  it("lista fija de motivos", () => {
    expect(esMotivoDeSalida("repartir_neumaticos")).toBe(true);
    expect(esMotivoDeSalida("lo que sea")).toBe(false);
    expect(etiquetaDeMotivo("buscar_recambios")).toBe("Buscar recambios");
    expect(etiquetaDeMotivo(null)).toBe("Salida");
  });
  it("el flujo no tiene reparando ni finalizada", () => {
    expect([...FLUJO_SALIDA]).toEqual(["asignada", "en_camino", "en_punto", "en_camino_base", "llegada_taller"]);
  });
});

describe("validarSalida", () => {
  it("motivo, operario y destino", () => {
    expect(validarSalida({})).toHaveLength(3);
    expect(validarSalida({ motivo: "gestion", assignedTechName: "Albert", address: "Pol. Ind. Constantí" })).toEqual([]);
    expect(validarSalida({ motivo: "gestion", assignedTechName: "Albert", latitude: 41.1, longitude: 1.2 })).toEqual([]);
    expect(validarSalida({ motivo: "gestion", assignedTechName: "Albert", knownPlaceId: 3 })).toEqual([]);
  });
});

describe("pantalla", () => {
  it("destino y paso siguiente", () => {
    expect(destinoDeSalida({ address: " Pol. Ind. Constantí " })).toBe("Pol. Ind. Constantí");
    expect(destinoDeSalida({ latitude: 41.12345678, longitude: 1.2 })).toBe("41.12346, 1.20000");
    expect(destinoDeSalida({})).toBe("Sin destino");
    expect(siguientePasoForzable("asignada")).toBe("en_camino");
    expect(siguientePasoForzable("en_punto")).toBe("en_camino_base");
    expect(siguientePasoForzable("llegada_taller")).toBeNull();
    expect(siguientePasoForzable("cancelada")).toBeNull();
    expect(esSalida({ tipo: "salida" })).toBe(true);
    expect(esSalida({ tipo: "asistencia" })).toBe(false);
  });
});
