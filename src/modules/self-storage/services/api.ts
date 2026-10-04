/**
 * Cliente de la API interna de Self Storage (`/api/self-storage/admin`).
 *
 * Único sitio donde el panel hace `fetch`, con la sesión unificada y los
 * errores del backend convertidos en una excepción con código. Misma forma que
 * `recepciones/services/api.ts`.
 *
 * Nada de reglas aquí: ni precios, ni estados, ni permisos. Todo eso lo decide
 * el servidor y llega en las respuestas.
 */

import { sessionHeaders } from "../../sessionHeaders";
import type {
  AccesosContrato,
  AccesoTemporal,
  Dispositivo,
  EventoAcceso,
  MiembroContrato,
  Puerta,
  ResultadoApertura,
  Ajustes,
  Bootstrap,
  CasoImpago,
  Centro,
  ClaveAjuste,
  Cliente,
  CobrosCliente,
  Concepto,
  Contrato,
  ContratoDetalle,
  Dashboard,
  EntradaHistorial,
  Factura,
  FacturaDetalle,
  FichaCliente,
  MetodoPago,
  Pago,
  Trabajo,
  Importacion,
  Plano,
  Telefono,
  TipoTrastero,
  Trastero,
  Zona,
} from "../types";

const BASE = "/api/self-storage/admin";

export class ApiError extends Error {
  code: string;
  status: number;
  detalle: unknown;
  constructor(message: string, code: string, status: number, detalle?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.detalle = detalle;
  }
}

/**
 * Empresa elegida por el superadministrador (sólo a él le hace caso el
 * servidor, que además la valida). Para el resto no se manda nada.
 */
const CLAVE_EMPRESA = "self-storage.empresa";
export function empresaElegida(): string | null {
  try {
    return localStorage.getItem(CLAVE_EMPRESA);
  } catch {
    return null;
  }
}
export function fijarEmpresa(id: string | null): void {
  try {
    if (id) localStorage.setItem(CLAVE_EMPRESA, id);
    else localStorage.removeItem(CLAVE_EMPRESA);
  } catch {
    /* sin almacenamiento: se trabaja en la empresa propia */
  }
}
async function cabecerasSesion(extra?: Record<string, string>): Promise<Record<string, string>> {
  const c = (await sessionHeaders(extra)) as Record<string, string>;
  const empresa = empresaElegida();
  return empresa ? { ...c, "X-SS-Empresa": empresa } : c;
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const cabeceras = await cabecerasSesion(init?.body ? { "Content-Type": "application/json" } : undefined);
  let r: Response;
  try {
    r = await fetch(`${BASE}${ruta}`, { ...init, headers: { ...cabeceras, ...((init?.headers as Record<string, string>) ?? {}) } });
  } catch {
    throw new ApiError("No hay conexión con el servidor.", "SIN_CONEXION", 0);
  }
  const texto = await r.text();
  let cuerpo: { error?: string; code?: string; detalle?: unknown } | null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = null;
  }
  if (!r.ok) throw new ApiError(cuerpo?.error ?? `Error ${r.status}`, cuerpo?.code ?? "ERROR", r.status, cuerpo?.detalle);
  return cuerpo as T;
}

const json = (body: unknown, method = "POST"): RequestInit => ({ method, body: JSON.stringify(body) });

const query = (params: Record<string, string | number | undefined | null>): string => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
};

export const bootstrap = () => pedir<Bootstrap>("/bootstrap");
export const dashboard = (centerId?: string | null) => pedir<Dashboard>(`/dashboard${query({ centerId })}`);

// Centros y zonas
export const centros = () => pedir<Centro[]>("/centers");
export const crearCentro = (d: Partial<Centro>) => pedir<Centro>("/centers", json(d));
export const editarCentro = (id: string, d: Partial<Centro>) => pedir<Centro>(`/centers/${id}`, json(d, "PATCH"));
export const zonas = (centerId: string) => pedir<Zona[]>(`/centers/${centerId}/zones`);
export const crearZona = (centerId: string, d: Partial<Zona>) => pedir<Zona>(`/centers/${centerId}/zones`, json(d));
export const editarZona = (id: string, d: Partial<Zona>) => pedir<Zona>(`/zones/${id}`, json(d, "PATCH"));

