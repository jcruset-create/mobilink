/**
 * Puntuación y orden de partners, sin base de datos.
 *
 * Los casos son los que se discuten de verdad: el barato lejos contra el caro
 * cerca, el partner nuevo del que no se sabe nada, y el empate.
 */

import { describe, expect, it } from "vitest";

import {
  MEDIDAS_VACIAS, PESOS_POR_DEFECTO, codigoPostalDe, normalizarPesos, notasDe, ordenar,
  type Medidas,
} from "./dominio.ts";

function cand(nombre: string, m: Partial<Medidas> = {}) {
  return { nombre, medidas: { ...MEDIDAS_VACIAS, ...m } };
}

describe("Notas de cada criterio", () => {
  /*
   * Con 0 se hundiría cualquier partner nuevo y no se probaría nunca; con 1
   * ganaría siempre justo por no tener historial.
   */
  it("lo que no se sabe puntúa neutro, ni 0 ni 1", () => {
    const n = notasDe(MEDIDAS_VACIAS, { precioMedio: null });
    expect(n.distancia).toBe(0.6);
    expect(n.precio).toBe(0.6);
    expect(n.calidad).toBe(0.6);
  });

  it("cerca puntúa más que lejos", () => {
    const cerca = notasDe({ ...MEDIDAS_VACIAS, distanciaKm: 5 }, { precioMedio: null });
    const lejos = notasDe({ ...MEDIDAS_VACIAS, distanciaKm: 80 }, { precioMedio: null });
    expect(cerca.distancia).toBeGreaterThan(lejos.distancia);
  });

  /* Una escala fija se quedaría mal a la primera subida de tarifas. */
  it("el precio se juzga contra la media de los candidatos, no contra una escala fija", () => {
    const barato = notasDe({ ...MEDIDAS_VACIAS, precio: 100 }, { precioMedio: 200 });
    const caro = notasDe({ ...MEDIDAS_VACIAS, precio: 400 }, { precioMedio: 200 });
    expect(barato.precio).toBe(1);
    expect(caro.precio).toBe(0);
  });

  it("el historial se aplasta: entre 200 y 400 servicios no hay diferencia que importe", () => {
    const n1 = notasDe({ ...MEDIDAS_VACIAS, volumen: 200 }, { precioMedio: null });
    const n2 = notasDe({ ...MEDIDAS_VACIAS, volumen: 400 }, { precioMedio: null });
    expect(Math.abs(n1.historial - n2.historial)).toBeLessThan(0.2);
    const nuevo = notasDe({ ...MEDIDAS_VACIAS, volumen: 0 }, { precioMedio: null });
    expect(nuevo.historial).toBeLessThan(n1.historial);
  });

  it("las incidencias rebajan el historial", () => {
    const limpio = notasDe({ ...MEDIDAS_VACIAS, volumen: 100, incidenciasPor100: 0 }, { precioMedio: null });
    const sucio = notasDe({ ...MEDIDAS_VACIAS, volumen: 100, incidenciasPor100: 15 }, { precioMedio: null });
    expect(sucio.historial).toBeLessThan(limpio.historial);
  });
});

