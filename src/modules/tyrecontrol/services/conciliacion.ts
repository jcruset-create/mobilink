/**
 * Cliente de la conciliación telemática.
 *
 * Todo pasa por el backend, nunca por Supabase directamente: la conciliación
 * habla con el proveedor externo y eso necesita un token que no puede estar en
 * el navegador. Aquí solo viaja la sesión del usuario, y el servidor deduce de
 * ella qué empresa se puede tocar.
 */

import { authHeaders } from "./data";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";
const RAIZ = `${API}/api/tyrecontrol/conciliacion`;

export type EstadoSincronizacion = "complete" | "incomplete" | "error";

export interface CuentaTelematica {
  connectorKey: string;
  accountKey: string;
  nombre?: string | null;
}

export interface VehiculoInterno {
  id: string;
  matricula: string;
  numeroUnidad?: string | null;
  bastidor?: string | null;
  marca?: string | null;
  modelo?: string | null;
  activo: boolean;
  neumaticosMontados: number;
}

export interface VehiculoProveedor {
  providerVehicleId: string;
  name?: string;
  plate?: string;
  vin?: string;
  brand?: string;
  model?: string;
  active?: boolean;
}

export interface ResultadoCuenta {
  connectorKey: string;
  accountKey: string;
  ok: boolean;
  vehiculos: number;
  error?: string;
}

export interface Resumen {
  status: EstadoSincronizacion;
  startedAt: string;
  completedAt: string;
  cuentas: ResultadoCuenta[];
  providerVehicleCount: number;
  tyrecontrolVehicleCount: number;
  tyrecontrolUnknownCount: number;
  linkedCount: number;
  providerOnlyCount: number;
  tyrecontrolOnlyCount: number;
  discrepancyCount: number;
  bajasPermitidas: boolean;
}

export interface Conciliacion {
  empresaId: string;
  resumen: Resumen;
  enlazados: Array<{
    interno: VehiculoInterno;
    externo: VehiculoProveedor;
    metodo?: string | null;
    ultimaVezVistoMs?: number | null;
  }>;
  soloProveedor: Array<{ externo: VehiculoProveedor; propuesta?: VehiculoInterno }>;
  soloTyreControl: Array<{
    interno: VehiculoInterno;
    ultimaVezVistoMs?: number | null;
    externoAnterior?: string | null;
  }>;
  discrepancias: Array<{
    motivo: string;
    detalle: string;
    interno?: VehiculoInterno;
    candidatos?: VehiculoInterno[];
    externo?: VehiculoProveedor;
    enlace?: { mobilinkId: string; externalCode: string };
  }>;
  /** Vehículos sobre los que la conciliación no dice nada. No es un cuadrante. */
  noEvaluados: VehiculoInterno[];
  ignorados: Array<{ externalVehicleId: string; motivo?: string | null; desde: number }>;
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const r = await fetch(`${RAIZ}${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      ...(await authHeaders()),
      ...(opciones.headers ?? {}),
    },
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((cuerpo as any)?.error ?? `Error ${r.status}`);
  return cuerpo as T;
}

export function listarCuentas(empresaId?: string) {
  const q = empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : "";
  return pedir<{ empresaId: string; cuentas: CuentaTelematica[] }>(`/cuentas${q}`);
}

export function conciliar(params: { empresaId?: string; connectorKey: string; accountKey: string }) {
  const q = new URLSearchParams({ connector: params.connectorKey, cuenta: params.accountKey });
  if (params.empresaId) q.set("empresa", params.empresaId);
  return pedir<Conciliacion>(`/?${q.toString()}`);
}

const post = <T,>(ruta: string, cuerpo: unknown) =>
  pedir<T>(ruta, { method: "POST", body: JSON.stringify(cuerpo) });

export const vincular = (b: Record<string, unknown>) => post<{ ok: true }>("/vincular", b);
export const desvincular = (b: Record<string, unknown>) => post<{ ok: true }>("/desvincular", b);
export const vincularLote = (b: Record<string, unknown>) =>
  post<{
    ok: true;
    enlazados: number;
    fallidos: Array<{ tcVehicleId: string; externalVehicleId: string; error: string }>;
  }>("/vincular-lote", b);
export const ignorar = (b: Record<string, unknown>) => post<{ ok: true }>("/ignorar", b);
export const dejarDeIgnorar = (b: Record<string, unknown>) => post<{ ok: true }>("/dejar-de-ignorar", b);
export const crearVehiculo = (b: Record<string, unknown>) =>
  post<{ ok: true; vehiculo: { id: string; matricula: string } }>("/crear-vehiculo", b);
export const darDeBaja = (b: Record<string, unknown>) =>
  post<{ ok: true; matricula: string; neumaticosMontados: number; aviso: string | null }>("/dar-de-baja", b);
