/**
 * De las líneas del motor a los documentos que se facturan.
 *
 * El motor deja, por cada asistencia, una fila por etapa y sus líneas con
 * compra y venta. Facturar es agrupar eso en documentos: uno por contraparte y
 * lado, con sus líneas y su base imponible.
 *
 * Cinco criterios recorren el módulo:
 *
 *  1. **Solo se factura la etapa `final`.** Una estimación no es facturable y
 *     un forfait comprometido tampoco: el servicio puede no haber acabado, o
 *     haber acabado de otra manera. Lo que se cobra es el cierre.
 *
 *  2. **Lo que falta se ve, no se omite.** Una asistencia terminada sin tarifa
 *     de cierre no desaparece del listado: sale aparte, como pendiente. Omitir
 *     en silencio lo que no cuadra es la forma tranquila de dejar de facturar
 *     servicios sin que nadie se entere.
 *
 *  3. **Una línea sin importe bloquea su documento.** Si el neumático no tiene
 *     precio de venta, la factura al cliente iría corta por un importe que
 *     nadie ha decidido. El documento sale marcado como bloqueado y con el
 *     motivo, no se emite a medias.
 *
 *  4. **Dos lados, dos documentos, dos empresas.** La venta va al cliente y la
 *     compra a la empresa proveedora. No son dos vistas del mismo papel.
 *
 *  5. **Los importes son la BASE IMPONIBLE.** El tarifario dice "IVA no
 *     incluido" y aquí no se inventa ningún tipo impositivo: el impuesto lo
 *     pone el ERP, que es quien sabe el régimen de cada contraparte.
 */

import { formatear, redondearCentimos, type Dinero } from "./money.ts";

export type LadoFacturacion = "sale" | "purchase";

/** Una línea del motor, tal y como sale de la base. */
export interface FilaFacturable {
  assistanceId: number;
  expedientNumber: string | null;
  externalReference: string | null;
  serviceType: string;
  plate: string | null;
  serviceOrderedAtMs: number | null;
  finishedAtMs: number | null;
  currency: string;
  clientId: number | null;
  clientName: string | null;
  providerCompanyId: number | null;
  providerName: string | null;
  lineNumber: number;
  kind: string;
  conceptCode: string | null;
  description: string;
  quantity: string | number | null;
  unit: string | null;
  saleUnitPrice: string | null;
  saleTotal: string | null;
  purchaseUnitPrice: string | null;
  purchaseTotal: string | null;
  exportedAtMs?: number | null;
}

export interface LineaFactura {
  assistanceId: number;
  expedientNumber: string | null;
  externalReference: string | null;
  serviceType: string;
  plate: string | null;
  fecha: number | null;
  lineNumber: number;
  kind: string;
  conceptCode: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  /** Nulo = el motor no supo ponerle precio por este lado. */
  unitPrice: string | null;
  total: string | null;
}

export interface DocumentoFactura {
  lado: LadoFacturacion;
  counterpartyId: number | null;
  counterpartyName: string;
  currency: string;
  lineas: LineaFactura[];
  asistencias: number;
  /** Suma de las líneas con importe, como texto de dos decimales. */
  baseImponible: string;
  /** true = no debe emitirse todavía. */
  bloqueado: boolean;
  motivos: string[];
  yaExportadas: number;
}

const aNumero = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Importe de texto a Dinero, o null si no lo hay. */
function importe(v: string | null): Dinero | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? BigInt(Math.round(n * 10_000)) : null;
}

/**
 * Agrupa las líneas en documentos.
 *
 * La clave es la contraparte, no la asistencia: una factura al cliente lleva
 * todos sus servicios del periodo, que es como se factura de verdad. Las
 * asistencias sin contraparte por ese lado —una venta sin cliente, una compra
 * sin proveedor— se agrupan aparte y salen bloqueadas: hay importe pero no hay
 * a quién emitírselo.
 */