// Tipos
export const tipos = (centerId?: string | null) => pedir<TipoTrastero[]>(`/unit-types${query({ centerId })}`);
export const crearTipo = (d: Partial<TipoTrastero>) => pedir<TipoTrastero>("/unit-types", json(d));
export const editarTipo = (id: string, d: Partial<TipoTrastero>) => pedir<TipoTrastero>(`/unit-types/${id}`, json(d, "PATCH"));

// Trasteros
export const trasteros = (f: { centerId?: string; zoneId?: string; status?: string; q?: string }) => pedir<Trastero[]>(`/units${query(f)}`);
export const trastero = (id: string) => pedir<Trastero>(`/units/${id}`);
export const crearTrastero = (d: Record<string, unknown>) => pedir<Trastero>("/units", json(d));
export const editarTrastero = (id: string, d: Record<string, unknown>) => pedir<Trastero>(`/units/${id}`, json(d, "PATCH"));
export const cambiarEstado = (id: string, status: string, reason?: string) => pedir<Trastero>(`/units/${id}/status`, json({ status, reason }));
export const vincularForma = (id: string, shapeId: string | null) => pedir<{ id: string }>(`/units/${id}/shape`, json({ shapeId }, "PUT"));

// Plano
export const plano = (centerId: string) => pedir<Plano>(`/centers/${centerId}/floor-plan`);
export const subirPlano = (centerId: string, svg: string, name?: string) =>
  pedir<{ version: number; shapeIds: string[]; removed: string[]; warnings: string[] }>(`/centers/${centerId}/floor-plan`, json({ svg, name }, "PUT"));

// Clientes
export const clientes = (f: { q?: string; status?: string; limit?: number; offset?: number }) =>
  pedir<{ total: number; items: Cliente[] }>(`/customers${query(f)}`);
export const cliente = (id: string) => pedir<FichaCliente>(`/customers/${id}`);
export const crearCliente = (d: Record<string, unknown>) => pedir<Cliente>("/customers", json(d));
export const editarCliente = (id: string, d: Record<string, unknown>) => pedir<Cliente>(`/customers/${id}`, json(d, "PATCH"));
export const anadirTelefono = (id: string, d: { phone: string; label?: string; allowDoorAccess: boolean }) =>
  pedir<Telefono[]>(`/customers/${id}/phones`, json(d));
export const quitarTelefono = (id: string, phoneId: string) => pedir<Telefono[]>(`/customers/${id}/phones/${phoneId}`, { method: "DELETE" });

// Importación
export const importaciones = (centerId: string) => pedir<Importacion[]>(`/centers/${centerId}/imports`);
export const validarImportacion = (centerId: string, d: { fileName: string; content: string; defaultZoneId?: string | null; measureUnit?: string; createMissingTypes?: boolean }) =>
  pedir<Importacion>(`/centers/${centerId}/imports`, json(d));
export const importacion = (id: string) => pedir<Importacion>(`/imports/${id}`);
export const aplicarImportacion = (id: string) => pedir<Importacion>(`/imports/${id}/apply`, json({}));
export const invitarAlPortal = (id: string) => pedir<{ invited: boolean; email: string }>(`/customers/${id}/portal-invite`, json({}));

/**
 * Abre un PDF protegido (contrato, factura) en una pestaña nueva. No vale un
 * enlace normal: la descarga necesita la cabecera de sesión.
 */
export async function abrirPdf(ruta: string): Promise<void> {
  // La pestaña se abre ANTES del await: si no, el navegador la toma por un
  // popup no solicitado y la bloquea.
  const ventana = window.open("", "_blank");
  try {
    const r = await fetch(`${BASE}${ruta}`, { headers: await cabecerasSesion() });
    if (!r.ok) {
      let msg = `Error ${r.status}`;
      try {
        msg = ((await r.json()) as { error?: string }).error ?? msg;
      } catch {
        /* cuerpo no JSON */
      }
      throw new ApiError(msg, "PDF", r.status);
    }
    const url = URL.createObjectURL(await r.blob());
    if (ventana) ventana.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    ventana?.close();
    throw e;
  }
}

