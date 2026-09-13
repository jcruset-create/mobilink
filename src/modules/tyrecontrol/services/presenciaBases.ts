/**
 * Cliente de «Vehículos en bases».
 *
 * Lo último que se supo pasa por el backend y no por Supabase directamente, por
 * dos razones: el barrido habla con el proveedor de telemática con un token que
 * no puede estar en el navegador, y la lectura la resuelve el mismo endpoint
 * que ya deduce de la sesión qué empresa se puede mirar.
 *
 * Ojo con lo que significa `calculadoAt`: es cuándo se barrió, no «ahora». La
 * pantalla lo enseña siempre porque un estado de hace media hora es útil y un
 * estado de hace media hora presentado como actual es engañoso.
 */

import { authHeaders } from "./data";

const API = import.meta.env.PROD ? "" : "http://localhost:4000";
const RAIZ = `${API}/api/tyrecontrol/presencia-bases`;

/** Los cinco estados del barrido. Ver `server/integration-hub/domain/presencia.ts`. */
export type EstadoPresencia =
  | "IN_BASE"
  | "OUTSIDE_BASES"
  | "STALE_POSITION"
  | "NO_POSITION"
  | "INVALID_POSITION";

export const ETIQUETA_PRESENCIA: Record<EstadoPresencia, string> = {
  IN_BASE: "En base",
  OUTSIDE_BASES: "Fuera de las bases",
  STALE_POSITION: "Posición antigua",
  NO_POSITION: "Sin posición",
  INVALID_POSITION: "Posición no válida",
};

export interface VehiculoPresencia {
  vehiculo_id: string;
  estado: EstadoPresencia;
  delegacion_id: string | null;
  es_su_base: boolean | null;
  distancia_m: number | null;
  antiguedad_min: number | null;
  lat: number | null;
  lng: number | null;
  velocidad_kmh: number | null;
  posicion_at: string | null;
  entrada_base_at: string | null;
  proveedor: string | null;
  cuenta: string | null;
  externo: string | null;
  /** `sin_enlace` = falta vincularlo; `proveedor_sin_dato` = el proveedor calla. */
  motivo: "sin_enlace" | "proveedor_sin_dato" | null;
  calculado_at: string;
  vehiculo?: { id: string; matricula: string; numero_unidad?: string | null } | null;
  delegacion?: { id: string; nombre: string } | null;
}

export interface BaseGeo {
  id: string;
  nombre: string;
  lat: number;
  lng: number;
  radioM: number | null;
}

/** Una cuenta de telemática del cliente, tal como está dada de alta en el Hub. */
export interface CuentaTelematicaBases {
  proveedor: string;
  cuenta: string;
  nombre: string | null;
  activa: boolean;
}

export interface PresenciaBases {
  ok: boolean;
  vehiculos: VehiculoPresencia[];
  bases: BaseGeo[];
  /**
   * Cuentas dadas de alta en el Hub. Vacío significa que el barrido no tiene a
   * quién preguntar, que es el motivo más habitual de una pantalla en blanco.
   */
  cuentas: CuentaTelematicaBases[];
  porEstado: Partial<Record<EstadoPresencia, number>>;
  /** Cuándo se barrió lo que se está viendo. `null` si nunca se ha barrido. */
  calculadoAt: string | null;
}

export interface ResultadoBarrido {
  ok: boolean;
  estado: string;
  nota: string;
  porEstado?: Partial<Record<EstadoPresencia, number>>;
  cuentas?: Array<{
    proveedor: string;
    cuenta: string;
    nombre: string | null;
    ok: boolean;
    posiciones: number;
    enlazados: number;
    error?: string;
  }>;
  omitidos?: number;
  vehiculos?: number;
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

/** Lo último barrido. No habla con el proveedor. */
export function listarPresenciaBases(empresaId?: string) {
  const q = empresaId ? `?empresaId=${encodeURIComponent(empresaId)}` : "";
  return pedir<PresenciaBases>(`/${q}`);
}

/** Barre ahora contra el proveedor. Solo administradores. */
export function barrerBases(empresaId?: string) {
  return pedir<ResultadoBarrido>("/barrer", {
    method: "POST",
    body: JSON.stringify(empresaId ? { empresaId } : {}),
  });
}
