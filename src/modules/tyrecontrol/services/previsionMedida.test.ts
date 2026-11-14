import { describe, expect, it } from "vitest";
import { gomasDelCuadro, medidasDelCuadro, nombreDeTramo, pivotar } from "./previsionMedida";
import type { PrevisionMedida } from "../types/informes";

function fila(p: Partial<PrevisionMedida>): PrevisionMedida {
  return {
    medida: "295/80R22.5", montados: 100, sin_datos: 20, sin_fecha: 10, vencidos: 5,
    dias: 30, en_el_tramo: 7, acumulado: 12,
    ...p,
  };
}

describe("pivotar", () => {
  it("junta los plazos de una medida en una sola fila", () => {
    const r = pivotar([
      fila({ dias: 30, en_el_tramo: 7, acumulado: 12 }),
      fila({ dias: 60, en_el_tramo: 9, acumulado: 21 }),
    ]);
    expect(r.tramos).toEqual([30, 60]);
    expect(r.filas).toHaveLength(1);
    expect(r.filas[0].enElTramo).toEqual({ 30: 7, 60: 9 });
    expect(r.filas[0].acumulado).toEqual({ 30: 12, 60: 21 });
  });

  it("no suma los montados una vez por plazo", () => {
    // Los 100 montados vienen repetidos en las tres filas de la medida.
    const r = pivotar([fila({ dias: 30 }), fila({ dias: 60 }), fila({ dias: 90 })]);
    expect(r.filas[0].montados).toBe(100);
    expect(r.filas[0].sinDatos).toBe(20);
    expect(r.filas[0].sinFecha).toBe(10);
    expect(r.filas[0].vencidos).toBe(5);
  });

  it("ordena los plazos de menor a mayor aunque lleguen revueltos", () => {
    const r = pivotar([fila({ dias: 90 }), fila({ dias: 30 }), fila({ dias: 365 })]);
    expect(r.tramos).toEqual([30, 90, 365]);
  });

  it("pone primero la medida de la que más hay en la calle", () => {
    const r = pivotar([
      fila({ medida: "205/75R16", montados: 70 }),
      fila({ medida: "295/80R22.5", montados: 3121 }),
      fila({ medida: "315/80R22.5", montados: 600 }),
    ]);
    expect(r.filas.map((f) => f.medida)).toEqual(["295/80R22.5", "315/80R22.5", "205/75R16"]);
  });

  it("la fila de totales suma las medidas, plazo a plazo", () => {
    const r = pivotar([
      fila({ medida: "A", montados: 10, sin_datos: 4, vencidos: 1, sin_fecha: 2, dias: 30, en_el_tramo: 3, acumulado: 4 }),
      fila({ medida: "A", montados: 10, sin_datos: 4, vencidos: 1, sin_fecha: 2, dias: 60, en_el_tramo: 5, acumulado: 9 }),
      fila({ medida: "B", montados: 20, sin_datos: 0, vencidos: 2, sin_fecha: 1, dias: 30, en_el_tramo: 1, acumulado: 3 }),
      fila({ medida: "B", montados: 20, sin_datos: 0, vencidos: 2, sin_fecha: 1, dias: 60, en_el_tramo: 2, acumulado: 5 }),
    ]);
    expect(r.total.montados).toBe(30);
    expect(r.total.sinDatos).toBe(4);
    expect(r.total.vencidos).toBe(3);
    expect(r.total.sinFecha).toBe(3);
    expect(r.total.enElTramo).toEqual({ 30: 4, 60: 7 });
    expect(r.total.acumulado).toEqual({ 30: 7, 60: 14 });
  });

  it("una medida que no está en todos los plazos no inventa ceros al total", () => {
    const r = pivotar([
      fila({ medida: "A", montados: 10, dias: 30, en_el_tramo: 3, acumulado: 3 }),
      fila({ medida: "B", montados: 20, dias: 30, en_el_tramo: 1, acumulado: 1 }),
      fila({ medida: "B", montados: 20, dias: 60, en_el_tramo: 4, acumulado: 5 }),
    ]);
    expect(r.total.enElTramo[60]).toBe(4);
    expect(r.filas.find((f) => f.medida === "A")!.enElTramo[60]).toBeUndefined();
  });

  it("se traga los numeric que lleguen como cadena", () => {
    const r = pivotar([{
      ...fila({}),
      montados: "100" as unknown as number,
      en_el_tramo: "7" as unknown as number,
    }]);
    expect(r.filas[0].montados).toBe(100);
    expect(r.filas[0].enElTramo[30]).toBe(7);
  });

  it("una medida montada sin una sola medición sale igual, con ceros", () => {
    // 346 gomas de 385/55R22.5 están montadas y ninguna se ha medido nunca.
    // Si no salieran, quien hace el pedido pensaría que esa medida no existe.
    const r = pivotar([
      fila({ medida: "385/55R22.5", montados: 346, sin_datos: 346, sin_fecha: 0, vencidos: 0, dias: 30, en_el_tramo: 0, acumulado: 0 }),
    ]);
    expect(r.filas[0].montados).toBe(346);
    expect(r.filas[0].sinDatos).toBe(346);
    expect(r.filas[0].enElTramo[30]).toBe(0);
  });

  it("sin filas, una previsión vacía que no revienta", () => {
    const r = pivotar([]);
    expect(r.tramos).toEqual([]);
    expect(r.filas).toEqual([]);
    expect(r.total.montados).toBe(0);
  });

  it("una medida en blanco se queda como «(sin medida)»", () => {
    const r = pivotar([fila({ medida: "  " })]);
    expect(r.filas[0].medida).toBe("(sin medida)");
  });
});

