import { describe, expect, it } from "vitest";
import { ErrorFichero, fechaDe, leerHoja, numeroDe, tgdDe } from "./parser.ts";

/**
 * La hoja de verdad tiene TRES filas antes de los datos: el título con el
 * rango de fechas, los bloques («(A) Intervención», «Medición», «(E)
 * Vehículo»…) y las 52 etiquetas. Las pruebas usan esa misma forma, porque
 * leer el fichero como una tabla normal es exactamente el error que este
 * módulo existe para no cometer.
 */
const TITULO = ["Registro Intervenciones entre fechas (01-01-2022 / 04-11-2026)"];
const BLOQUES = ["(A) Intervención", null, null, null, "Medición"];
const CABECERA = [
  "(A3) Fecha", "(A1) ID intervención", "(A2) Orden trabajo", "(D) Tipo operación",
  "L (vieja)", "L (nueva)", "W (vieja)", "W (nueva)", "K",
  "Neumáticos (viejos)", "Neumáticos (nuevos)", "Cuentakm (viejo)", "Cuentakm (nuevo)",
  "Resultado", "Test reloj (desviación)", "Limitador velocidad (Sí/No)",
  "Marca", "Modelo", "Matrícula", "Bastidor", "Categoría (tipo de carga)",
  "Tipo tacógrafo", "Fabricante", "Referencia", "Versión software", "Núm. serie",
  "Núm. serie sensor", "Nombre", "(B4) Nombre", "(C11) Nombre técnico",
  "Cad. tarjeta", "Observaciones",
];
const FILA = [
  new Date("2022-01-03T00:00:00Z"), "E943009001596K", null,
  "Calibrado o Parametrización / Control / Reparación",
  2125, 2125, 11076, 11076, 11076,
  "205/75R16", "205/75R16", 1071645, 1071640,
  "Favorable", 0, "No comprobado",
  "Mercedes Benz", "518 CDI", "4468GJK", "WDB9066571S196962", "M3",
  "Digital", "VDO", 13810010000018, null, 944005,
  1513745, "TERESA Y JOSE PLANA EMPRESA PLANA S.L.", "COMERCIAL SEA, S.A.",
  "JORDI CRUSET COMAJUNCOSAS", new Date("2022-06-27T00:00:00Z"),
  "T80. El cronómetro dispone de sistema de sincronización horaria periódica. "
  + "Nombre del fichero de descarga: V_4468GJK _E_20220103_1555.tgd",
];
const hoja = (...filas: unknown[][]) => [TITULO, BLOQUES, CABECERA, ...filas];

describe("la cabecera se BUSCA, no se da por hecha", () => {
  it("la encuentra en la tercera fila, que es donde está", () => {
    const l = leerHoja(hoja(FILA));
    expect(l.filaCabecera).toBe(3);
    expect(l.filas).toHaveLength(1);
  });

  it("y la sigue encontrando si el título crece una línea", () => {
    const l = leerHoja([["Informe"], TITULO, BLOQUES, CABECERA, FILA]);
    expect(l.filaCabecera).toBe(4);
    expect(l.filas[0].idOrigen).toBe("E943009001596K");
  });

  it("sin cabecera, se dice qué falta en vez de devolver cero filas", () => {
    expect(() => leerHoja([["cualquier cosa"], ["otra"]]))
      .toThrow(ErrorFichero);
    expect(() => leerHoja([["cualquier cosa"]]))
      .toThrow(/ID intervención/);
  });
});

describe("las columnas se leen por su nombre", () => {
  /**
   * Una columna nueva en medio desplaza todas las de su derecha. Un parser
   * por posición empezaría a guardar el número de serie del sensor en el
   * campo del GNSS sin dar un solo error.
   */
  it("una columna nueva en medio no descoloca nada", () => {
    const cab: unknown[] = [...CABECERA];
    const fil: unknown[] = [...FILA];
    cab.splice(2, 0, "Columna que no existía");
    fil.splice(2, 0, "basura");
    const l = leerHoja([TITULO, BLOQUES, cab, fil]);
    expect(l.filas[0].matriculaNorm).toBe("4468GJK");
    expect(l.filas[0].numSerie).toBe("944005");
    expect(l.columnasDesconocidas).toContain("Columna que no existía");
  });

  it("los acentos y los espacios de más no rompen el cruce", () => {
    const cab = CABECERA.map((c) => c === "Matrícula" ? "MATRICULA " : c);
    const l = leerHoja([TITULO, BLOQUES, cab, FILA]);
    expect(l.filas[0].matriculaNorm).toBe("4468GJK");
  });

  it("«Nombre» es el cliente y «(B4) Nombre» el taller: no se confunden", () => {
    const l = leerHoja(hoja(FILA));
    expect(l.filas[0].clienteNombre).toBe("TERESA Y JOSE PLANA EMPRESA PLANA S.L.");
  });

  it("una columna que falta no es un error: ese campo sale a null", () => {
    const i = CABECERA.indexOf("Fabricante");
    const cab = CABECERA.filter((_, n) => n !== i);
    const fil = FILA.filter((_, n) => n !== i);
    const l = leerHoja([TITULO, BLOQUES, cab, fil]);
    expect(l.filas[0].fabricante).toBeNull();
    expect(l.filas[0].numSerie).toBe("944005");
  });
});

