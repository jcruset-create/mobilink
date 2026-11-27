/**
 * Cliente de «Por dónde rueda»: km por tipo de vía de los vehículos marcados.
 * Los datos los calcula el servidor cada mañana; aquí solo se leen.
 */

import { authHeaders } from "./data";
import { supabase } from "./supabase";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";
const RAIZ = `${API}/api/tyrecontrol/por-donde-rueda`;

export const TIPOS_VIA = ["autopista", "autovia", "nacional", "autonomica", "local", "urbana", "sin_via"] as const;
export type TipoVia = (typeof TIPOS_VIA)[number];

export const NOMBRE_TIPO: Record<TipoVia, string> = {
  autopista: "Autopista", autovia: "Autovía", nacional: "Nacional", autonomica: "Autonómica / comarcal",
  local: "Local / provincial", urbana: "Urbana", sin_via: "Sin vía (cocheras, GPS)",
};
/** Colores fijos por tipo: los mismos en la barra, la tabla y el mapa. */
export const COLOR_TIPO: Record<TipoVia, string> = {
  autopista: "#2563eb", autovia: "#0ea5e9", nacional: "#f59e0b", autonomica: "#10b981",
  local: "#a3a3a3", urbana: "#e11d48", sin_via: "#475569",
};

export interface Suma { km: number; segundos: number }
export type PorTipo = Record<TipoVia, Suma>;

export interface DiaAnalizado {
  fecha: string;
  estado: "ok" | "sin_puntos" | "error";
  puntos: number;
  km_puntos: number | null;
  km_resumen: number | null;
  km_sin_via: number | null;
  error: string | null;
}

export interface PorDondeRuedaVehiculo {
  vehiculoId: string;
  activo: boolean;
  puedeAdministrar: boolean;
  ultimosDias: DiaAnalizado[];
  meses: { mes: string; porTipo: PorTipo }[];
  total: PorTipo;
  carreteras: { tipo: TipoVia; ref: string; km: number; segundos: number }[];
}

export interface TramoMapa { tipo: TipoVia; ref: string | null; nombre: string | null; puntos: [number, number][] }
export interface AnalisisDia {
  estado: "ok" | "sin_puntos" | "error" | "mapa_pendiente";
  teselasCargadas?: number;
  teselasPendientes?: number;
  puntos: number;
  kmResumen: number | null;
  resumen: { kmPuntos: number; kmSinVia: number; filas: { tipo: TipoVia; ref: string; km: number; segundos: number }[] } | null;
  error: string | null;
  tramos: TramoMapa[];
}

export interface VehiculoFlotaVias {
  vehiculoId: string;
  matricula?: string | null;
  numero_unidad?: string | null;
  activo: boolean;
  dias: number;
  km: number;
  porTipo: PorTipo | null;
  pctUrbana: number | null;
  /** Por qué no hay datos (null si los hay). */
  estado?: { tono: "info" | "aviso" | "error"; texto: string } | null;
}

/** Cómo va el trabajo de cada mañana. */
export interface TrabajoVias {
  ultimaVuelta: { at: string; resumen: string; esperandoMapa: boolean } | null;
  ventana: { desde: number; hasta: number };
  mapa: { teselas: number; ultimaCarga: string | null };
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const r = await fetch(`${RAIZ}${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(await authHeaders()), ...(opciones.headers ?? {}) },
  });
  const cuerpo = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((cuerpo as { error?: string })?.error ?? `Error ${r.status}`);
  return cuerpo as T;
}

export const porDondeRuedaVehiculo = (vehiculoId: string) =>
  pedir<PorDondeRuedaVehiculo>(`/vehiculo/${encodeURIComponent(vehiculoId)}`);

export const analizarDiaVias = (vehiculoId: string, fecha: string) =>
  pedir<AnalisisDia>(`/vehiculo/${encodeURIComponent(vehiculoId)}/analizar`, { method: "POST", body: JSON.stringify({ fecha }) });

export const porDondeRuedanFlota = (p: { empresaId?: string; desde: string; hasta: string }) =>
  pedir<{ empresaId: string; desde: string; hasta: string; vehiculos: VehiculoFlotaVias[]; trabajo?: TrabajoVias }>(
    `/flota?${new URLSearchParams({ ...(p.empresaId ? { empresaId: p.empresaId } : {}), desde: p.desde, hasta: p.hasta })}`,
  );

/** La casilla de la ficha. La base comprueba que sea administrador. */
export async function activarAnalisisVias(vehiculoId: string, activo: boolean): Promise<void> {
  const { error } = await supabase.rpc("tc_analisis_vias_activar", { p_vehiculo: vehiculoId, p_activo: activo });
  if (error) throw new Error(error.message);
}

/** km/h medios de una suma; null si no hay tiempo. */
export const velocidadMedia = (s: Suma) => (s.segundos > 60 ? Math.round(s.km / (s.segundos / 3600)) : null);
export const kmDe = (p: PorTipo) => TIPOS_VIA.reduce((s, t) => s + p[t].km, 0);