// ── Fase 2 · Contratos ──
export type FiltroContratos = { status?: string; customerId?: string; unitId?: string; centerId?: string; q?: string };
export const contratos = (f: FiltroContratos) => pedir<Contrato[]>(`/contracts${query(f)}`);
export const contrato = (id: string) => pedir<ContratoDetalle>(`/contracts/${id}`);
export const crearContrato = (d: Record<string, unknown>) => pedir<ContratoDetalle>("/contracts", json(d));
export const editarContrato = (id: string, d: Record<string, unknown>) => pedir<ContratoDetalle>(`/contracts/${id}`, json(d, "PATCH"));
export const historialContrato = (id: string) => pedir<EntradaHistorial[]>(`/contracts/${id}/history`);
export const emitirContrato = (id: string) => pedir<ContratoDetalle>(`/contracts/${id}/issue`, json({}));
export const firmarContrato = (id: string, d: { signerName: string; documentId?: string; accepted: true }) =>
  pedir<ContratoDetalle>(`/contracts/${id}/sign`, json(d));
export const checkoutContrato = (id: string) => pedir<{ url: string; sessionId: string }>(`/contracts/${id}/checkout`, json({}));
export const activarContrato = (id: string, reason: string) => pedir<ContratoDetalle>(`/contracts/${id}/activate`, json({ reason }));
export const suspenderContrato = (id: string, reason: "security" | "incident" | "manual", notes: string) =>
  pedir<ContratoDetalle>(`/contracts/${id}/suspend`, json({ reason, notes }));
export const levantarBloqueo = (id: string, blockId: string, reason: string) =>
  pedir<ContratoDetalle>(`/contracts/${id}/blocks/${blockId}/lift`, json({ reason }));
/** Finalizar y cancelar devuelven `warning` si Stripe no ha cancelado la suscripción. */
export const finalizarContrato = (id: string, d: { endDate?: string | null; reason: string }) =>
  pedir<ContratoDetalle & { warning: string | null }>(`/contracts/${id}/terminate`, json(d));
export const cancelarContrato = (id: string, reason: string) => pedir<ContratoDetalle & { warning: string | null }>(`/contracts/${id}/cancel`, json({ reason }));
export const anexoContrato = (id: string, text: string) => pedir<{ documentId: string; version: number; sha256: string }>(`/contracts/${id}/annexes`, json({ text }));
export const pdfDocumento = (id: string, docId: string) => abrirPdf(`/contracts/${id}/documents/${docId}/pdf`);

// ── Fase 2 · Facturas, pagos e impagos ──
export type FiltroFacturas = { customerId?: string; contractId?: string; status?: string; q?: string; limit?: number; offset?: number };
export const facturas = (f: FiltroFacturas) => pedir<{ total: number; items: Factura[] }>(`/invoices${query(f)}`);
export const factura = (id: string) => pedir<FacturaDetalle>(`/invoices/${id}`);
export const crearFactura = (d: Record<string, unknown>) => pedir<FacturaDetalle>("/invoices", json(d));
export const emitirFactura = (id: string) => pedir<FacturaDetalle>(`/invoices/${id}/issue`, json({}));
export const borrarFactura = (id: string) => pedir<void>(`/invoices/${id}`, { method: "DELETE" });
export const rectificarFactura = (id: string, reason: string) => pedir<{ id: string; numero: string }>(`/invoices/${id}/rectify`, json({ reason }));
export const enlacePago = (id: string) => pedir<{ url: string }>(`/invoices/${id}/pay-link`, json({}));
export const pdfFactura = (id: string) => abrirPdf(`/invoices/${id}/pdf`);

export const pagos = (f: { customerId?: string; contractId?: string; invoiceId?: string; status?: string }) => pedir<Pago[]>(`/payments${query(f)}`);
export const registrarPago = (d: { invoiceId: string; paymentMethod: "bank_transfer" | "cash"; paidAt?: string; notes?: string }) =>
  pedir<{ id: string }>("/payments/manual", json(d));
export const cobrosCliente = (id: string) => pedir<CobrosCliente>(`/customers/${id}/billing`);
export const metodosCliente = (id: string) => pedir<MetodoPago[]>(`/customers/${id}/payment-methods`);

export const impagos = (status?: string) => pedir<CasoImpago[]>(`/dunning${query({ status })}`);

