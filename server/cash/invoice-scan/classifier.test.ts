/**
 * Pruebas del clasificador de forma de cobro.
 *
 * La evidencia de estas pruebas está copiada de las tres facturas reales de
 * Comercial Sea, incluidos los datos del recibo del TPV. No hay red ni base de
 * datos: entra evidencia, entran reglas, sale propuesta.
 */

import { describe, expect, it } from "vitest";
import {
  UMBRAL_FORMA_COBRO,
  clasificar,
  type EvidenciaCobro,
  type ReglaFormaCobro,
} from "./classifier.ts";

/** Lo que la empresa tiene dado de alta hoy en Configuración. */
const CATALOGO = new Set([
  "CASH",
  "BBVA_CARD",
  "CAIXABANK_CARD",
  "AMEX",
  "BANK_TRANSFER",
  "CLEARONE",
  "STRIPE",
]);

const SIN_RECIBO: EvidenciaCobro = {
  reciboDetectado: false,
  importeReciboCentimos: null,
  adquirente: null,
  comercio: null,
  terminal: null,
  red: null,
  cuenta: null,
  plantilla: "DESCONOCIDA",
  textoRecibo: null,
  confianzaRecibo: 0,
};

/**
 * B0020000580. El recibo lo imprime la propia factura, con sus columnas: es el
 * TPV integrado con el ERP. Ojo al texto, que lleva «Visa CaixaBank» dentro.
 */
const RECIBO_580: EvidenciaCobro = {
  reciboDetectado: true,
  importeReciboCentimos: 19510,
  adquirente: null,
  comercio: "702",
  terminal: "1",
  red: "Servired",
  cuenta: "BBVA",
  plantilla: "INTEGRADO_ERP",
  textoRecibo:
    "Recibo Cliente de Pago por TPV Tipo Operación : VENTA Tarjeta : ************7394 " +
    "Num.Operación : 179.307 Cuenta : BBVA Tipo Lectura : Tarjeta Contactless ARC : 00 " +
    "Comercio: 702 Cod. Aut: 369389 Red : Servired AID : A0000000031010 LBL : Visa CaixaBank " +
    "Tpv : 1 Ticket : 24.935",
  confianzaRecibo: 0.97,
};

/**
 * B0020000579. El resguardo es el papelito del datáfono, fotografiado encima
 * de la factura, con el logotipo de Comercia Global Payments.
 */
const RECIBO_579: EvidenciaCobro = {
  reciboDetectado: true,
  importeReciboCentimos: 2293,
  adquirente: "Comercia Global Payments",
  comercio: "266179530",
  terminal: "01038447",
  red: null,
  cuenta: null,
  plantilla: "TICKET_BANCO",
  textoRecibo:
    "Comercia Global Payments MASTERCARD CONTACTLESS REUS 27/08/2026 09:34 COMERCIAL SEA " +
    "22,93 EUR COMBO 1 FIN.MES ***5762 VENDA COMERC: 266179530 TPV: 01038447 AUT: 201864 " +
    "Op: 502075 Tran: 01242 AID: A0000000041010 ARC: 00 TIQUET PER AL CLIENT",
  confianzaRecibo: 0.94,
};

const regla = (r: Partial<ReglaFormaCobro> & Pick<ReglaFormaCobro, "campo" | "patron" | "formaPago">): ReglaFormaCobro => ({
  id: 1,
  confianza: 0.98,
  autoSeleccionar: true,
  prioridad: 100,
  ...r,
});

describe("sin justificante no se decide nada", () => {
  it("una factura sin TPV NO se clasifica como efectivo", () => {
    /*
     * Es la regla que da sentido a todo el módulo. La factura B0020000576 se
     * cobró de verdad en efectivo, y aun así el sistema no puede decirlo: lo
     * único que consta es que no hay resguardo, y eso también pasa cuando se
     * cobra por transferencia o cuando nadie escaneó el ticket.
     */
    const r = clasificar(SIN_RECIBO, [], CATALOGO);
    expect(r.formaPago).toBe(null);
    expect(r.formaPago).not.toBe("CASH");
    expect(r.autoSeleccionar).toBe(false);
    expect(r.confianza).toBe(0);
  });

  it("ni siquiera una regla que casara podría inventar el pago", () => {
    // Sin recibo no se miran las reglas: no hay evidencia que reconocer.
    const reglas = [regla({ campo: "TEXTO", patron: "factura", formaPago: "CASH" })];
    expect(clasificar(SIN_RECIBO, reglas, CATALOGO).formaPago).toBe(null);
  });

  it("el motivo lo dice con palabras, para que nadie lo lea al revés", () => {
    expect(clasificar(SIN_RECIBO, [], CATALOGO).motivo).toContain("efectivo");
  });
});

