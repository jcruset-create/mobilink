import { describe, expect, it } from "vitest";
import { type EvidenciaConcepto, type ReglaConcepto, clasificarConcepto, UMBRAL_CONCEPTO } from "./conceptos.ts";
import { tipoDeEstablecimiento } from "../invoice-scan/normalize.ts";

const DIETAS = 1;
const PEAJES = 2;
const PARKING = 3;

const regla = (extra: Partial<ReglaConcepto>): ReglaConcepto => ({
  id: 1,
  campo: "TIPO_ESTABLECIMIENTO",
  patron: "PEAJE",
  conceptoId: PEAJES,
  confianza: 0.95,
  autoSeleccionar: true,
  prioridad: 100,
  ...extra,
});

/** El ticket de la AP-2: 10,24 €, sin desglose de IVA. */
const PEAJE: EvidenciaConcepto = {
  tipoEstablecimiento: "PEAJE",
  nombreEmisor: "AUTOPISTAS AUMAR, S.A.C.E.",
  nifEmisor: "A-28.029.130",
  concepto: "Tránsito Lleida - Tarragona",
  baseCentimos: null,
  ivaCentimos: null,
  totalCentimos: 1024,
  confianzaEmisor: 0.97,
};

const activos = new Set([DIETAS, PEAJES, PARKING]);

describe("qué concepto se propone", () => {
  it("por el tipo de establecimiento, que es lo que lee el modelo", () => {
    const r = clasificarConcepto(PEAJE, [regla({})], activos);
    expect(r).toMatchObject({ conceptoId: PEAJES, autoSeleccionar: true, reglaId: 1 });
    expect(r.motivo).toContain("tipo de establecimiento");
  });

  it("el tipo se compara entero: PARKING no casa con PARKING_PRIVADO ni al revés", () => {
    expect(clasificarConcepto({ ...PEAJE, tipoEstablecimiento: "PARKING" }, [regla({ patron: "PARK" })], activos).conceptoId).toBeNull();
    expect(clasificarConcepto({ ...PEAJE, tipoEstablecimiento: "PARKING" }, [regla({ patron: "parking", conceptoId: PARKING })], activos).conceptoId).toBe(PARKING);
  });

  it("DESCONOCIDO no es un valor: ninguna regla casa con él", () => {
    expect(
      clasificarConcepto({ ...PEAJE, tipoEstablecimiento: "DESCONOCIDO" }, [regla({ patron: "DESCONOCIDO" })], activos).conceptoId
    ).toBeNull();
  });

  it("el nombre se compara por trozos y sin acentos ni mayúsculas", () => {
    const r = clasificarConcepto({ ...PEAJE, tipoEstablecimiento: "OTRO" }, [regla({ campo: "NOMBRE_EMISOR", patron: "aumar" })], activos);
    expect(r.conceptoId).toBe(PEAJES);
  });

  it("el NIF se compara entero y sin puntuación: contenerlo no basta", () => {
    expect(clasificarConcepto(PEAJE, [regla({ campo: "NIF_EMISOR", patron: "A28029130" })], activos).conceptoId).toBe(PEAJES);
    expect(clasificarConcepto(PEAJE, [regla({ campo: "NIF_EMISOR", patron: "28029130" })], activos).conceptoId).toBeNull();
  });

  it("manda la de prioridad más baja; a igualdad, la de id más bajo", () => {
    const reglas = [
      regla({ id: 9, prioridad: 50, campo: "NOMBRE_EMISOR", patron: "aumar", conceptoId: DIETAS }),
      regla({ id: 2, prioridad: 100 }),
      regla({ id: 3, prioridad: 50, campo: "CONCEPTO", patron: "transito", conceptoId: PARKING }),
    ];
    expect(clasificarConcepto(PEAJE, reglas, activos).reglaId).toBe(3);
  });

  it("una regla que apunta a un concepto desactivado se salta, y se dice", () => {
    const r = clasificarConcepto(PEAJE, [regla({ conceptoId: 99 })], activos);
    expect(r.conceptoId).toBeNull();
    expect(r.motivo).toContain("desactivado");
    // Y si hay otra buena detrás, manda esa.
    expect(clasificarConcepto(PEAJE, [regla({ id: 1, conceptoId: 99 }), regla({ id: 2 })], activos).conceptoId).toBe(PEAJES);
  });

  it("sin regla que lo reconozca, NO LO SÉ: no hay concepto por defecto", () => {
    const r = clasificarConcepto(PEAJE, [], activos);
    expect(r).toMatchObject({ conceptoId: null, autoSeleccionar: false, confianza: 0 });
  });
});

describe("cuándo se rellena solo", () => {
  it("la confianza es la menor entre la regla y la lectura del emisor", () => {
    const r = clasificarConcepto({ ...PEAJE, confianzaEmisor: 0.6 }, [regla({ confianza: 0.99 })], activos);
    expect(r.confianza).toBe(0.6);
    expect(r.autoSeleccionar).toBe(false);
  });

  it("en el umbral justo sí; por debajo, no", () => {
    expect(clasificarConcepto({ ...PEAJE, confianzaEmisor: UMBRAL_CONCEPTO }, [regla({})], activos).autoSeleccionar).toBe(true);
    expect(clasificarConcepto({ ...PEAJE, confianzaEmisor: UMBRAL_CONCEPTO - 0.01 }, [regla({})], activos).autoSeleccionar).toBe(false);
  });

  it("una regla que solo sugiere no rellena, por segura que sea", () => {
    expect(clasificarConcepto(PEAJE, [regla({ autoSeleccionar: false })], activos).autoSeleccionar).toBe(false);
  });

  it("si las cifras del ticket no cuadran, se propone pero no se rellena solo", () => {
    const mal = { ...PEAJE, baseCentimos: 846, ivaCentimos: 178, totalCentimos: 1100 };
    const r = clasificarConcepto(mal, [regla({})], activos);
    expect(r.conceptoId).toBe(PEAJES);
    expect(r.autoSeleccionar).toBe(false);
    expect(r.motivo).toContain("no cuadran");
    // Si cuadran, sí.
    expect(clasificarConcepto({ ...mal, totalCentimos: 1024 }, [regla({})], activos).autoSeleccionar).toBe(true);
  });
});

describe("la lectura del tipo de establecimiento", () => {
  it("de la lista cerrada, sin distinguir mayúsculas", () => {
    expect(tipoDeEstablecimiento("peaje")).toBe("PEAJE");
    expect(tipoDeEstablecimiento(" Restaurante ")).toBe("RESTAURANTE");
  });

  it("lo que no está en la lista, o no se leyó, es DESCONOCIDO, que no es OTRO", () => {
    expect(tipoDeEstablecimiento("CAFETERÍA")).toBe("DESCONOCIDO");
    expect(tipoDeEstablecimiento(null)).toBe("DESCONOCIDO");
    expect(tipoDeEstablecimiento(undefined)).toBe("DESCONOCIDO");
    expect(tipoDeEstablecimiento("OTRO")).toBe("OTRO");
  });
});
