/**
 * Cliente de los kilómetros mensuales.
 *
 * Todo por el backend: los km salen de nuestra base, y la sincronización
 * manual la hace el servidor con la credencial del cliente, que aquí no entra.
 */

import { authHeaders } from "./data";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";
const RAIZ = `${API}/api/tyrecontrol/kilometraje-mensual`;

export interface MesKilometraje {
  year: number;
  month: number;
  km: number | null;
  estado: "ok" | "empty" | "error";
  cerrado: boolean;
  odometroInicial: number | null;
  odometroFinal: number | null;
  sincronizadoMs: number;
  error: string | null;
}

export interface KilometrajeVehiculo {
  vehiculoId: string;
  empresaId: string;
  /** La empresa tiene alguna cuenta de telemática. Sin ella, no hay bloque. */
  hayTelemetria: boolean;
  meses: MesKilometraje[];
  mesActual: MesKilometraje | null;
  anioActual: { year: number; km: number; mesesConDato: number };
  mediaMensual: { km: number | null; meses: number };
}

export interface ResumenCuentaMensual {
  connectorKey: string;
  accountKey: string;
  nombre: string | null;
  zonaHoraria: string;
  unidadesPorPeticion: number;
  inicioMs: number;
  finMs: number;
  meses: string[];
  vehiculosEnlazados: number;
  vehiculosProcesados: number;
  vehiculosConKm: number;
  vehiculosSinDatos: number;
  lotes: number;
  peticiones: number;
  errores: number;
  muestraErrores: string[];
  kmTotales: number;
  abandonada?: string;
}

export interface EstadoCuenta {
  connectorKey: string;
  accountKey: string;
  nombre: string | null;
  ultimaMs: number | null;
  status: string | null;
  detalle: Partial<ResumenCuentaMensual> | null;
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const r = await fetch(`${RAIZ}${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(opciones.headers ?? {}) },
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((cuerpo as any)?.error ?? `Error ${r.status}`);
  return cuerpo as T;
}

export const kilometrajeDeVehiculo = (vehiculoId: string) =>
  pedir<KilometrajeVehiculo>(`/vehiculo/${encodeURIComponent(vehiculoId)}`);

export const estadoKilometraje = (empresaId?: string) =>
  pedir<{ empresaId: string; cuentas: EstadoCuenta[] }>(`/estado${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

export const sincronizarKilometraje = (b: {
  empresaId?: string; connectorKey: string; accountKey: string;
  desde?: { year: number; month: number }; hasta?: { year: number; month: number };
  vehiculoIds?: string[]; forzar?: boolean;
}) => pedir<{ correlationId: string; cuentas: ResumenCuentaMensual[] }>("/sincronizar", { method: "POST", body: JSON.stringify(b) });

/** «sep 2026». */
export function nombreDeMes(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("es-ES", { month: "short", year: "numeric", timeZone: "UTC" });
}
