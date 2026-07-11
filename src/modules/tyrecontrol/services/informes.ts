// Servicio del módulo Informes: envuelve las RPC de agregación de Postgres.
// Toda la lógica pesada vive en la base de datos (ver migración
// tyrecontrol_informes_kpis.sql); aquí solo tipamos y llamamos.
import { supabase } from "./supabase";
import type {
  FiltrosInformes, KpisInformes, EstadoFlota, DimensionTotal, MarcaMedidaTotal, ProfundidadDistribucion, Alerta,
  EconomicoInformes, RankingVehiculo, RankingMarca, CosteKmNeumatico, DesgasteNeumatico,
  PresionNeumatico, ProductividadTecnico, OperacionesInforme,
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
