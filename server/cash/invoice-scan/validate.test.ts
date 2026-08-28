/**
 * Los tres casos de referencia, de la evidencia cruda a la propuesta.
 *
 * Las extracciones de esta suite son lo que un modelo DEBE devolver leyendo
 * esas tres facturas: los textos están copiados del papel. Así, el día que se
 * cambie el prompt o el modelo, estas pruebas siguen diciendo qué tiene que
 * salir por el otro lado.
 */

import { describe, expect, it } from "vitest";
import { clasificar, type ReglaFormaCobro } from "./classifier.ts";
import { evidenciaDeCobro, normalizar } from "./normalize.ts";
import type { ExtraccionCruda } from "./types.ts";
import { UMBRALES, validar } from "./validate.ts";

const CATALOGO = new Set(["CASH", "BBVA_CARD", "CAIXABANK_CARD", "BANK_TRANSFER", "CLEARONE"]);

const REGLAS: ReglaFormaCobro[] = [
  {
    id: 1,
    campo: "COMERCIO",
    patron: "702",
    formaPago: "CLEARONE",
    confianza: 0.97,
    autoSeleccionar: true,
    prioridad: 10,
  },
  {
    id: 2,
    campo: "ADQUIRENTE",
    patron: "Comercia Global Payments",
    formaPago: "CAIXABANK_CARD",
    confianza: 0.98,
    autoSeleccionar: true,
    prioridad: 20,
  },
];

/** El armazón vacío, para no repetirlo en cada caso. */
const CRUDA: ExtraccionCruda = {
  es_factura: true,
  facturas_detectadas: 1,
  factura: { numero: null, fecha: null },
  cliente: { codigo: null, nombre: null, nif: null },
  vehiculo: { marca: null, modelo: null, matricula: null },
  concepto: null,
  totales: { base_imponible: null, iva_importe: null, iva_porcentaje: null, total: null, moneda: null },
  recibo: {
    detectado: false,
    recibos_detectados: 0,
    plantilla: "DESCONOCIDA",
    importe: null,
    tipo_operacion: null,
    tarjeta: null,
    num_operacion: null,
    cod_autorizacion: null,
    comercio: null,
    terminal: null,
    red: null,
    adquirente: null,
    cuenta: null,
    fecha_hora: null,
    texto: null,
  },
  confianza: { numero_factura: 0.99, cliente: 0.97, total: 0.99, concepto: 0.85, recibo: 0 },
};

/** B0020000580 — TPV integrado del ERP, cobro por ClearOne. */
const A: ExtraccionCruda = {
  ...CRUDA,
  factura: { numero: "B0020000580", fecha: "27/08/2026" },
  cliente: { codigo: "2979", nombre: "CARLOS GONZALEZ CABALLERO", nif: "78048667F" },
  vehiculo: { marca: "NISSAN", modelo: "IVERA", matricula: "9655JYL" },
  concepto: "NISSAN IVERA · 9655JYL · Cambio de aceite y filtro",
  totales: {
    base_imponible: "161,24",
    iva_importe: "33,86 €",
    iva_porcentaje: "21,00%",
    total: "195,10 EUR",
    moneda: "EUR",
  },
  recibo: {
    detectado: true,
    recibos_detectados: 1,
    plantilla: "INTEGRADO_ERP",
    importe: "195,10",
    tipo_operacion: "VENTA",
    tarjeta: "************7394",
    num_operacion: "179.307",
    cod_autorizacion: "369389",
    comercio: "702",
    terminal: "1",
    red: "Servired",
    adquirente: null,
    cuenta: "BBVA",
    fecha_hora: "2026-08-27 - 11:23:21.0000000",
    texto: "Recibo Cliente de Pago por TPV ... LBL : Visa CaixaBank ... Ticket : 24.935",
  },
  confianza: { numero_factura: 0.99, cliente: 0.98, total: 0.99, concepto: 0.86, recibo: 0.97 },
};

/** B0020000579 — ticket del datáfono fotografiado, Comercia Global Payments. */
const B: ExtraccionCruda = {
  ...CRUDA,
  factura: { numero: "B0020000579", fecha: "27/08/2026" },
  cliente: { codigo: "20989", nombre: "SAT AGRO CARBONELL", nif: "F43109503" },
  vehiculo: { marca: "[Marca S/D]", modelo: "[Modelo S/D]", matricula: null },
  concepto: "Válvulas agrícolas TR618A aire/agua C9586",
  totales: {
    base_imponible: "18,95",
    iva_importe: "3,98 €",
    iva_porcentaje: "21,00%",
    total: "22,93 €",
    moneda: "EUR",
  },
  recibo: {
    detectado: true,
    recibos_detectados: 1,
    plantilla: "TICKET_BANCO",
    importe: "22,93 EUR",
    tipo_operacion: "VENDA",
    tarjeta: "**********5762",
    num_operacion: "502075",
    cod_autorizacion: "201864",
    comercio: "266179530",
    terminal: "01038447",
    red: null,
    adquirente: "Comercia Global Payments",
    cuenta: null,
    fecha_hora: "27/08/2026 09:34",
    texto: "Comercia Global Payments MASTERCARD CONTACTLESS ... TIQUET PER AL CLIENT",
  },
  confianza: { numero_factura: 0.97, cliente: 0.95, total: 0.98, concepto: 0.8, recibo: 0.94 },
};