describe("lo que sale de una fila", () => {
  const f = leerHoja(hoja(FILA)).filas[0];

  it("identifica y fecha", () => {
    expect(f.idOrigen).toBe("E943009001596K");
    expect(f.fecha).toBe("2022-01-03");
    expect(f.fila).toBe(4);
  });

  it("normaliza la matrícula y conserva la original", () => {
    expect(f.matriculaOrigen).toBe("4468GJK");
    expect(f.matriculaNorm).toBe("4468GJK");
  });

  it("normaliza la medida y conserva la original", () => {
    expect(f.medidaOrigen).toBe("205/75R16");
    expect(f.medidaNorm).toBe("205/75R16");
    expect(f.medidaSospechosa).toBe(false);
  });

  it("el kilometraje son números, no texto", () => {
    expect(f.kmAnterior).toBe(1071645);
    expect(f.kmNuevo).toBe(1071640);
  });

  it("las comprobaciones van juntas en un objeto", () => {
    expect(f.comprobaciones).toEqual({ reloj: "0", limitador: "No comprobado" });
  });

  it("saca el .tgd de dentro de las observaciones", () => {
    expect(f.tgdFichero).toBe("V_4468GJK_E_20220103_1555.tgd");
  });

  it("el cliente original se guarda tal cual venía", () => {
    expect(f.clienteNombre).toBe("TERESA Y JOSE PLANA EMPRESA PLANA S.L.");
  });
});

describe("matrículas escritas de otra manera", () => {
  const con = (m: string) => {
    const fil: unknown[] = [...FILA];
    fil[CABECERA.indexOf("Matrícula")] = m;
    return leerHoja(hoja(fil)).filas[0];
  };
  it("espacios, guiones y minúsculas dan la misma", () => {
    expect(con("4468 GJK").matriculaNorm).toBe("4468GJK");
    expect(con("4468-GJK").matriculaNorm).toBe("4468GJK");
    expect(con("4468gjk").matriculaNorm).toBe("4468GJK");
  });
});

describe("lo que no se entiende se DICE, no se inventa", () => {
  const cambiar = (col: string, v: unknown) => {
    const fil: unknown[] = [...FILA];
    fil[CABECERA.indexOf(col)] = v;
    return leerHoja(hoja(fil));
  };

  it("sin ID no entra, y se dice en qué fila", () => {
    const l = cambiar("(A1) ID intervención", null);
    expect(l.filas).toHaveLength(0);
    expect(l.problemas[0]).toMatchObject({ fila: 4, motivo: expect.stringMatching(/Sin ID/) });
  });

  it("sin matrícula no entra", () => {
    const l = cambiar("Matrícula", "   ");
    expect(l.filas).toHaveLength(0);
    expect(l.problemas[0].motivo).toMatch(/Sin matrícula/);
  });

  it("sin fecha SÍ entra, pero avisando: el dato existe", () => {
    const l = cambiar("(A3) Fecha", "vete a saber");
    expect(l.filas).toHaveLength(1);
    expect(l.filas[0].fecha).toBeNull();
    expect(l.problemas[0].motivo).toMatch(/Sin fecha/);
  });

  it("una medida ilegible se guarda en crudo y se marca", () => {
    const l = cambiar("Neumáticos (nuevos)", "la de siempre");
    expect(l.filas[0].medidaOrigen).toBe("la de siempre");
    expect(l.filas[0].medidaNorm).toBeNull();
    expect(l.filas[0].medidaSospechosa).toBe(true);
    expect(l.problemas[0].motivo).toMatch(/no se sabe leer/);
  });

  it("sin medida no hay nada que marcar", () => {
    const l = cambiar("Neumáticos (nuevos)", null);
    expect(l.filas[0].medidaSospechosa).toBe(false);
    expect(l.problemas).toHaveLength(0);
  });
});

describe("el mismo ID dos veces dentro del fichero", () => {
  it("se queda la primera y se dice, en vez de pisarse al grabar", () => {
    const l = leerHoja(hoja(FILA, FILA));
    expect(l.filas).toHaveLength(1);
    expect(l.problemas[0].motivo).toMatch(/repetido dentro del fichero/);
    expect(l.problemas[0].valor).toBe("E943009001596K");
  });
});

describe("filas en blanco", () => {
  it("no cuentan ni como fila ni como problema", () => {
    const l = leerHoja(hoja(FILA, [], [null, null, null], FILA.map(() => null)));
    expect(l.filas).toHaveLength(1);
    expect(l.problemas).toHaveLength(0);
  });
});

describe("conversiones sueltas", () => {
  it("fechaDe acepta Date, ISO y dd-mm-aaaa", () => {
    expect(fechaDe(new Date("2024-03-05T10:00:00Z"))).toBe("2024-03-05");
    expect(fechaDe("2024-03-05")).toBe("2024-03-05");
    expect(fechaDe("05-03-2024")).toBe("2024-03-05");
    expect(fechaDe("5/3/2024")).toBe("2024-03-05");
    expect(fechaDe("marzo")).toBeNull();
    expect(fechaDe(null)).toBeNull();
  });

  it("numeroDe no convierte el vacío en cero", () => {
    expect(numeroDe(null)).toBeNull();
    expect(numeroDe("")).toBeNull();
    expect(numeroDe(0)).toBe(0);
    expect(numeroDe("1.071.645")).toBe(1071645);
    expect(numeroDe("1071645")).toBe(1071645);
    expect(numeroDe("12,5")).toBe(12.5);
    expect(numeroDe("nada")).toBeNull();
  });

  it("tgdDe encuentra el fichero o devuelve null", () => {
    expect(tgdDe("... descarga: V_1234ABC _E_20220103_1555.tgd")).toBe("V_1234ABC_E_20220103_1555.tgd");
    expect(tgdDe("sin fichero")).toBeNull();
    expect(tgdDe(null)).toBeNull();
  });
});