// ── Fase 2 · Catálogo y configuración ──
export const conceptos = () => pedir<Concepto[]>("/billing-items");
export const crearConcepto = (d: Record<string, unknown>) => pedir<Concepto>("/billing-items", json(d));
export const editarConcepto = (id: string, d: Record<string, unknown>) => pedir<Concepto>(`/billing-items/${id}`, json(d, "PATCH"));

export const ajustes = (centerId?: string | null) => pedir<Ajustes>(`/settings${query({ centerId })}`);
export const guardarAjuste = <K extends ClaveAjuste>(key: K, value: Ajustes[K]["value"], centerId?: string | null) =>
  pedir<{ key: K; value: Ajustes[K]["value"] }>(`/settings/${encodeURIComponent(key)}`, json({ value, centerId: centerId ?? null }, "PUT"));
export const ejecutarTrabajo = (name: Trabajo) => pedir<unknown>(`/jobs/${name}/run`, json({}));

// ── Fase 3 · Accesos físicos ──
export const dispositivos = (centerId?: string | null) => pedir<Dispositivo[]>(`/devices${query({ centerId })}`);
export const crearDispositivo = (d: Record<string, unknown>) => pedir<Dispositivo>("/devices", json(d));
export const editarDispositivo = (id: string, d: Record<string, unknown>) => pedir<Dispositivo>(`/devices/${id}`, json(d, "PATCH"));
export const probarDispositivo = (id: string) => pedir<{ ok: boolean; latencyMs: number; code: string | null; message: string | null }>(`/devices/${id}/test`, json({}));
export const sincronizarDispositivo = (id: string) => pedir<Dispositivo>(`/devices/${id}/sync`, json({}));
export const crearSalida = (deviceId: string, d: Record<string, unknown>) => pedir<Dispositivo>(`/devices/${deviceId}/outputs`, json(d));
export const editarSalida = (id: string, d: Record<string, unknown>) => pedir<Dispositivo>(`/outputs/${id}`, json(d, "PATCH"));

export const puertas = (centerId?: string | null) => pedir<Puerta[]>(`/doors${query({ centerId })}`);
export const crearPuerta = (d: Record<string, unknown>) => pedir<Puerta>("/doors", json(d));
export const editarPuerta = (id: string, d: Record<string, unknown>) => pedir<Puerta>(`/doors/${id}`, json(d, "PATCH"));
export const abrirPuerta = (id: string, reason?: string) => pedir<ResultadoApertura>(`/doors/${id}/open`, json({ reason: reason || null }));

export const eventosAcceso = (f: { doorId?: string; customerId?: string; contractId?: string; centerId?: string; decision?: string; method?: string; limit?: number }) =>
  pedir<EventoAcceso[]>(`/access-events${query(f)}`);

export const miembros = (contractId: string) => pedir<MiembroContrato[]>(`/contracts/${contractId}/members`);
export const crearMiembro = (contractId: string, d: Record<string, unknown>) => pedir<MiembroContrato[]>(`/contracts/${contractId}/members`, json(d));
export const editarMiembro = (contractId: string, id: string, d: Record<string, unknown>) => pedir<MiembroContrato[]>(`/contracts/${contractId}/members/${id}`, json(d, "PATCH"));
export const invitarMiembro = (contractId: string, id: string) => pedir<{ invited: boolean; email: string }>(`/contracts/${contractId}/members/${id}/portal-invite`, json({}));

export const accesosContrato = (contractId: string) => pedir<AccesosContrato>(`/contracts/${contractId}/access`);
export const concederPermiso = (contractId: string, d: Record<string, unknown>) => pedir<AccesosContrato>(`/contracts/${contractId}/permissions`, json(d));
export const revocarPermiso = (contractId: string, permId: string) => pedir<AccesosContrato>(`/contracts/${contractId}/permissions/${permId}`, { method: "DELETE" });

export const temporales = (f: { contractId?: string; centerId?: string; active?: string }) => pedir<AccesoTemporal[]>(`/temporary-accesses${query(f)}`);
export const crearTemporal = (d: Record<string, unknown>) => pedir<AccesoTemporal>("/temporary-accesses", json(d));
export const revocarTemporal = (id: string) => pedir<{ id: string }>(`/temporary-accesses/${id}/revoke`, json({}));