/** B0020000576 — sin resguardo ninguno. Se cobró en efectivo, pero eso no consta. */
const C: ExtraccionCruda = {
  ...CRUDA,
  factura: { numero: "B0020000576", fecha: "26/08/2026" },
  cliente: { codigo: "CC0890255", nombre: "SALA COMAS CARLOS", nif: "39821791M" },
  vehiculo: { marca: null, modelo: null, matricula: "3950LXL" },
  concepto: "3950LXL · 2 neumáticos Hankook K127 + montaje y equilibrado",
  totales: {
    base_imponible: "281,20",
    iva_importe: "59,05 €",
    iva_porcentaje: "21,00%",
    total: "340,25 €",
    moneda: "EUR",
  },
};

/** El camino entero, como lo recorre el servicio. */
function propuesta(cruda: ExtraccionCruda, reglas = REGLAS) {
  const n = normalizar(cruda);
  return validar(n, clasificar(evidenciaDeCobro(n), reglas, CATALOGO));
}

describe("Caso A · B0020000580 · TPV integrado del ERP", () => {
  it("rellena los cuatro campos de la pantalla", () => {
    const p = propuesta(A);
    expect(p.referencia.valor).toBe("B0020000580");
    expect(p.importeCentimos.valor).toBe(19510);
    expect(p.cliente.valor).toBe("CARLOS GONZALEZ CABALLERO");
    expect(p.concepto.valor).toContain("9655JYL");
    expect(p.referencia.estado).toBe("RELLENAR");
    expect(p.importeCentimos.estado).toBe("RELLENAR");
  });

  it("el resguardo suma lo mismo que la factura", () => {
    const p = propuesta(A);
    expect(p.extra.recibo.importeCentimos).toBe(19510);
    expect(p.importeCuadra).toBe(true);
    expect(p.avisos.find((a) => a.codigo === "PAYMENT_AMOUNT_MISMATCH")).toBeUndefined();
  });

  it("propone la forma configurada para ese comercio, no la del texto", () => {
    // El recibo pone «Visa CaixaBank», que es el producto de la tarjeta del
    // cliente. Lo que identifica al TPV es el comercio, y ahí manda la regla.
    const p = propuesta(A);
    expect(p.formaCobro.formaPago).toBe("CLEARONE");
    expect(p.formaCobro.autoSeleccionar).toBe(true);
  });

  it("de la tarjeta solo se queda con los cuatro últimos", () => {
    expect(propuesta(A).extra.recibo.tarjetaUltimos4).toBe("7394");
  });

  it("el número de operación pierde el punto de la impresora", () => {
    expect(propuesta(A).extra.recibo.numOperacion).toBe("179307");
  });
});

describe("Caso B · B0020000579 · ticket del datáfono", () => {
  it("lee la factura escaneada y cuadra el importe", () => {
    const p = propuesta(B);
    expect(p.referencia.valor).toBe("B0020000579");
    expect(p.importeCentimos.valor).toBe(2293);
    expect(p.cliente.valor).toBe("SAT AGRO CARBONELL");
    expect(p.extra.recibo.importeCentimos).toBe(2293);
    expect(p.importeCuadra).toBe(true);
  });

  it("clasifica por el adquirente del ticket", () => {
    const p = propuesta(B);
    expect(p.formaCobro.formaPago).toBe("CAIXABANK_CARD");
    expect(p.formaCobro.autoSeleccionar).toBe(true);
    expect(p.formaCobro.motivo).toContain("Comercia Global Payments");
  });

  it("los huecos «S/D» del vehículo no se convierten en una marca", () => {
    const p = propuesta(B);
    expect(p.extra.vehiculo.marca).toBe(null);
    expect(p.extra.vehiculo.modelo).toBe(null);
  });
});

describe("Caso C · B0020000576 · sin resguardo", () => {
  it("NO propone efectivo, ni ninguna otra forma", () => {
    /*
     * Es el caso que da sentido al módulo entero. Esta factura se cobró de
     * verdad en efectivo y aun así la aplicación no puede decirlo: lo único
     * que consta es que no hay resguardo.
     */
    const p = propuesta(C);
    expect(p.formaCobro.formaPago).toBe(null);
    expect(p.formaCobro.formaPago).not.toBe("CASH");
    expect(p.formaCobro.autoSeleccionar).toBe(false);
  });

  it("rellena igual el resto de la pantalla: el trabajo se ahorra igual", () => {
    const p = propuesta(C);
    expect(p.referencia.valor).toBe("B0020000576");
    expect(p.importeCentimos.valor).toBe(34025);
    expect(p.cliente.valor).toBe("SALA COMAS CARLOS");
    expect(p.concepto.valor).toContain("Hankook");
  });

  it("avisa de que la ausencia no es una respuesta", () => {
    const aviso = propuesta(C).avisos.find((a) => a.codigo === "SIN_EVIDENCIA_DE_PAGO");
    expect(aviso).toBeDefined();
    expect(aviso!.mensaje).toContain("NO quiere decir que sea efectivo");
  });

  it("no hay nada con lo que comparar, y eso no es «no cuadra»", () => {
    expect(propuesta(C).importeCuadra).toBe(null);
  });

  it("el código de cliente puede llevar letras", () => {
    expect(propuesta(C).extra.cliente.codigo).toBe("CC0890255");
  });
});

