import { describe, expect, it } from "vitest";

import { compararConCore, elegirEmpresa, type EmpleadoCore } from "./nominasComparar.ts";
import type { PersonaDeNomina } from "./nominasLeer.ts";

const EMPRESA = "0a0a0a0a-0000-4000-a000-000000000001";

/** Una persona de la nómina. Todo inventado; los NIF tienen la letra buena. */
function persona(p: Partial<PersonaDeNomina> & { nif: string; nombre: string; apellidos: string; codigo: string }): PersonaDeNomina {
  return {
    empresa: "TALLERES EJEMPLO, SA",
    cif: "A00000000",
    centroCodigo: "553",
    centroNombre: "TARRAGONA",
    grupo: "G4 Profesional Oficio 1ª",
    antiguedad: "2020-03-09",
    nass: "43/00000001/01",
    paginas: [1],
    periodos: ["Del 01 al 30 de Noviembre de 2.026"],
    nominas: [{ pagina: 1, periodo: "Del 01 al 30 de Noviembre de 2.026", dias: 30 }],
    ...p,
  };
}

function empleado(e: Partial<EmpleadoCore> & { id: string; nombre: string }): EmpleadoCore {
  return {
    apellidos: null,
    dni_nie: null,
    num_seguridad_social: "43/00000001/01",
    fecha_alta: "2020-03-09",
    cargo: "G4 Profesional Oficio 1ª",
    numero_trabajador: null,
    activo: true,
    company_id: EMPRESA,
    ...e,
  };
}

const ANA = persona({ nif: "12345678Z", nombre: "Ana", apellidos: "Garcia Lopez", codigo: "2" });

