import { describe, expect, it } from "vitest";

import { capitalizar, leerCabecera, leerNominas, mesDePeriodo, normalizarDocumento } from "./nominasLeer.ts";

/** Una página de nómina tal como la devuelve el lector de PDF. Datos inventados. */
function pagina(p: {
  trabajador: string;
  nif: string;
  codigo?: string;
  centro?: string;
  grupo?: string;
  antiguedad?: string;
  periodo?: string;
  empresa?: string;
  cif?: string;
}): string[] {
  return [
    `Empresa ${p.empresa ?? "TALLERES EJEMPLO, SA"} Trabajador ${p.trabajador}`,
    `Centro ${p.centro ?? "553 TARRAGONA"} Grupo Prof. ${p.grupo ?? "G4 PROFESIONAL OFICIO 1ª"}`.trimEnd(),
    "Domicilio CL MAYOR 1 Puesto Trab.",
    `Población 43000 TARRAGONA Antigüedad ${p.antiguedad ?? "08/09/2015"}`,
    "C.C.C. 43/0000000/00 N.A.S.S. 43/00000001/01",
    `C.I.F. ${p.cif ?? "A00000000"} Código ${p.codigo ?? "000002 / 112"} N.I.F. ${p.nif}`,
    `Periodo de liquidación ${p.periodo ?? "Del 01 al 30 de Noviembre de 2.026"} Total días 30`,
    "Concepto Unidades Valor Base Devengado A Deducir",
    "SALARIO BASE 13,00 42,5537 553,20",
    "Forma de cobro Transferencia IBAN ES00 0000 0000 0000 0000 ****",
  ];
}

describe("capitalizar", () => {
  it("pone los nombres como se escriben, con las partículas en minúscula", () => {
    expect(capitalizar("MARIA DE LES NEUS")).toBe("Maria de les Neus");
    expect(capitalizar("GONZALEZ PEÑA")).toBe("Gonzalez Peña");
    expect(capitalizar("  de la fuente  ")).toBe("De la Fuente");
  });

  it("no rompe las categorías: «G4» y «1ª» se quedan como son", () => {
    expect(capitalizar("G4 PROFESIONAL OFICIO 1ª")).toBe("G4 Profesional Oficio 1ª");
  });
});

describe("leerCabecera", () => {
  it("saca los datos de la persona y nada de lo que hay debajo", () => {
    const n = leerCabecera(pagina({ trabajador: "GARCIA LOPEZ, ANA MARIA", nif: "12345678Z" }), 3)!;
    expect(n).toEqual({
      pagina: 3,
      empresa: "TALLERES EJEMPLO, SA",
      cif: "A00000000",
      centroCodigo: "553",
      centroNombre: "TARRAGONA",
      apellidos: "Garcia Lopez",
      nombre: "Ana Maria",
      grupo: "G4 Profesional Oficio 1ª",
      antiguedad: "2015-09-08",
      nass: "43/00000001/01",
      codigo: "2",
      nif: "12345678Z",
      periodo: "Del 01 al 30 de Noviembre de 2.026",
      dias: 30,
    });
    // Ni importes ni IBAN: no hay ningún campo donde pudieran caber.
    expect(JSON.stringify(n)).not.toMatch(/553,20|IBAN|ES00/);
  });

  it("el código es el primer número, sin ceros delante", () => {
    expect(leerCabecera(pagina({ trabajador: "A, B", nif: "12345678Z", codigo: "000101 / 100" }), 1)!.codigo).toBe("101");
    expect(leerCabecera(pagina({ trabajador: "A, B", nif: "12345678Z", codigo: "000000 / 100" }), 1)!.codigo).toBe("0");
  });

  it("un apellido solo, una categoría vacía y un NIE también se leen", () => {
    const n = leerCabecera(pagina({ trabajador: "MORAR, BOGDAN CONSTANTIN", nif: "X1234567L", grupo: "" }), 1)!;
    expect(n).toMatchObject({ apellidos: "Morar", nombre: "Bogdan Constantin", grupo: "", nif: "X1234567L" });
  });

  it("una fecha imposible queda sin fecha, no con una inventada", () => {
    expect(leerCabecera(pagina({ trabajador: "A, B", nif: "12345678Z", antiguedad: "31/02/2026" }), 1)!.antiguedad).toBeNull();
  });

  it("una página que no es una nómina de este formato no se inventa nada", () => {
    expect(leerCabecera(["RESUMEN DE COSTES", "Total 12.345,67"], 1)).toBeNull();
    expect(leerCabecera(pagina({ trabajador: "SIN COMA EN EL NOMBRE", nif: "12345678Z" }), 1)).toBeNull();
    expect(leerCabecera([], 1)).toBeNull();
  });

  it("lo que haya después de «Concepto» no se confunde con la cabecera", () => {
    const lineas = [...pagina({ trabajador: "GARCIA, ANA", nif: "12345678Z" }), "Antigüedad 01/01/1990"];
    expect(leerCabecera(lineas, 1)!.antiguedad).toBe("2015-09-08");
  });
});

