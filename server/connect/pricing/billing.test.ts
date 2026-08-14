/**
 * De líneas del motor a documentos facturables.
 *
 * Lo que más se prueba aquí es lo que NO debe pasar: que un documento con una
 * línea sin precio se emita igualmente, que una asistencia sin contraparte se
 * cuele, o que una descripción con punto y coma parta la fila del CSV en dos.
 * Los tres fallan callados y se descubren en la factura.
 */

import { describe, expect, it } from "vitest";
import { agruparEnDocumentos, aCsv, resumen, type FilaFacturable } from "./billing.ts";

const BASE: FilaFacturable = {
  assistanceId: 1, expedientNumber: "EXP-1", externalReference: null,
  serviceType: "tyres", plate: "1234ABC",
  serviceOrderedAtMs: Date.parse("2026-08-14T20:17:00Z"), finishedAtMs: null,
  currency: "EUR",
  clientId: 10, clientName: "Transportes Ebro",
  providerCompanyId: 20, providerName: "Taller Zaragoza",
  lineNumber: 1, kind: "FORFAIT", conceptCode: null, description: "Forfait fin de semana",
  quantity: "1", unit: null,
  saleUnitPrice: "331.0000", saleTotal: "331.0000",
  purchaseUnitPrice: "275.0000", purchaseTotal: "275.0000",
};

const fila = (p: Partial<FilaFacturable>): FilaFacturable => ({ ...BASE, ...p });

describe("Documentos de facturación", () => {
  it("agrupa por contraparte, no por asistencia: una factura lleva el mes entero", () => {
    const docs = agruparEnDocumentos([
      fila({ assistanceId: 1 }),
      fila({ assistanceId: 2 }),
      fila({ assistanceId: 3, clientId: 11, clientName: "Logística Sur" }),
    ], "sale");

    expect(docs).toHaveLength(2);
    expect(docs[0].counterpartyName).toBe("Transportes Ebro");
    expect(docs[0].asistencias).toBe(2);
    expect(docs[0].baseImponible).toBe("662.00");
    expect(docs[1].asistencias).toBe(1);
  });

  it("el lado de compra va a la empresa proveedora, con sus importes", () => {
    const docs = agruparEnDocumentos([fila({}), fila({ assistanceId: 2 })], "purchase");
    expect(docs[0].counterpartyName).toBe("Taller Zaragoza");
    expect(docs[0].counterpartyId).toBe(20);
    expect(docs[0].baseImponible).toBe("550.00");
  });

  it("varias líneas de la misma asistencia suman una vez cada una", () => {
    const docs = agruparEnDocumentos([
      fila({ lineNumber: 1, saleTotal: "331.0000" }),
      fila({ lineNumber: 2, kind: "EXTRA_KM", description: "Km de más",
             quantity: "25", unit: "km", saleUnitPrice: "1.2500", saleTotal: "31.2500" }),
    ], "sale");
    expect(docs[0].asistencias).toBe(1);
    expect(docs[0].lineas).toHaveLength(2);
    expect(docs[0].baseImponible).toBe("362.25");
  });

  it("una línea sin importe bloquea el documento y dice qué servicio es", () => {
    /*
     * Es el neumático sin precio de tarifa. Si el documento se emitiera, la
     * factura iría corta por un importe que nadie ha decidido.
     */
    const docs = agruparEnDocumentos([
      fila({ assistanceId: 7 }),
      fila({ assistanceId: 7, lineNumber: 2, kind: "TIRE", description: "315/80R22.5",
             saleUnitPrice: null, saleTotal: null }),
    ], "sale");

    expect(docs[0].bloqueado).toBe(true);
    expect(docs[0].motivos[0]).toContain("7");
    // Y el total que sí se conoce se sigue viendo: no se oculta el documento
    expect(docs[0].baseImponible).toBe("331.00");
  });

  it("un lado sin contraparte se bloquea: hay importe pero no a quién emitírselo", () => {
    const venta = agruparEnDocumentos([fila({ clientId: null, clientName: null })], "sale");
    expect(venta[0].counterpartyName).toBe("Sin cliente");
    expect(venta[0].bloqueado).toBe(true);
    expect(venta[0].motivos[0]).toContain("sin cliente");

    const compra = agruparEnDocumentos([fila({ providerCompanyId: null, providerName: null })], "purchase");
    expect(compra[0].counterpartyName).toBe("Sin proveedor");
    expect(compra[0].bloqueado).toBe(true);
  });

  it("los documentos salen ordenados por importe: lo gordo primero", () => {
    const docs = agruparEnDocumentos([
      fila({ clientId: 1, clientName: "Pequeño", saleTotal: "100.0000" }),
      fila({ assistanceId: 2, clientId: 2, clientName: "Grande", saleTotal: "900.0000" }),
    ], "sale");
    expect(docs.map((d) => d.counterpartyName)).toEqual(["Grande", "Pequeño"]);
  });

  it("el resumen separa lo que se puede emitir de lo que no", () => {
    const docs = agruparEnDocumentos([
      fila({ clientId: 1, clientName: "Bien", saleTotal: "500.0000" }),
      fila({ assistanceId: 9, clientId: 2, clientName: "Mal", saleTotal: null }),
    ], "sale");

    const r = resumen(docs);
    expect(r.documentos).toBe(2);
    expect(r.emitibles).toBe(1);
    expect(r.bloqueados).toBe(1);
    expect(r.baseImponible).toBe("500.00");
    expect(r.baseImponibleEmitible).toBe("500.00");
  });

  it("los céntimos no se pierden al sumar muchas líneas", () => {
    // 3 × 0,105 = 0,315 → 0,32, no 0,31 ni 0,30
    const docs = agruparEnDocumentos(
      [1, 2, 3].map((n) => fila({ lineNumber: n, saleTotal: "0.1050" })), "sale");
    expect(docs[0].baseImponible).toBe("0.32");
  });
});

