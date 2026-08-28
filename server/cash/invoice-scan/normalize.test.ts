/**
 * Pruebas del normalizador, escritas con lo que de verdad imprimen las
 * facturas de Comercial Sea: los textos de esta suite están copiados de las
 * tres facturas de referencia, no inventados.
 */

import { describe, expect, it } from "vitest";
import type { ExtraccionCruda } from "./types.ts";
import {
  confianza,
  fechaImpresa,
  identificador,
  importeImpreso,
  matricula,
  textoOpcional,
  sinDatosDeTarjeta,
  ultimosCuatro,
} from "./normalize.ts";

describe("importes tal y como se imprimen", () => {
  it("lee los totales de las tres facturas de referencia", () => {
    expect(importeImpreso("195,10 €")).toBe(19510);
    expect(importeImpreso("Total (IVA INCLUIDO) : 22,93 EUR".slice(-9))).toBe(2293);
    expect(importeImpreso("340,25 €")).toBe(34025);
    expect(importeImpreso("22,93 EUR")).toBe(2293);
  });

  it("aguanta el punto de los miles y el símbolo pegado", () => {
    expect(importeImpreso("1.234,56")).toBe(123456);
    expect(importeImpreso("1.234,56€")).toBe(123456);
    expect(importeImpreso("12.345.678,90")).toBe(1234567890);
  });

  it("aguanta la forma inglesa, que sale de algunos escáneres", () => {
    expect(importeImpreso("1,234.56")).toBe(123456);
    expect(importeImpreso("22.93")).toBe(2293);
    // Pero sin decimales que lo desambigüen, «1,234» no se decide.
    expect(importeImpreso("1,234")).toBe(null);
  });

  it("un espacio entre cifras es una coma perdida: no se adivina", () => {
    // «195 10» juntando espacios sería 19.510,00 €, cien veces el importe de
    // verdad, y eso no se nota hasta que no cuadra la caja.
    expect(importeImpreso("195 10")).toBe(null);
    expect(importeImpreso("1 234,56")).toBe(null);
    // Los de los extremos, en cambio, sobran y se quitan.
    expect(importeImpreso("  195,10 €  ")).toBe(19510);
  });

  it("un importe sin decimales es euros enteros, no céntimos", () => {
    expect(importeImpreso("50")).toBe(5000);
    expect(importeImpreso("50 €")).toBe(5000);
  });

  it("lo que no es un importe se queda en null, que es DESCONOCIDO", () => {
    expect(importeImpreso("")).toBe(null);
    expect(importeImpreso(null)).toBe(null);
    expect(importeImpreso("Total a Pagar")).toBe(null);
    expect(importeImpreso("19,5")).toBe(null); // una sola cifra decimal
    expect(importeImpreso("19,500")).toBe(null); // ni 19,50 ni 19.500
    expect(importeImpreso("1.23,45")).toBe(null); // millares mal puestos
  });

  it("el cero es un importe, no una ausencia", () => {
    // Distinguirlos importa: una factura a cero existe; una sin total, no.
    expect(importeImpreso("0,00 €")).toBe(0);
  });
});

describe("huecos que el ERP rellena con texto", () => {
  it("«S/D» no es una marca de coche", () => {
    // De la factura B0020000579, literal: «[Marca S/D] [Modelo S/D]».
    expect(textoOpcional("[Marca S/D]")).toBe(null);
    expect(textoOpcional("S/D")).toBe(null);
    expect(textoOpcional("  ")).toBe(null);
    expect(textoOpcional("-")).toBe(null);
  });

  it("lo que sí trae datos se conserva, con los espacios apretados", () => {
    expect(textoOpcional("NISSAN IVERA  ")).toBe("NISSAN IVERA");
    expect(textoOpcional("SAT AGRO  CARBONELL")).toBe("SAT AGRO CARBONELL");
  });
});

describe("fechas", () => {
  it("lee la fecha de las facturas", () => {
    expect(fechaImpresa("27/08/2026")).toBe("2026-08-27");
    expect(fechaImpresa("26/08/2026")).toBe("2026-08-26");
  });

  it("lee la del ticket del TPV, con año corto y hora detrás", () => {
    expect(fechaImpresa("27/08/26 09:34")).toBe("2026-08-27");
    expect(fechaImpresa("2026-08-27 - 11:23:21.0000000")).toBe("2026-08-27");
  });

  it("una fecha imposible no se inventa: se queda en null", () => {
    expect(fechaImpresa("31/02/2026")).toBe(null);
    expect(fechaImpresa("00/08/2026")).toBe(null);
    expect(fechaImpresa("Fecha")).toBe(null);
  });
});