describe("compararConCore", () => {
  it("quien no está en Core es nuevo", () => {
    const { filas } = compararConCore([ANA], [], EMPRESA);
    expect(filas[0]).toMatchObject({ tipo: "nuevo", empleadoId: null, cambios: [] });
  });

  it("casa por NIF aunque en Core esté escrito con puntos y en minúscula", () => {
    const { filas } = compararConCore([ANA], [empleado({ id: "e1", nombre: "Ana", dni_nie: "12.345.678-z", numero_trabajador: "2" })], EMPRESA);
    expect(filas[0]).toMatchObject({ tipo: "igual", empleadoId: "e1", porNombre: false, cambios: [] });
  });

  it("si el número de Core no es el código de la nómina, propone igualarlo", () => {
    const { filas } = compararConCore([ANA], [empleado({ id: "e1", nombre: "Ana", dni_nie: "12345678Z", numero_trabajador: "1" })], EMPRESA);
    expect(filas[0].tipo).toBe("actualizar");
    expect(filas[0].cambios).toEqual([{ campo: "numero_trabajador", etiqueta: "Nº de trabajador", actual: "1", nuevo: "2" }]);
  });

  it("rellena lo que falta en Core y no pisa lo que ya está puesto", () => {
    const enCore = empleado({
      id: "e1",
      nombre: "Ana",
      dni_nie: "12345678Z",
      numero_trabajador: "2",
      num_seguridad_social: " ",
      fecha_alta: null,
      cargo: "Jefa de taller",
    });
    const { filas } = compararConCore([ANA], [enCore], EMPRESA);
    expect(filas[0].cambios.map((c) => c.campo)).toEqual(["num_seguridad_social", "fecha_alta"]);
    // El cargo que alguien puso a mano se respeta, aunque la nómina diga otro.
    expect(filas[0].cambios.some((c) => c.campo === "cargo")).toBe(false);
  });

  it("sin DNI en Core, casa por nombre (en cualquier orden) y lo avisa", () => {
    const { filas } = compararConCore([ANA], [empleado({ id: "e1", nombre: "García López Ana", numero_trabajador: "2" })], EMPRESA);
    expect(filas[0]).toMatchObject({ tipo: "actualizar", empleadoId: "e1", porNombre: true });
    expect(filas[0].cambios).toEqual([{ campo: "dni_nie", etiqueta: "DNI / NIE", actual: null, nuevo: "12345678Z" }]);
    expect(filas[0].avisos.join(" ")).toMatch(/reconocido por el nombre/);
  });

  it("dos empleados sin DNI con el mismo nombre: no casa con ninguno", () => {
    const { filas } = compararConCore(
      [ANA],
      [empleado({ id: "e1", nombre: "Ana Garcia Lopez" }), empleado({ id: "e2", nombre: "Ana", apellidos: "Garcia Lopez" })],
      EMPRESA
    );
    expect(filas[0]).toMatchObject({ tipo: "nuevo", empleadoId: null });
    expect(filas[0].avisos.join(" ")).toMatch(/varios empleados/);
  });

  it("un empleado CON otro DNI no casa por nombre: es otra persona", () => {
    const { filas } = compararConCore([ANA], [empleado({ id: "e1", nombre: "Ana Garcia Lopez", dni_nie: "00000001R" })], EMPRESA);
    expect(filas[0].tipo).toBe("nuevo");
  });

  it("quien está de baja en Core no se crea otra vez", () => {
    const { filas } = compararConCore([ANA], [empleado({ id: "e1", nombre: "Ana", dni_nie: "12345678Z", activo: false })], EMPRESA);
    expect(filas[0]).toMatchObject({ tipo: "baja_en_core", empleadoId: "e1" });
  });

  it("avisa de las dos nóminas y del NIF con la letra mal", () => {
    const dos = persona({ ...ANA, paginas: [3, 4], periodos: ["Del 01 al 20", "Del 21 al 25"] });
    expect(compararConCore([dos], [], EMPRESA).filas[0].avisos.join(" ")).toMatch(/2 nóminas/);
    const mala = persona({ ...ANA, nif: "12345678A" });
    expect(compararConCore([mala], [], EMPRESA).filas[0].avisos.join(" ")).toMatch(/letra/);
  });

  it("sin empresa en Core no se propone número; sin la columna, tampoco", () => {
    const sinEmpresa = empleado({ id: "e1", nombre: "Ana", dni_nie: "12345678Z", company_id: null });
    const a = compararConCore([ANA], [sinEmpresa], EMPRESA).filas[0];
    expect(a.cambios).toEqual([]);
    expect(a.avisos.join(" ")).toMatch(/No tiene empresa/);

    const conEmpresa = empleado({ id: "e1", nombre: "Ana", dni_nie: "12345678Z", numero_trabajador: null });
    expect(compararConCore([ANA], [conEmpresa], EMPRESA, false).filas[0].tipo).toBe("igual");
  });

  it("los activos de la empresa que no salen en la nómina se listan, y solo esos", () => {
    const { noEnNomina } = compararConCore(
      [ANA],
      [
        empleado({ id: "e1", nombre: "Ana", dni_nie: "12345678Z" }),
        empleado({ id: "e2", nombre: "Zoe", apellidos: "Sin Nómina", numero_trabajador: "9" }),
        empleado({ id: "e3", nombre: "De Baja", activo: false }),
        empleado({ id: "e4", nombre: "De Otra Empresa", company_id: "otra" }),
      ],
      EMPRESA
    );
    expect(noEnNomina).toEqual([{ id: "e2", nombre: "Zoe Sin Nómina", numeroTrabajador: "9" }]);
  });
});

describe("elegirEmpresa", () => {
  const empresas = [
    { id: "a", nombre: "TALLERES EJEMPLO S.A.", cif: "A-00000000" },
    { id: "b", nombre: "Otra Cosa SL", cif: null },
  ];

  it("por CIF, se escriba como se escriba", () => {
    expect(elegirEmpresa(empresas, { cif: "A00000000", nombre: "da igual" })).toEqual({ id: "a", nombre: "TALLERES EJEMPLO S.A." });
  });

  it("si no hay CIF en Core, por nombre: «, SA» y « S.A.» son lo mismo", () => {
    const sinCif = [{ id: "a", nombre: "TALLERES EJEMPLO S.A.", cif: null }];
    expect(elegirEmpresa(sinCif, { cif: "A00000000", nombre: "TALLERES EJEMPLO, SA" })?.id).toBe("a");
  });

  it("si no se reconoce, no se adivina: hay que elegirla", () => {
    expect(elegirEmpresa(empresas, { cif: "B99999999", nombre: "Desconocida, SL" })).toBeNull();
  });
});