describe("leerNominas", () => {
  it("junta las dos nóminas de quien causa baja a mitad de mes", () => {
    const r = leerNominas([
      pagina({ trabajador: "GARCIA, ANA", nif: "12345678Z", periodo: "Del 01 al 20 de Noviembre de 2.026" }),
      pagina({ trabajador: "GARCIA, ANA", nif: "12345678Z", periodo: "Del 21 al 25 de Noviembre de 2.026" }),
      pagina({ trabajador: "RUIZ, PEP", nif: "00000001R", codigo: "000003 / 100" }),
    ]);
    expect(r.personas).toHaveLength(2);
    expect(r.personas[0]).toMatchObject({
      nif: "12345678Z",
      paginas: [1, 2],
      periodos: ["Del 01 al 20 de Noviembre de 2.026", "Del 21 al 25 de Noviembre de 2.026"],
      // Cada nómina con su página: es lo que permite guardarlas sueltas.
      nominas: [
        { pagina: 1, periodo: "Del 01 al 20 de Noviembre de 2.026", dias: 30 },
        { pagina: 2, periodo: "Del 21 al 25 de Noviembre de 2.026", dias: 30 },
      ],
    });
    expect(r.empresas).toEqual([{ cif: "A00000000", nombre: "TALLERES EJEMPLO, SA" }]);
  });

  it("dice qué páginas no ha reconocido, sin contar las que están en blanco", () => {
    const r = leerNominas([pagina({ trabajador: "GARCIA, ANA", nif: "12345678Z" }), ["Otra cosa"], [], [" "]]);
    expect(r.paginasNoReconocidas).toEqual([2]);
  });

  it("si el PDF mezcla empresas, salen las dos", () => {
    const r = leerNominas([
      pagina({ trabajador: "GARCIA, ANA", nif: "12345678Z" }),
      pagina({ trabajador: "RUIZ, PEP", nif: "00000001R", empresa: "OTRA, SL", cif: "B11111111" }),
    ]);
    expect(r.empresas.map((e) => e.cif)).toEqual(["A00000000", "B11111111"]);
  });
});

describe("mesDePeriodo", () => {
  it("saca el año y el mes del periodo, con el punto de millar que pone la gestoría", () => {
    expect(mesDePeriodo("Del 01 al 30 de Noviembre de 2.026")).toEqual({ anio: 2026, mes: 11 });
    expect(mesDePeriodo("Del 16 al 31 de enero de 2027")).toEqual({ anio: 2027, mes: 1 });
    expect(mesDePeriodo("Del 01 al 30 de SETIEMBRE de 2.026")).toEqual({ anio: 2026, mes: 9 });
  });

  it("si no se entiende, no se inventa un mes", () => {
    expect(mesDePeriodo("")).toBeNull();
    expect(mesDePeriodo("Paga extra de verano")).toBeNull();
    expect(mesDePeriodo("Del 01 al 30 de Brumario de 2.026")).toBeNull();
    expect(mesDePeriodo("Del 01 al 30 de Noviembre de 26")).toBeNull();
  });
});

describe("normalizarDocumento", () => {
  it("quita espacios, puntos y guiones y pone mayúsculas", () => {
    expect(normalizarDocumento(" 12.345.678-z ")).toBe("12345678Z");
    expect(normalizarDocumento(null)).toBe("");
  });
});
