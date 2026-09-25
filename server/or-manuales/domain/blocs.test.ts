/**
 * Las reglas del bloc, probadas sin base de datos.
 *
 * Todo lo de aquí es aritmética y decisiones sobre listas, así que se prueba
 * con objetos escritos a mano. Lo que necesita PostgreSQL —el UNIQUE que impide
 * que una OR caiga en dos blocs, el cerrojo del cierre— está en
 * `or-manuales.integration.test.ts`, que es donde esas garantías existen de
 * verdad.
 */

import { describe, expect, it } from "vitest";
import {
  comprobarBorrado,
  comprobarCierre,
  estadoCalculado,
  numerosDelRango,
  progresoDeBloc,
  rangoDesde,
  rangosSolapan,
  siguienteNumeroBloc,
  validarNumeroBloc,
  validarRango,
  type ResumenOr,
} from "./blocs.ts";
import { ErrorOrManuales } from "../errors.ts";

/** 25 OR del 1026 al 1050, todas pendientes salvo las que se digan. */
function ors(desde: number, hasta: number, excepciones: Record<number, ResumenOr["estado"]> = {}): ResumenOr[] {
  const lista: ResumenOr[] = [];
  for (let n = desde; n <= hasta; n += 1) {
    lista.push({ numeroOr: n, estado: excepciones[n] ?? "ESCANEADA" });
  }
  return lista;
}

describe("El rango del bloc", () => {
  it("calcula la OR final a partir de la inicial: 1126 + 25 OR → 1150", () => {
    expect(rangoDesde(1126)).toEqual({ orInicial: 1126, orFinal: 1150, cantidadOr: 25 });
  });

  it("acepta un bloc de otro tamaño sin tocar el código", () => {
    expect(rangoDesde(1, 50)).toEqual({ orInicial: 1, orFinal: 50, cantidadOr: 50 });
  });

  it("valida el formulario: con sólo la OR inicial, pone 25", () => {
    expect(validarRango({ orInicial: "2001" })).toEqual({ orInicial: 2001, orFinal: 2025, cantidadOr: 25 });
  });

  it("acepta que llegue la OR final si coincide con la cuenta", () => {
    expect(validarRango({ orInicial: 1026, orFinal: 1050 })).toEqual({ orInicial: 1026, orFinal: 1050, cantidadOr: 25 });
  });

  it("no elige en silencio cuando la OR final y la cantidad no cuadran", () => {
    expect(() => validarRango({ orInicial: 1026, orFinal: 1049, cantidadOr: 25 })).toThrow(ErrorOrManuales);
  });

  it("rechaza lo que no es un número entero", () => {
    expect(() => validarRango({ orInicial: "mil veintiséis" })).toThrow(/número entero/);
    expect(() => validarRango({ orInicial: 10.5 })).toThrow(/número entero/);
    expect(() => validarRango({ orInicial: 0 })).toThrow(/mayor que cero/);
  });

  it("pone un tope al tamaño: nadie da de alta un bloc de mil hojas por error", () => {
    expect(() => validarRango({ orInicial: 1, cantidadOr: 5000 })).toThrow(/entre 1 y 200/);
  });

  it("detecta que dos rangos se pisan", () => {
    const a = rangoDesde(1026);
    expect(rangosSolapan(a, rangoDesde(1040))).toBe(true);
    expect(rangosSolapan(a, rangoDesde(1002))).toBe(true); // 1002-1026, se tocan por un número
    expect(rangosSolapan(a, rangoDesde(1001))).toBe(false); // 1001-1025, justo antes
    expect(rangosSolapan(a, rangoDesde(1051))).toBe(false); // 1051-1075, justo después
    expect(rangosSolapan(a, rangoDesde(1000, 27))).toBe(true); // un bloc de otro tamaño que llega hasta 1026
  });

  it("enumera los 25 números en orden", () => {
    const n = numerosDelRango(rangoDesde(1026));
    expect(n).toHaveLength(25);
    expect(n[0]).toBe(1026);
    expect(n[24]).toBe(1050);
  });
});

describe("El número del bloc siguiente", () => {
  it("conserva los ceros de delante: 002 → 003", () => {
    expect(siguienteNumeroBloc("002")).toBe("003");
    expect(siguienteNumeroBloc("009")).toBe("010");
    expect(siguienteNumeroBloc("099")).toBe("100");
  });

  it("se le queda corto el ancho sin romperse", () => {
    expect(siguienteNumeroBloc("999")).toBe("1000");
  });

  it("respeta un prefijo de letras", () => {
    expect(siguienteNumeroBloc("TAR-007")).toBe("TAR-008");
  });

  it("empieza por 001 cuando no hay ninguno", () => {
    expect(siguienteNumeroBloc(null)).toBe("001");
    expect(siguienteNumeroBloc("")).toBe("001");
    expect(siguienteNumeroBloc("sin números")).toBe("001");
  });
});

describe("El recuento", () => {
  it("dice exactamente cuáles faltan, que es lo que hay que buscar", () => {
    const p = progresoDeBloc(ors(1026, 1050, { 1032: "PENDIENTE", 1047: "PENDIENTE" }));
    expect(p.total).toBe(25);
    expect(p.archivadas).toBe(23);
    expect(p.pendientes).toBe(2);
    expect(p.faltan).toEqual([1032, 1047]);
    expect(p.porcentaje).toBe(92);
  });

  it("una OR con error cuenta como que falta: no hay papel dentro", () => {
    const p = progresoDeBloc(ors(1, 4, { 3: "ERROR" }));
    expect(p.faltan).toEqual([3]);
    expect(p.conError).toBe(1);
  });

  it("una OR en revisión SÍ cuenta como archivada, pero se marca", () => {
    const p = progresoDeBloc(ors(1, 4, { 2: "REVISAR" }));
    expect(p.archivadas).toBe(4);
    expect(p.pendientes).toBe(0);
    expect(p.enRevision).toBe(1);
  });

  it("un bloc vacío no divide por cero", () => {
    expect(progresoDeBloc([]).porcentaje).toBe(0);
  });
});