describe("CaixaBank por el adquirente del ticket", () => {
  it("reconoce Comercia Global Payments y lo puede preseleccionar", () => {
    const reglas = [
      regla({ campo: "ADQUIRENTE", patron: "Comercia Global Payments", formaPago: "CAIXABANK_CARD" }),
    ];
    const r = clasificar(RECIBO_579, reglas, CATALOGO);
    expect(r.formaPago).toBe("CAIXABANK_CARD");
    expect(r.autoSeleccionar).toBe(true);
    expect(r.confianza).toBeGreaterThanOrEqual(UMBRAL_FORMA_COBRO);
    expect(r.reglaId).toBe(1);
  });

  it("también vale la regla por número de comercio, que es exacto", () => {
    const reglas = [regla({ campo: "COMERCIO", patron: "266179530", formaPago: "CAIXABANK_CARD" })];
    expect(clasificar(RECIBO_579, reglas, CATALOGO).formaPago).toBe("CAIXABANK_CARD");
  });

  it("un comercio parecido pero distinto NO casa", () => {
    // Los identificativos se comparan enteros: «26617953» es otro comercio.
    const reglas = [regla({ campo: "COMERCIO", patron: "26617953", formaPago: "CAIXABANK_CARD" })];
    expect(clasificar(RECIBO_579, reglas, CATALOGO).formaPago).toBe(null);
  });
});

describe("el TPV integrado del ERP", () => {
  it("se reconoce por comercio y terminal, no por lo que ponga el texto", () => {
    const reglas = [
      regla({ id: 7, campo: "COMERCIO", patron: "702", formaPago: "CLEARONE" }),
    ];
    const r = clasificar(RECIBO_580, reglas, CATALOGO);
    expect(r.formaPago).toBe("CLEARONE");
    expect(r.reglaId).toBe(7);
    expect(r.motivo).toContain("comercio");
  });

  it("«Visa CaixaBank» en el texto no convierte un cobro de BBVA en CaixaBank", () => {
    /*
     * Esto salió al leer la factura B0020000580 de verdad: su recibo imprime
     * «LBL : Visa CaixaBank» porque así se llama el producto de la tarjeta del
     * cliente, no el TPV. Una regla de texto suelto la clasificaría mal; por
     * eso las reglas dicen en qué campo miran, y la del adquirente no casa.
     */
    const reglas = [
      regla({ campo: "ADQUIRENTE", patron: "Comercia Global Payments", formaPago: "CAIXABANK_CARD" }),
    ];
    expect(clasificar(RECIBO_580, reglas, CATALOGO).formaPago).toBe(null);
  });

  it("una regla de TEXTO mal puesta sí se equivocaría, y por eso se avisa", () => {
    // Se documenta el peligro: con TEXTO, el patrón «CaixaBank» casa aquí.
    const reglas = [regla({ campo: "TEXTO", patron: "CaixaBank", formaPago: "CAIXABANK_CARD" })];
    expect(clasificar(RECIBO_580, reglas, CATALOGO).formaPago).toBe("CAIXABANK_CARD");
  });
});

describe("prioridad y catálogo", () => {
  it("manda la regla de prioridad más baja", () => {
    const reglas = [
      regla({ id: 2, prioridad: 200, campo: "CUENTA", patron: "BBVA", formaPago: "BBVA_CARD" }),
      regla({ id: 3, prioridad: 10, campo: "COMERCIO", patron: "702", formaPago: "CLEARONE" }),
    ];
    expect(clasificar(RECIBO_580, reglas, CATALOGO).formaPago).toBe("CLEARONE");
  });

  it("una regla que apunta a una forma dada de baja se salta y se explica", () => {
    const reglas = [regla({ campo: "CUENTA", patron: "BBVA", formaPago: "YA_NO_EXISTE" })];
    const r = clasificar(RECIBO_580, reglas, CATALOGO);
    expect(r.formaPago).toBe(null);
    expect(r.motivo).toContain("YA_NO_EXISTE");
  });

  it("con recibo pero sin regla que lo reconozca, tampoco se adivina", () => {
    const r = clasificar(RECIBO_579, [], CATALOGO);
    expect(r.formaPago).toBe(null);
    expect(r.autoSeleccionar).toBe(false);
    expect(r.motivo).toContain("Configuración");
  });
});

describe("la confianza no se hereda: se toma la peor", () => {
  it("un recibo mal leído baja la propuesta aunque la regla sea infalible", () => {
    const borroso = { ...RECIBO_579, confianzaRecibo: 0.4 };
    const reglas = [
      regla({ campo: "ADQUIRENTE", patron: "Comercia Global Payments", formaPago: "CAIXABANK_CARD", confianza: 1 }),
    ];
    const r = clasificar(borroso, reglas, CATALOGO);
    expect(r.formaPago).toBe("CAIXABANK_CARD");
    expect(r.confianza).toBe(0.4);
    // Se propone, pero NO se marca sola: por debajo del umbral decide la persona.
    expect(r.autoSeleccionar).toBe(false);
  });

  it("una regla que el usuario marcó como no automática nunca se marca sola", () => {
    const reglas = [
      regla({ campo: "ADQUIRENTE", patron: "Comercia Global Payments", formaPago: "CAIXABANK_CARD", autoSeleccionar: false }),
    ];
    const r = clasificar(RECIBO_579, reglas, CATALOGO);
    expect(r.formaPago).toBe("CAIXABANK_CARD");
    expect(r.autoSeleccionar).toBe(false);
  });
});
