// Servicio del módulo Informes: envuelve las RPC de agregación de Postgres.
// Toda la lógica pesada vive en la base de datos (ver migración
// tyrecontrol_informes_kpis.sql); aquí solo tipamos y llamamos.
import { supabase } from "./supabase";
import { authHeaders } from "./data";
import type {
  FiltrosInformes, KpisInformes, EstadoFlota, DimensionTotal, MarcaMedidaTotal, ProfundidadDistribucion, Alerta,
  EconomicoInformes, RankingVehiculo, RankingMarca, CosteKmNeumatico, DesgasteNeumatico,
  PresionNeumatico, ProductividadTecnico, OperacionesInforme, InformeEjecutivo,
  ControlRevision, MontajesInforme, OrigenMontajes, InventarioResumen, KmPorMmFila,
} from "../types/informes";

function params(f: FiltrosInformes) {
  return { p_empresa: f.empresaId ?? null, p_desde: f.desde ?? null, p_hasta: f.hasta ?? null };
}

export async function obtenerKpis(f: FiltrosInformes): Promise<KpisInformes> {
  const { data, error } = await supabase.rpc("tc_informes_kpis", params(f));
  if (error) throw new Error(error.message);
  return data as KpisInformes;
}

export async function obtenerEstadoFlota(f: FiltrosInformes): Promise<EstadoFlota> {
  const { data, error } = await supabase.rpc("tc_informes_estado_flota", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return data as EstadoFlota;
}

/** La flota por fecha de revisión. El rango filtra por esa fecha. */
export async function controlRevisiones(f: FiltrosInformes): Promise<ControlRevision[]> {
  const { data, error } = await supabase.rpc("tc_informe_control_revisiones", {
    p_empresa: f.empresaId ?? null, p_desde: f.desde ?? null, p_hasta: f.hasta ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as ControlRevision[];
}

export async function inventarioPor(f: FiltrosInformes, dim: "marca" | "modelo" | "medida" | "estado"): Promise<DimensionTotal[]> {
  const { data, error } = await supabase.rpc("tc_informes_inventario_por", { p_empresa: f.empresaId ?? null, p_dim: dim });
  if (error) throw new Error(error.message);
  return (data ?? []) as DimensionTotal[];
}

export async function inventarioMarcaMedida(f: FiltrosInformes): Promise<MarcaMedidaTotal[]> {
  const { data, error } = await supabase.rpc("tc_informes_inventario_marca_medida", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as MarcaMedidaTotal[];
}

export async function distribucionProfundidad(f: FiltrosInformes): Promise<ProfundidadDistribucion[]> {
  const { data, error } = await supabase.rpc("tc_informes_profundidad_distribucion", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProfundidadDistribucion[];
}

export async function listarAlertas(f: FiltrosInformes): Promise<Alerta[]> {
  const { data, error } = await supabase.rpc("tc_informes_alertas", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as Alerta[];
}

export async function obtenerEconomico(f: FiltrosInformes): Promise<EconomicoInformes> {
  const { data, error } = await supabase.rpc("tc_informes_economico", params(f));
  if (error) throw new Error(error.message);
  return data as EconomicoInformes;
}

export async function rankingVehiculos(f: FiltrosInformes, orden: "coste" | "coste_km" | "pinchazos" | "reparaciones"): Promise<RankingVehiculo[]> {
  const { data, error } = await supabase.rpc("tc_informes_ranking_vehiculos", { p_empresa: f.empresaId ?? null, p_orden: orden });
  if (error) throw new Error(error.message);
  return (data ?? []) as RankingVehiculo[];
}

export async function rankingMarcas(f: FiltrosInformes): Promise<RankingMarca[]> {
  const { data, error } = await supabase.rpc("tc_informes_ranking_marcas", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as RankingMarca[];
}

export async function costeKmNeumatico(f: FiltrosInformes): Promise<CosteKmNeumatico[]> {
  const { data, error } = await supabase.rpc("tc_informes_coste_km_neumatico", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as CosteKmNeumatico[];
}

export async function desgaste(f: FiltrosInformes): Promise<DesgasteNeumatico[]> {
  const { data, error } = await supabase.rpc("tc_informes_desgaste", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as DesgasteNeumatico[];
}

/**
 * Kilómetros por milímetro de dibujo, por modelo y eje.
 *
 * `p_min_km` y `p_salto` son los dos mandos del método y se dejan en el
 * valor por defecto de la base: no se mandan desde aquí para que la pantalla
 * no pueda enseñar una cifra sacada con un criterio y llamarla igual que la
 * de otro. Si algún día hacen falta, que sea con un control a la vista.
 */
export async function kmPorMm(f: FiltrosInformes): Promise<KmPorMmFila[]> {
  const { data, error } = await supabase.rpc("tc_informes_km_por_mm", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as KmPorMmFila[];
}

export async function presiones(f: FiltrosInformes): Promise<PresionNeumatico[]> {
  const { data, error } = await supabase.rpc("tc_informes_presiones", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as PresionNeumatico[];
}

export async function productividad(f: FiltrosInformes): Promise<ProductividadTecnico[]> {
  const { data, error } = await supabase.rpc("tc_informes_productividad", params(f));
  if (error) throw new Error(error.message);
  return (data ?? []) as ProductividadTecnico[];
}

export async function operacionesInforme(f: FiltrosInformes): Promise<OperacionesInforme> {
  const { data, error } = await supabase.rpc("tc_informes_operaciones", params(f));
  if (error) throw new Error(error.message);
  return data as OperacionesInforme;
}

export async function obtenerInformeEjecutivo(f: FiltrosInformes): Promise<InformeEjecutivo> {
  const { data, error } = await supabase.rpc("tc_informe_ejecutivo", params(f));
  if (error) throw new Error(error.message);
  return data as InformeEjecutivo;
}

/**
 * Montajes de neumáticos: cuántas gomas se pusieron, por marca, modelo,
 * medida, condición, vehículo y periodo. `origen` separa el histórico
 * importado de las operaciones normales.
 *
 * Es una RPC NUEVA, con nombre propio: ni tc_informes_kpis ni
 * tc_informes_operaciones cambian de firma, así que PostgREST no se
 * encuentra con dos candidatas para la misma llamada.
 */
export async function montajesInforme(f: FiltrosInformes, origen: OrigenMontajes = "ambos"): Promise<MontajesInforme> {
  const { data, error } = await supabase.rpc("tc_informes_montajes", { ...params(f), p_origen: origen });
  if (error) throw new Error(error.message);
  return data as MontajesInforme;
}

/** Cuántas fichas son de verdad, cuántas vienen de la reconstrucción histórica
 *  y cuántas unidades históricas siguen sin identificar. */
export async function inventarioResumen(f: FiltrosInformes): Promise<InventarioResumen> {
  const { data, error } = await supabase.rpc("tc_informes_inventario_resumen", { p_empresa: f.empresaId ?? null });
  if (error) throw new Error(error.message);
  return data as InventarioResumen;
}

// ── Informe mensual de flota ───────────────────────────────────────────────
//
// Este informe no es una RPC como los demás: lo calcula el servidor de
// Mobilink, no la base. Por eso va por `fetch` con el token de la sesión y no
// por `supabase.rpc`, y por eso necesita su propio ayudante.

const API_MENSUAL = import.meta.env.PROD ? "" : "http://localhost:4000";

async function pedir<T>(ruta: string): Promise<T> {
  const r = await fetch(`${API_MENSUAL}${ruta}`, { headers: await authHeaders() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as any)?.error || `Error ${r.status}`);
  return j as T;
}


export interface MatrizInforme {
  columnas: string[];
  filas: Array<{ etiqueta: string; celdas: number[]; total: number; pct: number }>;
  totalPorColumna: number[];
  total: number;
}

export interface FilaFichaInforme {
  vehiculoId: string;
  numeroUnidad: string | null;
  matricula: string | null;
  base: string | null;
  profundidades: Array<number | null>;
  peor: number | null;
  banda: string | null;
  medida: string | null;
  ultimaRevision: string | null;
}

export interface InformeMensual {
  ok: true;
  empresa: string;
  empresaNombre: string | null;
  periodo: { mes: string; desde: string; hasta: string; etiqueta: string };
  recuentos: {
    flotaControlada: number; flotaRevisada: number; pendientes: number;
    pctRevisada: number; pctPendientes: number;
  };
  neumaticos: {
    posiciones: number[]; porPosicion: number[]; total: number; sinPosicion: number;
  };
  avisos: string[];
  rejillas: Record<
    "marcaPorPosicion" | "medidaPorPosicion" | "condicionPorPosicion"
    | "profundidadPorPosicion" | "medidaPorMilimetro" | "medidaPorMarca",
    MatrizInforme
  >;
  listados: Array<{ banda: string; titulo: string; filas: FilaFichaInforme[] }>;
  planificacion: {
    mes: string; etiqueta: string; filas: FilaFichaInforme[]; sinRevisar: number;
  };
}

export interface Porcion { etiqueta: string; valor: number; pct: number }

export interface MesEvolucionInforme {
  mes: string; etiqueta: string;
  porBanda: number[]; pctPorBanda: number[];
  total: number; ruedas: number;
  recauchutadas: number; reesculturadas: number;
}

export interface EvolucionInforme {
  ok: true;
  meses: MesEvolucionInforme[];
  desde: string | null;
  mesesVaciosAlPrincipio: number;
  avisos: string[];
  quesitos: { bandas: Porcion[]; condicion: Porcion[] } | null;
}

/** El informe del mes: cabecera, recuentos, rejillas y listados. */
export async function informeMensual(
  empresaId: string, mes: string, incluirBaja = false,
): Promise<InformeMensual> {
  const q = new URLSearchParams({ empresa: empresaId, mes });
  if (incluirBaja) q.set("incluirBaja", "1");
  return pedir<InformeMensual>(`/api/tyrecontrol/informes/mensual?${q}`);
}

/**
 * La evolución y los quesitos, en su propia petición.
 *
 * Va aparte porque cuesta aparte: son doce meses de mediciones. Así la
 * pantalla puede enseñar los recuentos y las tablas en cuanto llegan, sin
 * esperar por las gráficas.
 */
export async function evolucionMensual(
  empresaId: string, mes: string, meses = 12,
): Promise<EvolucionInforme> {
  const q = new URLSearchParams({ empresa: empresaId, mes, meses: String(meses) });
  return pedir<EvolucionInforme>(`/api/tyrecontrol/informes/mensual/evolucion?${q}`);
}