describe("cuando factura y resguardo no coinciden", () => {
  const descuadrado: ExtraccionCruda = {
    ...A,
    recibo: { ...A.recibo, importe: "190,00" },
  };

  it("avisa y deja de preseleccionar, por buena que sea la regla", () => {
    const p = propuesta(descuadrado);
    expect(p.importeCuadra).toBe(false);
    expect(p.avisos.some((a) => a.codigo === "PAYMENT_AMOUNT_MISMATCH")).toBe(true);
    // La forma se sigue proponiendo —es información— pero no se marca sola.
    expect(p.formaCobro.formaPago).toBe("CLEARONE");
    expect(p.formaCobro.autoSeleccionar).toBe(false);
  });

  it("un céntimo de diferencia también es una diferencia", () => {
    const p = propuesta({ ...A, recibo: { ...A.recibo, importe: "195,11" } });
    expect(p.importeCuadra).toBe(false);
  });
});

describe("confianza baja", () => {
  it("un campo entre los dos umbrales entra, pero marcado para revisar", () => {
    const p = propuesta({ ...A, confianza: { ...A.confianza, concepto: 0.75 } });
    expect(p.concepto.estado).toBe("REVISAR");
    expect(p.concepto.valor).toContain("9655JYL");
  });

  it("un campo por debajo del umbral no se rellena: vacío cuesta menos de arreglar", () => {
    const p = propuesta({ ...A, confianza: { ...A.confianza, cliente: 0.4 } });
    expect(p.cliente.estado).toBe("VACIO");
    expect(p.cliente.valor).toBe(null);
  });

  it("un recibo mal leído no se preselecciona aunque la regla sea buena", () => {
    const p = propuesta({ ...A, confianza: { ...A.confianza, recibo: 0.5 } });
    expect(p.formaCobro.formaPago).toBe("CLEARONE");
    expect(p.formaCobro.autoSeleccionar).toBe(false);
  });

  it("los umbrales son los documentados", () => {
    expect(UMBRALES.rellenar).toBe(0.9);
    expect(UMBRALES.revisar).toBe(0.7);
  });
});

describe("documentos que no son lo que parecen", () => {
  it("si no es una factura, se avisa y no se preselecciona nada", () => {
    const p = propuesta({ ...A, es_factura: false });
    expect(p.avisos.some((a) => a.codigo === "NO_ES_FACTURA")).toBe(true);
    expect(p.formaCobro.autoSeleccionar).toBe(false);
  });

  it("varias facturas en el mismo PDF: se lee una y se dice", () => {
    const p = propuesta({ ...A, facturas_detectadas: 3 });
    const aviso = p.avisos.find((a) => a.codigo === "VARIAS_FACTURAS");
    expect(aviso?.mensaje).toContain("3 facturas");
    expect(p.formaCobro.autoSeleccionar).toBe(false);
  });

  it("varios resguardos: cuál es de esta factura lo dice una persona", () => {
    const p = propuesta({ ...A, recibo: { ...A.recibo, recibos_detectados: 2 } });
    expect(p.avisos.some((a) => a.codigo === "VARIOS_RECIBOS")).toBe(true);
    expect(p.formaCobro.autoSeleccionar).toBe(false);
  });

  it("una factura sin total no se puede cobrar sola", () => {
    const p = propuesta({ ...A, totales: { ...A.totales, total: null } });
    expect(p.importeCentimos.valor).toBe(null);
    expect(p.avisos.some((a) => a.codigo === "SIN_TOTAL")).toBe(true);
    expect(p.formaCobro.autoSeleccionar).toBe(false);
  });

  it("si la base y el IVA no dan el total, se ha leído algo mal", () => {
    const p = propuesta({ ...A, totales: { ...A.totales, base_imponible: "100,00" } });
    expect(p.avisos.some((a) => a.codigo === "TOTALES_NO_CUADRAN")).toBe(true);
  });

  it("un céntimo de redondeo entre base, IVA y total no es un problema", () => {
    const p = propuesta({ ...A, totales: { ...A.totales, iva_importe: "33,87" } });
    expect(p.avisos.some((a) => a.codigo === "TOTALES_NO_CUADRAN")).toBe(false);
  });
});
