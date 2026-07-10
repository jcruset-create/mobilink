// Servicio del módulo Informes: envuelve las RPC de agregación de Postgres.
// Toda la lógica pesada vive en la base de datos (ver migración
// tyrecontrol_informes_kpis.sql); aquí solo tipamos y llamamos.
import { supabase } from "./supabase";
import type {
  FiltrosInformes, KpisInformes, EstadoFlota, DimensionTotal, MarcaMedidaTotal, ProfundidadDistribucion,
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