export function agruparEnDocumentos(
  filas: FilaFacturable[],
  lado: LadoFacturacion,
): DocumentoFactura[] {
  const porContraparte = new Map<string, DocumentoFactura>();

  for (const f of filas) {
    const id = lado === "sale" ? f.clientId : f.providerCompanyId;
    const nombre = (lado === "sale" ? f.clientName : f.providerName) ?? "";
    const clave = id != null ? String(id) : `sin:${nombre}`;

    let doc = porContraparte.get(clave);
    if (!doc) {
      doc = {
        lado, counterpartyId: id,
        counterpartyName: nombre || (lado === "sale" ? "Sin cliente" : "Sin proveedor"),
        currency: f.currency ?? "EUR",
        lineas: [], asistencias: 0, baseImponible: "0.00",
        bloqueado: false, motivos: [], yaExportadas: 0,
      };
      porContraparte.set(clave, doc);
    }

    doc.lineas.push({
      assistanceId: f.assistanceId,
      expedientNumber: f.expedientNumber,
      externalReference: f.externalReference,
      serviceType: f.serviceType,
      plate: f.plate,
      fecha: f.serviceOrderedAtMs ?? f.finishedAtMs ?? null,
      lineNumber: f.lineNumber,
      kind: f.kind,
      conceptCode: f.conceptCode,
      description: f.description,
      quantity: aNumero(f.quantity),
      unit: f.unit,
      unitPrice: lado === "sale" ? f.saleUnitPrice : f.purchaseUnitPrice,
      total: lado === "sale" ? f.saleTotal : f.purchaseTotal,
    });

    if (id == null) marcar(doc, lado === "sale"
      ? "Hay servicios sin cliente asignado: no hay a quién facturarlos"
      : "Hay servicios sin empresa proveedora: no hay quién los facture");
  }

  for (const doc of porContraparte.values()) {
    const asistencias = new Set(doc.lineas.map((l) => l.assistanceId));
    doc.asistencias = asistencias.size;

    let total = 0n;
    const sinPrecio = new Set<number>();
    for (const l of doc.lineas) {
      const v = importe(l.total);
      if (v == null) sinPrecio.add(l.assistanceId);
      else total += v;
    }
    doc.baseImponible = formatear(redondearCentimos(total), 2);

    if (sinPrecio.size > 0) {
      marcar(doc, `${sinPrecio.size} servicio(s) con alguna línea sin importe: ` +
        `${[...sinPrecio].slice(0, 5).join(", ")}${sinPrecio.size > 5 ? "…" : ""}`);
    }
  }

  return [...porContraparte.values()]
    .sort((a, b) => Number(b.baseImponible) - Number(a.baseImponible));
}

function marcar(doc: DocumentoFactura, motivo: string): void {
  doc.bloqueado = true;
  if (!doc.motivos.includes(motivo)) doc.motivos.push(motivo);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * CSV para el ERP.
 *
 * Separador de punto y coma y BOM, que es lo que espera Excel en español; si
 * se usa la coma, el propio Excel parte por la coma decimal y descuadra el
 * fichero. Los importes van con PUNTO decimal porque el destino es un ERP, no
 * una persona: quien lo lea con Excel verá el punto, y es preferible eso a
 * mandar un número que el importador tenga que adivinar.
 */
export const CABECERA_CSV = [
  "asistencia", "expediente", "referencia", "fecha", "matricula", "servicio",
  "contraparte", "linea", "concepto", "codigo", "descripcion",
  "cantidad", "unidad", "precio_unitario", "base_imponible", "moneda",
] as const;

export function aCsv(documentos: DocumentoFactura[]): string {
  const filas: string[] = [CABECERA_CSV.join(";")];

  for (const doc of documentos) {
    for (const l of doc.lineas) {
      filas.push([
        l.assistanceId,
        l.expedientNumber ?? "",
        l.externalReference ?? "",
        l.fecha ? new Date(l.fecha).toISOString().slice(0, 10) : "",
        l.plate ?? "",
        l.serviceType,
        doc.counterpartyName,
        l.lineNumber,
        l.kind,
        l.conceptCode ?? "",
        l.description,
        l.quantity,
        l.unit ?? "",
        l.unitPrice ?? "",
        l.total ?? "",
        doc.currency,
      ].map(campo).join(";"));
    }
  }

  // BOM para que Excel reconozca el UTF-8 y no destroce los acentos
  return `﻿${filas.join("\r\n")}\r\n`;
}

/**
 * Escapa un campo de CSV.
 *
 * Las descripciones vienen del tarifario y llevan puntos y comas y acentos;
 * una regla llamada "Nocturno 19:00 - 08:00; laborables" partiría la fila en
 * dos sin esto.
 */
function campo(v: unknown): string {
  const s = String(v ?? "");
  if (!/[;"\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/** Resumen para la pantalla: lo que se puede emitir y lo que no. */
export function resumen(documentos: DocumentoFactura[]) {
  const emitibles = documentos.filter((d) => !d.bloqueado);
  const suma = (ds: DocumentoFactura[]) =>
    formatear(redondearCentimos(ds.reduce((t, d) => t + (importe(d.baseImponible) ?? 0n), 0n)), 2);

  return {
    documentos: documentos.length,
    emitibles: emitibles.length,
    bloqueados: documentos.length - emitibles.length,
    asistencias: documentos.reduce((n, d) => n + d.asistencias, 0),
    baseImponible: suma(documentos),
    baseImponibleEmitible: suma(emitibles),
  };
}
