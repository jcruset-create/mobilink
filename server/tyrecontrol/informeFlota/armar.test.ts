import { describe, expect, it } from "vitest";
import {
  estadoDe, hojaFlota, hojaPorCliente, ordenar, resumenPorCliente, type FilaFlota,
} from "./armar.ts";

/**
 * Lo que se fija aquí:
 *
 *  · Que el Excel se abra por lo que hay que atender, no por la matrícula.
 *    Ordenado alfabéticamente obliga a filtrar antes de poder usarlo.
 *  · Que un vehículo sin revisar vaya DELANTE de uno revisado hace meses
 *    dentro de su grupo: «nunca» es más viejo que cualquier fecha.
 *  · Que «ruedas sin fichar» se cuente aparte del estado. Un camión puede
 *    estar correcto de profundidad y tener una rueda sin registrar; son dos
 *    problemas y mezclarlos esconde uno de los dos.
 */

const f = (p: Partial<FilaFlota> = {}): FilaFlota => ({
  cliente: "ENCATRANS", matricula: "1234ABC", unidad: null, base: "VALLS",
  tipo: "semirremolque", config: "2x2x2", medida: "385/65R22.5",
  estado: "correcto", ultima_revision: "2026-09-01", dias_desde: 60,
  ruedas_plano: 6, ruedas_montadas: 6, ruedas_medidas: 6,
  profundidad_minima: 7.4, bajo_minimo: 0, en_aviso: 0, km_actual: 0, ...p,
});

describe("estadoDe", () => {
  it("reconoce los cuatro estados de la base", () => {
    for (const e of ["correcto", "revisar", "urgente", "pendiente"]) {
      expect(estadoDe(e)).toBe(e);
    }
  });

  it("lo que no reconoce cae en «pendiente», que es lo prudente", () => {
    // Prudente porque «pendiente» invita a mirarlo; darlo por correcto lo
    // escondería.
    expect(estadoDe("vete a saber")).toBe("pendiente");
    expect(estadoDe(null)).toBe("pendiente");
  });
});

describe("ordenar", () => {
  it("primero lo que hay que atender, y lo correcto al final", () => {
    const filas = [
      f({ matricula: "A", estado: "correcto" }),
      f({ matricula: "B", estado: "pendiente" }),
      f({ matricula: "C", estado: "urgente" }),
      f({ matricula: "D", estado: "revisar" }),
    ];
    expect(ordenar(filas).map((x) => x.matricula)).toEqual(["C", "D", "B", "A"]);
  });

  it("dentro del grupo, el que lleva más tiempo sin mirarse va primero", () => {
    const filas = [
      f({ matricula: "A", estado: "revisar", dias_desde: 10 }),
      f({ matricula: "B", estado: "revisar", dias_desde: 200 }),
    ];
    expect(ordenar(filas).map((x) => x.matricula)).toEqual(["B", "A"]);
  });

  it("«nunca revisado» es más viejo que cualquier fecha", () => {
    const filas = [
      f({ matricula: "A", estado: "pendiente", dias_desde: 900 }),
      f({ matricula: "B", estado: "pendiente", dias_desde: null }),
    ];
    expect(ordenar(filas).map((x) => x.matricula)).toEqual(["B", "A"]);
  });

  it("no toca la lista que recibe", () => {
    const filas = [f({ matricula: "A", estado: "correcto" }), f({ matricula: "B", estado: "urgente" })];
    const copia = [...filas];
    ordenar(filas);
    expect(filas).toEqual(copia);
  });
});

describe("resumenPorCliente", () => {
  const filas = [
    f({ cliente: "ENCATRANS", estado: "urgente", bajo_minimo: 2 }),
    f({ cliente: "ENCATRANS", estado: "correcto" }),
    f({ cliente: "Plana", estado: "revisar", bajo_minimo: 1 }),
    f({ cliente: "Plana", estado: "correcto", ruedas_montadas: 4 }),
  ];

  it("cuenta por estado y suma las ruedas bajo mínimo", () => {
    const r = resumenPorCliente(filas);
    expect(r.find((x) => x.cliente === "ENCATRANS")).toMatchObject({
      vehiculos: 2, urgente: 1, correcto: 1, bajoMinimo: 2,
    });
  });

  it("las ruedas sin fichar se cuentan aparte del estado", () => {
    // Ese vehículo de Plana está «correcto» y aun así le faltan dos ruedas.
    const plana = resumenPorCliente(filas).find((x) => x.cliente === "Plana")!;
    expect(plana.correcto).toBe(1);
    expect(plana.planoIncompleto).toBe(1);
  });

  it("un vehículo sin plano no cuenta como incompleto: no hay con qué comparar", () => {
    const r = resumenPorCliente([f({ ruedas_plano: 0, ruedas_montadas: 0 })]);
    expect(r[0].planoIncompleto).toBe(0);
  });

  it("los clientes salen por urgencia, no por nombre", () => {
    const r = resumenPorCliente([
      f({ cliente: "Zeta", estado: "urgente" }),
      f({ cliente: "Alfa", estado: "correcto" }),
    ]);
    expect(r.map((x) => x.cliente)).toEqual(["Zeta", "Alfa"]);
  });

  it("un vehículo sin cliente no se pierde", () => {
    expect(resumenPorCliente([f({ cliente: null })])[0].cliente).toBe("(sin cliente)");
  });
});

describe("hojaFlota", () => {
  it("dice cuántas ruedas faltan por fichar, en vez de obligar a restar", () => {
    const h = hojaFlota([f({ ruedas_plano: 6, ruedas_montadas: 4 })]);
    expect(h[0]["Faltan por fichar"]).toBe(2);
  });

  it("montadas de más no da un número negativo", () => {
    const h = hojaFlota([f({ ruedas_plano: 6, ruedas_montadas: 8 })]);
    expect(h[0]["Faltan por fichar"]).toBe(0);
  });

  it("sin plano la casilla queda vacía, no a cero", () => {
    // Un cero diría «no le falta ninguna», y lo que pasa es que no se sabe.
    const h = hojaFlota([f({ ruedas_plano: 0 })]);
    expect(h[0]["Faltan por fichar"]).toBeNull();
  });

  it("el estado se escribe como lo lee una persona", () => {
    expect(hojaFlota([f({ estado: "pendiente" })])[0].Estado).toBe("Sin revisar");
    expect(hojaFlota([f({ estado: "urgente" })])[0].Estado).toBe("Urgente");
  });

  it("los números van como números, no como texto", () => {
    const h = hojaFlota([f({ profundidad_minima: 4.2, km_actual: 125000 })]);
    expect(typeof h[0]["Prof. mínima (mm)"]).toBe("number");
    expect(typeof h[0].Km).toBe("number");
  });
});

describe("hojaPorCliente", () => {
  it("con varios clientes añade una fila de TOTAL al final", () => {
    const h = hojaPorCliente([
      f({ cliente: "A", estado: "urgente" }),
      f({ cliente: "B", estado: "correcto" }),
    ]);
    expect(h).toHaveLength(3);
    expect(h[2]).toMatchObject({ Cliente: "TOTAL", Vehículos: 2, Urgente: 1, Correcto: 1 });
  });

  it("con un solo cliente no se repite la misma fila como total", () => {
    const h = hojaPorCliente([f({ cliente: "A" })]);
    expect(h).toHaveLength(1);
    expect(h[0].Cliente).toBe("A");
  });

  it("sin vehículos, hoja vacía y no una fila de ceros", () => {
    expect(hojaPorCliente([])).toEqual([]);
  });
});