describe("Orden", () => {
  /* Es la postura de la casa: hay alguien esperando en el arcén. */
  it("con los pesos por defecto, llegar pronto gana a costar poco", () => {
    const r = ordenar([
      cand("Barato lejos", { precio: 100, distanciaKm: 90, slaLlegadaMin: 110 }),
      cand("Caro cerca", { precio: 200, distanciaKm: 5, slaLlegadaMin: 25 }),
    ]);
    expect(r[0].candidato.nombre).toBe("Caro cerca");
  });

  it("si la central pone el precio por encima de todo, gana el barato", () => {
    const soloPrecio = { ...PESOS_POR_DEFECTO, distancia: 0, sla: 0, precio: 100,
      aceptacion: 0, rapidez: 0, calidad: 0, historial: 0, preferencia: 0 };
    const r = ordenar([
      cand("Barato lejos", { precio: 100, distanciaKm: 90, slaLlegadaMin: 110 }),
      cand("Caro cerca", { precio: 200, distanciaKm: 5, slaLlegadaMin: 25 }),
    ], soloPrecio);
    expect(r[0].candidato.nombre).toBe("Barato lejos");
  });

  it("cada candidato lleva su desglose, no solo un número", () => {
    const r = ordenar([cand("Uno", { distanciaKm: 10 })]);
    expect(r[0].notas.distancia).toBeGreaterThan(0.8);
    expect(r[0].aportacion.distancia).toBeGreaterThan(0);
    expect(Object.keys(r[0].aportacion)).toHaveLength(8);
  });

  /* «Lo dijo el algoritmo» no es una respuesta. */
  it("el motivo nombra los dos criterios que más pesaron", () => {
    const r = ordenar([cand("Uno", { distanciaKm: 1, slaLlegadaMin: 20 })]);
    expect(r[0].motivo).toMatch(/^Por /);
    expect(r[0].motivo.split(" y ")).toHaveLength(2);
  });

  it("un preferente sube, pero no arrasa por sí solo", () => {
    const r = ordenar([
      cand("Preferente malo", { preferente: true, distanciaKm: 95, slaLlegadaMin: 120 }),
      cand("Normal bueno", { distanciaKm: 3, slaLlegadaMin: 20, ratioAceptacion: 1, calidad: 95 }),
    ]);
    expect(r[0].candidato.nombre).toBe("Normal bueno");
  });

  /* Un orden estable es lo que permite reproducir una queja. */
  it("dos empatados salen siempre en el mismo orden", () => {
    const a = ordenar([cand("Zeta"), cand("Alfa")]);
    const b = ordenar([cand("Alfa"), cand("Zeta")]);
    expect(a.map((x) => x.candidato.nombre)).toEqual(["Alfa", "Zeta"]);
    expect(b.map((x) => x.candidato.nombre)).toEqual(["Alfa", "Zeta"]);
  });

  it("todos los pesos a cero no revienta: se dice y se ordena por nombre", () => {
    const cero = Object.fromEntries(Object.keys(PESOS_POR_DEFECTO).map((k) => [k, 0])) as any;
    const r = ordenar([cand("Zeta"), cand("Alfa")], cero);
    expect(r[0].candidato.nombre).toBe("Alfa");
    expect(r[0].motivo).toContain("alfabético");
  });

  it("la puntuación se queda entre 0 y 100", () => {
    const r = ordenar([
      cand("Perfecto", { distanciaKm: 0, slaLlegadaMin: 20, ratioAceptacion: 1,
                         tiempoAceptacionMin: 0, calidad: 100, volumen: 500,
                         incidenciasPor100: 0, preferente: true, precio: 1 }),
      cand("Pésimo", { distanciaKm: 500, slaLlegadaMin: 600, ratioAceptacion: 0,
                       tiempoAceptacionMin: 300, calidad: 0, volumen: 0,
                       incidenciasPor100: 90, precio: 9999 }),
    ]);
    expect(r[0].puntos).toBeLessThanOrEqual(100);
    expect(r[1].puntos).toBeGreaterThanOrEqual(0);
    expect(r[0].puntos).toBeGreaterThan(r[1].puntos);
  });
});

describe("Pesos configurables", () => {
  it("lo que no se toca conserva el valor por defecto", () => {
    const p = normalizarPesos({ precio: 50 });
    expect(p.precio).toBe(50);
    expect(p.distancia).toBe(PESOS_POR_DEFECTO.distancia);
  });

  /* Invertiría el criterio sin decirlo. */
  it("un peso negativo se ignora", () => {
    expect(normalizarPesos({ precio: -10 }).precio).toBe(PESOS_POR_DEFECTO.precio);
  });

  it("un JSON corrupto cae a los pesos por defecto", () => {
    expect(normalizarPesos("{roto")).toEqual(PESOS_POR_DEFECTO);
    expect(normalizarPesos(null)).toEqual(PESOS_POR_DEFECTO);
  });

  it("un criterio inventado no entra", () => {
    const p = normalizarPesos({ simpatia: 99 }) as any;
    expect(p.simpatia).toBeUndefined();
  });
});

/*
 * `connect_assistances` guarda la dirección como texto libre. Sacar el CP de
 * ahí es lo que permite enrutar sin pedirle nada al operador.
 */
describe("Código postal sacado de la dirección", () => {
  it("lo encuentra en una dirección normal", () => {
    expect(codigoPostalDe("Carrer Major 12, 43201 Reus, Tarragona")).toBe("43201");
    expect(codigoPostalDe("08001 Barcelona")).toBe("08001");
  });

  /* Un portal o un kilómetro no son un código postal. */
  it("no confunde otros números con el CP", () => {
    expect(codigoPostalDe("A-7 km 1234, salida 12")).toBeNull();
    expect(codigoPostalDe("Calle Sin Número 4")).toBeNull();
    expect(codigoPostalDe("")).toBeNull();
    expect(codigoPostalDe(null)).toBeNull();
  });

  it("no se traga un número de seis o más cifras", () => {
    expect(codigoPostalDe("Ref 1234567")).toBeNull();
  });
});