describe("matrículas", () => {
  it("normaliza las de las facturas de referencia", () => {
    expect(matricula("9655JYL")).toBe("9655JYL");
    expect(matricula("3950 LXL")).toBe("3950LXL");
    expect(matricula("9655-jyl")).toBe("9655JYL");
  });

  it("una matrícula que no es española se conserva, no se tira", () => {
    // Es el dato que más identifica al vehículo en el concepto.
    expect(matricula("AB-123-CD")).toBe("AB123CD");
  });

  it("sin matrícula, null", () => {
    expect(matricula("")).toBe(null);
    expect(matricula("S/D")).toBe(null);
  });
});

describe("datos del recibo del TPV", () => {
  it("de la tarjeta solo salen los cuatro últimos", () => {
    // Es el único sitio por el que ese dato entra, y no sabe devolver más.
    expect(ultimosCuatro("************7394")).toBe("7394");
    expect(ultimosCuatro("**********5762")).toBe("5762");
    expect(ultimosCuatro("4548 8100 0000 1234")).toBe("1234");
  });

  it("una tarjeta ilegible no deja un resto a medias", () => {
    expect(ultimosCuatro("***")).toBe(null);
    expect(ultimosCuatro("")).toBe(null);
  });

  it("los identificadores pierden el punto de millar de la impresora", () => {
    // El extracto del banco los trae sin él, y si no coinciden no concilian.
    expect(identificador("179.307")).toBe("179307");
    expect(identificador("24.935")).toBe("24935");
    expect(identificador("266179530")).toBe("266179530");
    expect(identificador("01038447")).toBe("01038447");
  });

  it("un identificador con letras no se toca", () => {
    expect(identificador("A0000000041010")).toBe("A0000000041010");
  });
});

describe("confianza declarada por el modelo", () => {
  it("se encaja entre 0 y 1", () => {
    expect(confianza(0.97)).toBe(0.97);
    expect(confianza(1.4)).toBe(1);
    expect(confianza(-0.2)).toBe(0);
  });

  it("sin confianza declarada, CERO, nunca uno", () => {
    // Al revés, un campo que el modelo no puntúa pasaría cualquier umbral.
    expect(confianza(undefined)).toBe(0);
    expect(confianza(null)).toBe(0);
    expect(confianza("mucha")).toBe(0);
  });
});

describe("la cruda se guarda sin números de tarjeta", () => {
  const conTarjeta = (tarjeta: string | null, texto: string | null) =>
    ({
      recibo: { tarjeta, texto },
    }) as unknown as ExtraccionCruda;

  it("la tarjeta se queda en sus cuatro últimos", () => {
    const r = sinDatosDeTarjeta(conTarjeta("************7394", null));
    expect(r.recibo.tarjeta).toBe("···7394");
  });

  it("un número entero que se colara en el texto también se recorta", () => {
    /*
     * Los datáfonos enmascaran, pero eso depende de cómo esté configurado cada
     * uno, y un OCR puede leer asteriscos como ceros. Lo que no puede pasar es
     * que quede guardado: no lo arregla nadie después.
     */
    const r = sinDatosDeTarjeta(
      conTarjeta(null, "VENTA 4548 8100 0000 1234 IMPORTE 22,93 EUR")
    );
    expect(r.recibo.texto).toBe("VENTA ···1234 IMPORTE 22,93 EUR");
    expect(r.recibo.texto).not.toContain("4548");
  });

  it("lo que no es una tarjeta no se toca", () => {
    // Un número de comercio o una autorización son cortos y tienen que quedar.
    const r = sinDatosDeTarjeta(conTarjeta(null, "COMERC: 266179530 AUT: 201864"));
    expect(r.recibo.texto).toBe("COMERC: 266179530 AUT: 201864");
  });

  it("sin recibo no revienta", () => {
    const r = sinDatosDeTarjeta(conTarjeta(null, null));
    expect(r.recibo.tarjeta).toBe(null);
    expect(r.recibo.texto).toBe(null);
  });
});