describe("CSV para el ERP", () => {
  it("lleva cabecera, punto y coma y una fila por línea", () => {
    const csv = aCsv(agruparEnDocumentos([fila({}), fila({ assistanceId: 2 })], "sale"));
    const filas = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(filas).toHaveLength(3);
    expect(filas[0].startsWith("asistencia;expediente;")).toBe(true);
    expect(filas[1].split(";")[0]).toBe("1");
  });

  it("empieza por BOM, para que Excel no destroce los acentos", () => {
    expect(aCsv([]).startsWith("﻿")).toBe(true);
  });

  it("una descripción con punto y coma no parte la fila en dos", () => {
    const csv = aCsv(agruparEnDocumentos(
      [fila({ description: 'Nocturno 19:00 - 08:00; laborables, con "recargo"' })], "sale"));
    const filas = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(filas).toHaveLength(2);
    expect(filas[1]).toContain('"Nocturno 19:00 - 08:00; laborables, con ""recargo"""');
  });

  it("los importes van con punto decimal y sin símbolo de moneda", () => {
    const csv = aCsv(agruparEnDocumentos([fila({})], "sale"));
    const campos = csv.replace(/^﻿/, "").trim().split("\r\n")[1].split(";");
    expect(campos).toContain("331.0000");
    expect(campos[campos.length - 1]).toBe("EUR");
  });

  it("la fecha del CSV es la de la orden de salida, que es la que fija el forfait", () => {
    const csv = aCsv(agruparEnDocumentos([fila({})], "sale"));
    expect(csv).toContain("2026-08-14");
  });

  it("un importe que no se conoce sale vacío, no como cero", () => {
    // Un 0 en la columna de importe lo cargaría el ERP como un servicio gratis
    const csv = aCsv(agruparEnDocumentos([fila({ saleTotal: null, saleUnitPrice: null })], "sale"));
    const campos = csv.replace(/^﻿/, "").trim().split("\r\n")[1].split(";");
    expect(campos[13]).toBe("");
    expect(campos[14]).toBe("");
  });
});
