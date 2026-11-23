/** Gomas «pendientes de clasificar» del Almacén de usados (RPC tc_pendientes_clasificar / tc_clasificar_pendientes). */
import { supabase } from "./supabase";

export type GrupoPendiente = "provisional" | "excel" | "catalogo_usado" | "otros";
export type Sugerido = "almacen" | "baja" | "decidir";
export type DestinoClasificacion = "almacen_flota" | "almacen_taller" | "reciclaje" | "baja";

export interface PendienteClasificar {
  neumatico_id: string;
  codigo: string | null;
  marca: string | null;
  modelo: string | null;
  medida: string | null;
  profundidad_actual_mm: number | null;
  origen: string | null;
  grupo: GrupoPendiente;
  sugerido: Sugerido;
  desde: string | null;
}

export async function listarPendientesClasificar(empresaId: string): Promise<PendienteClasificar[]> {
  const { data, error } = await supabase.rpc("tc_pendientes_clasificar", { p_empresa: empresaId });
  if (error) throw new Error(error.message);
  return (data ?? []) as PendienteClasificar[];
}

/** De 500 en 500 para no mandar una lista enorme de golpe. Devuelve cuántas se han clasificado. */
export async function clasificarPendientes(
  empresaId: string, ids: string[], destino: DestinoClasificacion, obs?: string,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.rpc("tc_clasificar_pendientes", {
      p_empresa: empresaId, p_ids: ids.slice(i, i + 500), p_destino: destino, p_obs: obs ?? null,
    });
    if (error) throw new Error(error.message);
    total += Number((data as { clasificadas?: number } | null)?.clasificadas ?? 0);
  }
  return total;
}
