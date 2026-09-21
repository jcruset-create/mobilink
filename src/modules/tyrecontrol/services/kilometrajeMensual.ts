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
  ritmo?: { maximo: number; ventanaMs: number };
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

/**
 * Una tarea de relleno lento: una unidad cada veinte segundos hasta terminar.
 * El servidor la lleva; aquí solo se arranca, se mira y se para.
 */
export interface TareaRelleno {
  empresaId: string;
  connectorKey: string;
  accountKey: string;
  meses: string[];
  intervaloSegundos: number;
  maxIntentos: number;
  forzar: boolean;
  estado: "en_curso" | "terminada" | "parada" | "abandonada";
  iniciadaMs: number;
  ultimoTickMs: number | null;
  total: number;
  hechos: number;
  sinDatos: number;
  fallidos: number;
  pendientes: number;
  minutosRestantes: number;
  restanteEnPalabras: string;
  ultimo: { vehiculo: string; mes: string; resultado: string } | null;
  muestraErrores: string[];
  nota?: string;
}

export const rellenarKilometraje = (b: {
  empresaId?: string; connectorKey: string; accountKey: string;
  desde: { year: number; month: number }; hasta: { year: number; month: number };
  intervaloSegundos?: number; forzar?: boolean;
}) => pedir<{ tarea: TareaRelleno }>("/relleno", { method: "POST", body: JSON.stringify(b) });

export const estadoRelleno = (empresaId?: string) =>
  pedir<{ empresaId: string; tareas: TareaRelleno[] }>(`/relleno${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

export const pararRelleno = (b: { empresaId?: string; connectorKey: string; accountKey: string }) =>
  pedir<{ tarea: TareaRelleno }>("/relleno/parar", { method: "POST", body: JSON.stringify(b) });

/** El relleno del kilometraje del histórico de revisiones. */
export interface TareaRevisiones {
  empresaId: string;
  intervaloSegundos: number;
  estado: "en_curso" | "terminada" | "parada" | "abandonada";
  iniciadaMs: number;
  ultimoTickMs: number | null;
  totalAlEmpezar: number;
  pendientes: number;
  escritas: number;
  sinLectura: number;
  rechazadas: number;
  minutosRestantes: number;
  restanteEnPalabras: string;
  ultima: { fecha: string; resultado: string } | null;
  muestraMotivos: string[];
  nota?: string;
}

export const rellenarRevisiones = (b: { empresaId?: string; intervaloSegundos?: number }) =>
  pedir<{ tarea: TareaRevisiones }>("/revisiones", { method: "POST", body: JSON.stringify(b) });

export const estadoRevisiones = (empresaId?: string) =>
  pedir<{ empresaId: string; tarea: TareaRevisiones | null }>(`/revisiones${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

export const pararRevisiones = (b: { empresaId?: string }) =>
  pedir<{ tarea: TareaRevisiones }>("/revisiones/parar", { method: "POST", body: JSON.stringify(b) });

/** Una fila del ranking de kilómetros de la flota. */
export interface VehiculoDelRanking {
  vehiculoId: string;
  matricula: string | null;
  numeroUnidad: string | null;
  kmAnual: number | null;
  /** Sobre cuántos meses completos está hecha la cifra. Va SIEMPRE al lado. */
  meses: number;
  kmAnioActual: number;
  mesesDelAnio: number;
  kmMesActual: number | null;
  mesesSinDato: number;
  mesesConError: number;
}

export interface Ranking {
  empresaId: string;
  vehiculos: VehiculoDelRanking[];
  /** Activos sin ningún mes con dato: casi siempre conciliación pendiente. */
  sinDatos: Array<{ vehiculoId: string; matricula: string | null; numeroUnidad: string | null }>;
  totales: { vehiculosConDato: number; kmAnualTotal: number; kmAnualMedio: number | null };
}

export const rankingKilometraje = (empresaId?: string) =>
  pedir<Ranking>(`/ranking${empresaId ? `?empresa=${encodeURIComponent(empresaId)}` : ""}`);

/** «sep 2026». */
export function nombreDeMes(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("es-ES", { month: "short", year: "numeric", timeZone: "UTC" });
}