describe("El estado que se calcula solo", () => {
  const completo = progresoDeBloc(ors(1, 25));
  const aMedias = progresoDeBloc(ors(1, 25, { 7: "PENDIENTE" }));
  const vacio = progresoDeBloc(ors(1, 25, Object.fromEntries([...Array(25)].map((_, i) => [i + 1, "PENDIENTE"]))));

  it("con las 25 y nada que mirar, COMPLETO", () => {
    expect(estadoCalculado("PENDIENTE_ESCANEO", completo)).toBe("COMPLETO");
  });

  it("con las 25 pero alguna en revisión, REVISAR", () => {
    const conRevision = progresoDeBloc(ors(1, 25, { 4: "REVISAR" }));
    expect(estadoCalculado("PENDIENTE_ESCANEO", conRevision)).toBe("REVISAR");
  });

  it("devuelto y sin escanear nada, PENDIENTE_ESCANEO", () => {
    expect(estadoCalculado("DEVUELTO", vacio)).toBe("PENDIENTE_ESCANEO");
  });

  it("devuelto y a medias, INCOMPLETO", () => {
    expect(estadoCalculado("DEVUELTO", aMedias)).toBe("INCOMPLETO");
  });

  it("NO toca un bloc cerrado: cerrar es una decisión de una persona", () => {
    expect(estadoCalculado("CERRADO", aMedias)).toBeNull();
    expect(estadoCalculado("CERRADO", completo)).toBeNull();
  });

  it("no marca incompleto un bloc que el taller todavía tiene en la mano", () => {
    // Entregado y sin nada escaneado: es que lo están rellenando, no una anomalía.
    expect(estadoCalculado("ENTREGADO", vacio)).toBeNull();
    expect(estadoCalculado("DISPONIBLE", vacio)).toBeNull();
  });

  it("pero sí en cuanto empiezan a llegar hojas suyas", () => {
    expect(estadoCalculado("ENTREGADO", aMedias)).toBe("INCOMPLETO");
  });

  it("un bloc entregado que se completa entero pasa a COMPLETO", () => {
    expect(estadoCalculado("ENTREGADO", completo)).toBe("COMPLETO");
  });
});

describe("Cerrar el bloc", () => {
  it("se puede con las 25 archivadas", () => {
    expect(() => comprobarCierre("COMPLETO", progresoDeBloc(ors(1, 25)))).not.toThrow();
  });

  it("no se puede si faltan, y se dice cuáles", () => {
    try {
      comprobarCierre("INCOMPLETO", progresoDeBloc(ors(1026, 1050, { 1032: "PENDIENTE", 1047: "PENDIENTE" })));
      expect.unreachable("tenía que haber lanzado");
    } catch (e) {
      const err = e as ErrorOrManuales;
      expect(err.codigo).toBe("BLOC_INCOMPLETO");
      expect(err.message).toContain("1032");
      expect(err.message).toContain("1047");
      expect(err.estado).toBe(409);
    }
  });

  it("no se puede con documentos por revisar", () => {
    expect(() => comprobarCierre("REVISAR", progresoDeBloc(ors(1, 25, { 3: "REVISAR" })))).toThrow(/revisar/i);
  });

  it("no se cierra dos veces", () => {
    expect(() => comprobarCierre("CERRADO", progresoDeBloc(ors(1, 25)))).toThrow(/ya está cerrado/);
  });
});

describe("Borrar el bloc", () => {
  const vacio = progresoDeBloc(ors(1, 25, Object.fromEntries([...Array(25)].map((_, i) => [i + 1, "PENDIENTE"]))));
  const conHojas = progresoDeBloc(ors(1, 25, { 2: "PENDIENTE" }));

  it("un bloc sin nada archivado se borra sin más", () => {
    expect(() => comprobarBorrado("DISPONIBLE", vacio, false)).not.toThrow();
  });

  it("uno con hojas dentro exige confirmarlo, y dice cuántas son", () => {
    try {
      comprobarBorrado("INCOMPLETO", conHojas, false);
      expect.unreachable("tenía que haber lanzado");
    } catch (e) {
      const err = e as ErrorOrManuales;
      expect(err.codigo).toBe("BLOC_CON_DOCUMENTOS");
      expect(err.message).toContain("24");
      expect(err.estado).toBe(409);
    }
  });

  it("confirmado, sí se borra aunque tenga hojas", () => {
    expect(() => comprobarBorrado("INCOMPLETO", conHojas, true)).not.toThrow();
  });

  it("un bloc CERRADO no se borra NUNCA: es el archivo", () => {
    expect(() => comprobarBorrado("CERRADO", vacio, true)).toThrow(/archivo/i);
  });
});

describe("El número del bloc al renumerar", () => {
  it("se queda con lo escrito, sin espacios de sobra", () => {
    expect(validarNumeroBloc("  001 ")).toBe("001");
    expect(validarNumeroBloc("TAR-007")).toBe("TAR-007");
  });

  it("no se deja en blanco", () => {
    expect(() => validarNumeroBloc("   ")).toThrow(/en blanco/);
    expect(() => validarNumeroBloc(null)).toThrow(/en blanco/);
  });

  it("no admite un nombre kilométrico", () => {
    expect(() => validarNumeroBloc("x".repeat(41))).toThrow(/40/);
  });
});
