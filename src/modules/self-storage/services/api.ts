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
  Bootstrap,
  Centro,
  Cliente,
  Dashboard,
  FichaCliente,
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

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const cabeceras = await sessionHeaders(init?.body ? { "Content-Type": "application/json" } : undefined);
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
export const validarImportacion = (centerId: string, d: { fileName: string; content: string; defaultZoneId?: string | null; measureUnit?: string; defaultTaxRate?: number }) =>
  pedir<Importacion>(`/centers/${centerId}/imports`, json(d));
export const importacion = (id: string) => pedir<Importacion>(`/imports/${id}`);
export const aplicarImportacion = (id: string) => pedir<Importacion>(`/imports/${id}/apply`, json({}));
