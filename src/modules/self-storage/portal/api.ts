/**
 * Cliente de la API del portal (`/api/self-storage/portal`). El servidor
 * filtra todo por el cliente de la sesión: aquí no se pasa nunca un id de
 * cliente, y lo ajeno contesta 404.
 */

import { sessionHeaders } from "../../sessionHeaders";
import type { ContractStatus, InvoiceStatus, PaymentMethod, PaymentStatus } from "../types/enums";

const BASE = "/api/self-storage/portal";

export class ErrorPortal extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const cabeceras = await sessionHeaders(init?.body ? { "Content-Type": "application/json" } : undefined);
  let r: Response;
  try {
    r = await fetch(`${BASE}${ruta}`, { ...init, headers: cabeceras });
  } catch {
    throw new ErrorPortal("No hay conexión con el servidor.", "SIN_CONEXION", 0);
  }
  const texto = await r.text();
  let cuerpo: { error?: string; code?: string } | null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = null;
  }
  if (!r.ok) throw new ErrorPortal(cuerpo?.error ?? `Error ${r.status}`, cuerpo?.code ?? "ERROR", r.status);
  return cuerpo as T;
}

const post = (body: unknown = {}): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export type Yo = { name: string; email: string; status: string; debt: { pendiente: number; vencida: number; facturas: number } };
export type ContratoPortal = {
  id: string;
  contractNumber: string;
  status: ContractStatus;
  unitCode: string;
  centerName: string;
  startDate: string;
  monthlyPriceGross: number;
  pendingAmount: number;
};
export type DocumentoPortal = { id: string; documentType: "contract" | "annex"; version: number; status: "draft" | "final"; acceptedAt: string | null; sha256: string; termsVersion: string | null };
export type FacturaPortal = {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  total: number;
  status: InvoiceStatus;
  kind: string;
  contractNumber: string | null;
  amountPaid: number;
};
export type ContratoPortalDetalle = {
  id: string;
  contractNumber: string;
  status: ContractStatus;
  centerName: string;
  unitCode: string;
  zoneName: string;
  startDate: string;
  endDate: string | null;
  monthlyPrice: number;
  taxRate: number;
  monthlyPriceGross: number;
  depositAmount: number;
  billingDay: number;
  paymentMethod: PaymentMethod | null;
  signedAt: string | null;
  canPayFirstOnline: boolean;
  firstPaymentStatus: string | null;
  items: { description: string; quantity: number; unitPrice: number; taxRate: number; isRecurring: boolean }[];
  documents: DocumentoPortal[];
  invoices: { id: string; invoiceNumber: string | null; status: InvoiceStatus; total: number; issueDate: string | null }[];
};
export type PagoPortal = {
  id: string;
  invoiceNumber: string | null;
  amount: number;
  refundedAmount: number;
  paymentMethod: PaymentMethod;
  status: PaymentStatus;
  paidAt: string | null;
  failureReason: string | null;
  createdAt: string;
};
export type MetodoPortal = { id: string; type: string; brand: string | null; last4: string | null; expMonth: number | null; expYear: number | null; isDefault: boolean };

export const yo = () => pedir<Yo>("/me");
export const contratos = () => pedir<ContratoPortal[]>("/contracts");
export const contrato = (id: string) => pedir<ContratoPortalDetalle>(`/contracts/${id}`);
export const aceptar = (id: string, d: { signerName: string; documentId?: string; accepted: true }) => pedir<ContratoPortalDetalle>(`/contracts/${id}/accept`, post(d));
export const pagarPrimero = (id: string) => pedir<{ url: string }>(`/contracts/${id}/checkout`, post());
export const facturas = () => pedir<FacturaPortal[]>("/invoices");
export const pagarFactura = (id: string) => pedir<{ url: string }>(`/invoices/${id}/pay`, post());
export const pagos = () => pedir<PagoPortal[]>("/payments");
export const metodos = () => pedir<MetodoPortal[]>("/payment-methods");
export const nuevoMetodo = () => pedir<{ url: string }>("/payment-methods/setup", post());

/** PDF protegido (contrato o factura) en una pestaña nueva. */
export async function abrirPdf(ruta: string): Promise<void> {
  const ventana = window.open("", "_blank");
  try {
    const r = await fetch(`${BASE}${ruta}`, { headers: await sessionHeaders() });
    if (!r.ok) throw new ErrorPortal(r.status === 404 ? "Documento no encontrado." : `Error ${r.status}`, "PDF", r.status);
    const url = URL.createObjectURL(await r.blob());
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
export const pdfFactura = (id: string) => abrirPdf(`/invoices/${id}/pdf`);
export const pdfDocumento = (contractId: string, docId: string) => abrirPdf(`/contracts/${contractId}/documents/${docId}/pdf`);