describe("nombreDeTramo", () => {
  it("lo dice como lo diría una persona", () => {
    expect(nombreDeTramo(30)).toBe("30 días");
    expect(nombreDeTramo(90)).toBe("90 días");
    expect(nombreDeTramo(180)).toBe("6 meses");
    expect(nombreDeTramo(365)).toBe("1 año");
    expect(nombreDeTramo(730)).toBe("2 años");
  });
});

describe("medidasDelCuadro", () => {
  // Tres medidas: una con vencidas y de todo, otra solo a 90 días, otra sin datos.
  const { filas, total } = pivotar([
    fila({ medida: "295/80R22.5", vencidos: 5, sin_datos: 0, sin_fecha: 0, dias: 30, en_el_tramo: 7, acumulado: 12 }),
    fila({ medida: "295/80R22.5", vencidos: 5, sin_datos: 0, sin_fecha: 0, dias: 90, en_el_tramo: 4, acumulado: 16 }),
    fila({ medida: "315/80R22.5", vencidos: 0, sin_datos: 0, sin_fecha: 2, dias: 30, en_el_tramo: 0, acumulado: 0 }),
    fila({ medida: "315/80R22.5", vencidos: 0, sin_datos: 0, sin_fecha: 2, dias: 90, en_el_tramo: 9, acumulado: 9 }),
    fila({ medida: "385/55R22.5", vencidos: 0, sin_datos: 346, sin_fecha: 0, dias: 30, en_el_tramo: 0, acumulado: 0 }),
    fila({ medida: "385/55R22.5", vencidos: 0, sin_datos: 346, sin_fecha: 0, dias: 90, en_el_tramo: 0, acumulado: 0 }),
  ]);
  const medidas = (f: Parameters<typeof medidasDelCuadro>[1]) => medidasDelCuadro(filas, f).map((x) => x.medida);

  it("«todo» devuelve la lista tal cual", () => {
    expect(medidasDelCuadro(filas, "todo")).toBe(filas);
  });

  it("cada cuadro deja las medidas que tienen alguna goma en él", () => {
    expect(medidas("vencidas")).toEqual(["295/80R22.5"]);
    expect(medidas("en30")).toEqual(["295/80R22.5"]);
    expect(medidas("hasta90")).toEqual(["295/80R22.5", "315/80R22.5"]);
  });

  it("de la que más a la que menos", () => {
    expect(medidas("fuera")).toEqual(["385/55R22.5", "315/80R22.5"]);
  });

  it("lo que suman las medidas que quedan es el número del cuadro", () => {
    for (const f of ["vencidas", "en30", "hasta90", "fuera"] as const) {
      const suma = medidasDelCuadro(filas, f).reduce((s, x) => s + gomasDelCuadro(x, f), 0);
      expect(suma).toBe(gomasDelCuadro(total, f));
    }
  });

  it("no desordena la lista que le pasan", () => {
    const antes = filas.map((x) => x.medida);
    medidasDelCuadro(filas, "fuera");
    expect(filas.map((x) => x.medida)).toEqual(antes);
  });
});
