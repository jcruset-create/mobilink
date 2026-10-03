/**
 * PDF de contratos y facturas (pdfkit).
 *
 * Se generan SIEMPRE desde una instantánea guardada en la base, nunca leyendo
 * el estado actual del cliente o del trastero: el mismo documento vuelve a
 * salir igual aunque mañana cambie la dirección del cliente.
 */

import PDFDocument from "pdfkit";

const eur = (v: number) => `${v.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fechaEs = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

function aBuffer(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(trozos)));
    doc.on("error", reject);
  });
}

function nuevo(titulo: string, fecha: string): PDFKit.PDFDocument {
  // Fecha de creación fija (la del documento): el PDF no cambia por regenerarlo.
  return new PDFDocument({ size: "A4", margin: 50, info: { Title: titulo, CreationDate: new Date(`${fecha.slice(0, 10)}T00:00:00Z`) } });
}

function bloque(doc: PDFKit.PDFDocument, titulo: string, lineas: (string | null | undefined)[]) {
  doc.moveDown(0.6).font("Helvetica-Bold").fontSize(10).text(titulo);
  doc.font("Helvetica").fontSize(9);
  for (const l of lineas) if (l) doc.text(l);
}

// ── Contrato ────────────────────────────────────────────────────────────────

export type InstantaneaContrato = {
  documentType: "contract" | "annex" | "termination";
  version: number;
  contractNumber: string;
  generatedAt: string;
  termsVersion: string;
  termsText: string;
  annexText?: string | null;
  issuer: { name: string; taxId: string; address: string };
  customer: { name: string; taxId: string; address: string; email: string; phone: string; type: string };
  center: { name: string; address: string };
  unit: { code: string; zone: string; widthCm: number; lengthCm: number; heightCm: number; areaM2: number; volumeM3: number };
  price: { monthlyBase: number; taxRate: number; monthlyGross: number; listMonthlyBase: number | null };
  deposit: { amount: number; taxRate: number };
  extras: { description: string; quantity: number; unitPrice: number; taxRate: number; recurring: boolean }[];
  dates: { start: string; end: string | null; billingDay: number; billingPeriod: string };
  paymentMethod: string | null;
};

export async function pdfContrato(s: InstantaneaContrato): Promise<Buffer> {
  const titulo = s.documentType === "annex" ? `Anexo ${s.version} al contrato ${s.contractNumber}` : `Contrato de alquiler de trastero ${s.contractNumber}`;
  const doc = nuevo(titulo, s.generatedAt);
  const salida = aBuffer(doc);
  doc.font("Helvetica-Bold").fontSize(15).text(titulo);
  doc.font("Helvetica").fontSize(9).fillColor("#555").text(`Versión del documento ${s.version} · condiciones ${s.termsVersion} · generado el ${fechaEs(s.generatedAt)}`);
  doc.fillColor("#000");

  bloque(doc, "Arrendador", [s.issuer.name, `NIF ${s.issuer.taxId}`, s.issuer.address]);
  bloque(doc, "Cliente", [s.customer.name, `NIF ${s.customer.taxId}`, s.customer.address, `${s.customer.email} · ${s.customer.phone}`]);
  bloque(doc, "Trastero", [
    `${s.center.name}${s.center.address ? ` · ${s.center.address}` : ""}`,
    `Trastero ${s.unit.code} · ${s.unit.zone}`,
    `Medidas ${s.unit.widthCm / 100} × ${s.unit.lengthCm / 100} × ${s.unit.heightCm / 100} m · ${s.unit.areaM2} m² · ${s.unit.volumeM3} m³`,
  ]);
  bloque(doc, "Precio", [
    `Cuota mensual: ${eur(s.price.monthlyBase)} + IVA ${s.price.taxRate} % = ${eur(s.price.monthlyGross)}`,
    s.price.listMonthlyBase != null && s.price.listMonthlyBase !== s.price.monthlyBase ? `Precio de tarifa: ${eur(s.price.listMonthlyBase)} (base). Se aplica el precio pactado.` : null,
    `Fianza: ${eur(s.deposit.amount)}${s.deposit.taxRate ? ` + IVA ${s.deposit.taxRate} %` : " (sin IVA)"}`,
    ...s.extras.map((e) => `${e.description}: ${e.quantity} × ${eur(e.unitPrice)} + IVA ${e.taxRate} %${e.recurring ? " al mes" : " (una vez)"}`),
  ]);
  bloque(doc, "Fechas y facturación", [
    `Inicio: ${fechaEs(s.dates.start)} · Fin: ${s.dates.end ? fechaEs(s.dates.end) : "indefinido (renovación mensual)"}`,
    `Facturación mensual, el día ${s.dates.billingDay} de cada mes${s.paymentMethod ? ` · Método de pago: ${s.paymentMethod}` : ""}`,
  ]);
  if (s.annexText) bloque(doc, "Contenido del anexo", [s.annexText]);
  bloque(doc, `Condiciones generales (${s.termsVersion})`, [s.termsText]);
  doc.moveDown(1.2).fontSize(8).fillColor("#555").text("La aceptación de este documento queda registrada electrónicamente (fecha, persona, IP, navegador y huella SHA-256 del documento).");
  doc.end();
  return salida;
}

// ── Factura ─────────────────────────────────────────────────────────────────

export type InstantaneaFactura = {
  invoiceNumber: string;
  kind: string;
  issueDate: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  rectifies: string | null;
  rectificationReason: string | null;
  issuer: { name: string; taxId: string; address: string };
  customer: { name: string; taxId: string; address: string };
  contractNumber: string | null;
  lines: { description: string; quantity: number; unitPrice: number; taxRate: number; subtotal: number; taxAmount: number; total: number }[];
  subtotal: number;
  tax: number;
  total: number;
};

export async function pdfFactura(s: InstantaneaFactura): Promise<Buffer> {
  const titulo = s.kind === "rectifying" ? `Factura rectificativa ${s.invoiceNumber}` : `Factura ${s.invoiceNumber}`;
  const doc = nuevo(titulo, s.issueDate);
  const salida = aBuffer(doc);
  doc.font("Helvetica-Bold").fontSize(16).text(titulo);
  doc.font("Helvetica").fontSize(9).text(`Fecha de emisión: ${fechaEs(s.issueDate)}${s.dueDate ? ` · Vencimiento: ${fechaEs(s.dueDate)}` : ""}`);
  if (s.periodStart) doc.text(`Periodo: ${fechaEs(s.periodStart)} – ${fechaEs(s.periodEnd)}`);
  if (s.contractNumber) doc.text(`Contrato: ${s.contractNumber}`);
  if (s.rectifies) doc.text(`Rectifica la factura ${s.rectifies}${s.rectificationReason ? `: ${s.rectificationReason}` : ""}`);

  bloque(doc, "Emisor", [s.issuer.name, `NIF ${s.issuer.taxId}`, s.issuer.address]);
  bloque(doc, "Cliente", [s.customer.name, `NIF ${s.customer.taxId}`, s.customer.address]);

  doc.moveDown(0.8);
  const x = { desc: 50, cant: 300, precio: 340, iva: 400, base: 440, total: 500 };
  const cab = doc.y;
  doc.font("Helvetica-Bold").fontSize(8);
  doc.text("Concepto", x.desc, cab).text("Cant.", x.cant, cab).text("Precio", x.precio, cab).text("IVA", x.iva, cab).text("Base", x.base, cab).text("Total", x.total, cab);
  doc.font("Helvetica");
  for (const l of s.lines) {
    const y = doc.y + 4;
    doc.text(l.description, x.desc, y, { width: 240 });
    const yFin = doc.y;
    doc.text(String(l.quantity), x.cant, y).text(eur(l.unitPrice), x.precio, y).text(`${l.taxRate} %`, x.iva, y).text(eur(l.subtotal), x.base, y).text(eur(l.total), x.total, y);
    doc.y = Math.max(yFin, doc.y);
  }

  // Desglose por tipo de IVA (requisito de la factura).
  const porTipo = new Map<number, { base: number; cuota: number }>();
  for (const l of s.lines) {
    const t = porTipo.get(l.taxRate) ?? { base: 0, cuota: 0 };
    t.base += l.subtotal;
    t.cuota += l.taxAmount;
    porTipo.set(l.taxRate, t);
  }
  doc.moveDown(1).font("Helvetica-Bold").fontSize(9).text("Desglose de IVA", 50);
  doc.font("Helvetica");
  for (const [tipo, t] of porTipo) doc.text(`IVA ${tipo} %: base ${eur(Math.round(t.base * 100) / 100)} · cuota ${eur(Math.round(t.cuota * 100) / 100)}`);
  doc.moveDown(0.5).font("Helvetica-Bold").fontSize(11).text(`Base imponible: ${eur(s.subtotal)}   IVA: ${eur(s.tax)}   TOTAL: ${eur(s.total)}`);
  doc.end();
  return salida;
}
