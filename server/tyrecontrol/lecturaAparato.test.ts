import { describe, it, expect } from "vitest";
import { sensoresDe } from "./movertisSensores.ts";
import {
  consumoMedioL100, hayAlgoQueEnsenar, lecturaDeAparato, pesosPorEje,
} from "./lecturaAparato.ts";

/**
 * La respuesta real de la unidad 1807 (7523NNB, Empresa Plana), 27/11/2026.
 * Es la única forma honesta de probar esto: los nombres y las unidades los
 * pone el proveedor, no yo.
 */
const UNIDAD_1807 = {
  CONTACTO: 1,
  BLOQUEO: 0,
  CARGAMOTOR: 0,
  CONSUMIDO: 19267,
  CONSUMOINST: 0.0128164570779,
  DEPOSITO: 100,
  DEPOSITOADBLUE: 90.8,
  DEPOSITOL: 550,
  HORASTOTALES: 2234,
  KM: 78909.16,
  "ºCAIRE": 13.625,
  ODO: 0,
  "PESOEJE 1": 11388,
  "PESOEJE 2": 18405,
  "PESOEJE 3": -348201.3876,
  RPM: 499,
  RPMDIGITAL: 4.16333333317,
  TACHOODO: 78909.16,
  TACOGRAFO: 2,
  VELOCIDAD: 0,
  VOLTAJE: 28.105,
};

const leer = (s: Record<string, unknown>) => lecturaDeAparato(sensoresDe({ sensors: s }));

describe("la unidad 1807, de principio a fin", () => {
  const l = leer(UNIDAD_1807);

  it("saca las horas de motor y el gasóleo consumido", () => {
    expect(l.horasMotor).toBe(2234);
    expect(l.consumidoL).toBe(19267);
  });

  it("el consumo medio cuadra con un autobús", () => {
    // 19.267 l sobre 78.909 km. Si los litros vinieran en otra unidad daría
    // 0,2 o 2.400, y por eso la cifra se comprueba antes de enseñarla.
    expect(l.consumoMedioL100).toBe(24.4);
  });

  it("los pesos por eje, con su número de eje y su suma", () => {
    expect(l.ejes).toEqual([{ eje: 1, kg: 11388 }, { eje: 2, kg: 18405 }]);
    expect(l.pesoTotalKg).toBe(29793);
  });

  it("un eje sin sensor no corre a los demás", () => {
    // El eje 3 viene con el centinela: no está, y el 2 sigue siendo el 2.
    expect(l.ejes.map((e) => e.eje)).toEqual([1, 2]);
  });

  it("el estado de ahora mismo: parado con el motor girando = ralentí", () => {
    expect(l.rpm).toBe(499);
    expect(l.velocidadKmh).toBe(0);
    expect(l.contacto).toBe(true);
  });

  it("el depósito se enseña como viene, sin inventarle unidad", () => {
    expect(l.deposito.map((d) => d.nombre).sort()).toEqual(["DEPOSITO", "DEPOSITOADBLUE", "DEPOSITOL"]);
  });

  it("lo demás con lectura va a «otros», sin repetirse con lo de arriba", () => {
    const nombres = l.otros.map((o) => o.nombre);
    expect(nombres).toContain("VOLTAJE");
    expect(nombres).toContain("TACOGRAFO");
    expect(nombres).not.toContain("HORASTOTALES");
    expect(nombres).not.toContain("PESOEJE 1");
    expect(nombres).not.toContain("CONSUMIDO");
  });

  it("hay algo que enseñar", () => {
    expect(hayAlgoQueEnsenar(l)).toBe(true);
  });
});

describe("consumoMedioL100", () => {
  it("una cifra creíble se devuelve redondeada", () => {
    expect(consumoMedioL100(19267, 78909.16)).toBe(24.4);
  });

  it("si la unidad no fuera litros, el número sale absurdo y NO se enseña", () => {
    // Mismo recorrido con los litros en centilitros (×100) y en décimas (÷10).
    expect(consumoMedioL100(1926700, 78909.16)).toBeNull();
    expect(consumoMedioL100(192, 78909.16)).toBeNull();
  });

  it("sin kilómetros suficientes no significa nada", () => {
    expect(consumoMedioL100(20, 12)).toBeNull();
    expect(consumoMedioL100(19267, 0)).toBeNull();
  });

  it("sin alguno de los dos, nada", () => {
    expect(consumoMedioL100(null, 78909)).toBeNull();
    expect(consumoMedioL100(19267, null)).toBeNull();
  });
});

describe("pesosPorEje", () => {
  it("el número sale del nombre, no del orden", () => {
    const r = pesosPorEje(sensoresDe({ sensors: { "PESOEJE 3": 7000, "PESOEJE 1": 6000 } }));
    expect(r).toEqual([{ eje: 1, kg: 6000 }, { eje: 3, kg: 7000 }]);
  });

  it("lo que no es un peso de eje no entra", () => {
    const r = pesosPorEje(sensoresDe({ sensors: { PESOTOTAL: 29000, "PESOEJE 1": 6000 } }));
    expect(r).toEqual([{ eje: 1, kg: 6000 }]);
  });
});

describe("un aparato que no da nada de esto", () => {
  it("no se enseña el bloque", () => {
    const l = leer({ VOLTAJE: 28.1, "ºCAIRE": 13.6 });
    expect(hayAlgoQueEnsenar(l)).toBe(false);
    expect(l.ejes).toEqual([]);
    expect(l.consumoMedioL100).toBeNull();
  });
});
