/**
 * Lo que la simulación y la importación necesitan de la base.
 *
 * Todo paginado, y no por gusto: PostgREST corta cualquier respuesta en su
 * tope de filas y no lo dice. Plana tiene 807 vehículos y el fichero del
 * centro trae 1.744 intervenciones; sin paginar, el cruce daría por «nuevas»
 * las que no cupieron en la respuesta y las volvería a crear. Es exactamente
 * el fallo que duplicó 7.835 revisiones del CheckPoint.
 *
 * Aquí solo se LEE. Lo que escribe va en su propio módulo, para que no haya
 * duda de qué toca la base y qué no.
 */

import { supabase } from "../../supabase.ts";
import { paginar } from "../informes/paginar.ts";
import { normalizarMatricula } from "../matricula.ts";
import type { VehiculoRef } from "./simular.ts";
import { REGLA_POR_DEFECTO, type Regla } from "./vencimiento.ts";

/** El origen por defecto: el informe de intervenciones de la extranet. */
export const SISTEMA_ORIGEN = "informe_intervenciones";

/**
 * Los vehículos de la empresa, con su medida habitual ya resuelta.
 *
 * Entran los de baja también: una intervención de 2022 sobre un autobús que
 * se vendió en 2024 sigue siendo historia de ese autobús, y dejarla sin
 * vincular sería perderla.
 */
export async function leerVehiculos(empresa: string): Promise<VehiculoRef[]> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_vehiculos")
      .select("id, matricula, bastidor, activo, medida_id, medida:tc_cat_medidas_neumatico(valor)")
      .eq("empresa_id", empresa)
      .order("id", { ascending: true })   // orden fijo: sin él una página
      .range(desde, hasta));              // puede repetir o saltarse filas

  return filas.map((v): VehiculoRef => ({
    id: String(v.id),
    matricula: String(v.matricula ?? ""),
    matriculaNorm: normalizarMatricula(v.matricula),
    bastidor: v.bastidor ?? null,
    activo: v.activo !== false,
    medidaId: v.medida_id ?? null,
    medida: (v.medida as any)?.valor ?? null,
  }));
}

/**
 * Los identificadores que ya están importados.
 *
 * Es lo que hace que volver a pasar el mismo fichero no duplique nada, y que
 * la exportación del mes que viene —más larga, con las mismas de antes
 * dentro— traiga solo lo nuevo.
 */
export async function leerYaImportados(
  empresa: string,
  sistema = SISTEMA_ORIGEN,
): Promise<Set<string>> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_tacografo_intervenciones")
      .select("id_origen")
      .eq("empresa_id", empresa)
      .eq("sistema_origen", sistema)
      .order("id_origen", { ascending: true })
      .range(desde, hasta));
  return new Set(filas.map((f) => String(f.id_origen)));
}

/**
 * La regla de periodicidad de la empresa.
 *
 * Sin fila configurada se usa la de por defecto —24 meses, cualquier
 * intervención— en vez de fallar: una empresa que todavía no ha configurado
 * nada tiene que poder ver su histórico igual.
 */
export async function leerRegla(empresa: string): Promise<Regla> {
  const { data } = await supabase
    .from("tc_tacografo_regla")
    .select("meses, aviso_dias, tipos_reinician, resultados_reinician")
    .eq("empresa_id", empresa)
    .maybeSingle();
  if (!data) return REGLA_POR_DEFECTO;
  return {
    meses: Number((data as any).meses ?? REGLA_POR_DEFECTO.meses),
    avisoDias: Number((data as any).aviso_dias ?? REGLA_POR_DEFECTO.avisoDias),
    tiposReinician: (data as any).tipos_reinician ?? null,
    resultadosReinician: (data as any).resultados_reinician ?? null,
  };
}

/** Los lotes de una empresa, del más reciente al más viejo. */
export async function leerLotes(empresa: string, limite = 50): Promise<any[]> {
  const { data, error } = await supabase
    .from("tc_tacografo_lotes")
    .select("id, archivo_nombre, sistema_origen, archivo_filas, filas_empresa, importadas, "
      + "duplicadas, sin_vehiculo, bloqueadas, estado, created_at, deshecho_en, nota")
    .eq("empresa_id", empresa)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Un lote concreto, con lo que hace falta para decidir si se puede deshacer. */
export async function leerLote(loteId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("tc_tacografo_lotes")
    .select("id, empresa_id, estado, importadas, archivo_nombre, created_at")
    .eq("id", loteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Las filas de un lote, con las marcas de tiempo que delatan un cambio posterior. */
export async function leerFilasDeLote(loteId: string): Promise<any[]> {
  return paginar<any>((desde, hasta) =>
    supabase
      .from("tc_tacografo_intervenciones")
      .select("id, id_origen, importado_en, actualizado_en, vinculado_en")
      .eq("lote_id", loteId)
      .order("id", { ascending: true })
      .range(desde, hasta));
}

/** Las propuestas de medida que salieron de un lote. */
export async function leerPropuestasDeLote(loteId: string): Promise<any[]> {
  return paginar<any>((desde, hasta) =>
    supabase
      .from("tc_tacografo_medida_propuesta")
      .select("id, estado, matricula_norm")
      .eq("lote_id", loteId)
      .order("id", { ascending: true })
      .range(desde, hasta));
}

/** Las filas que no entraron en un lote, con su motivo. */
export async function leerBloqueadasDeLote(loteId: string): Promise<any[]> {
  return paginar<any>((desde, hasta) =>
    supabase
      .from("tc_tacografo_bloqueados")
      .select("fila_origen, id_origen, matricula, fecha, motivo, valor")
      .eq("lote_id", loteId)
      .order("fila_origen", { ascending: true })
      .range(desde, hasta));
}

// ── Fase 4: lo que necesitan la pantalla de control y la ficha ──────────────

/** Las intervenciones de una empresa, o las de un vehículo. Paginadas. */
export async function leerIntervenciones(
  empresa: string, vehiculoId?: string,
): Promise<any[]> {
  return paginar<any>((desde, hasta) => {
    let q = supabase
      .from("tc_tacografo_intervenciones")
      .select("id, vehiculo_id, id_origen, fecha, tipo_operacion, resultado, "
        + "medida_neumatico, medida_neumatico_norm, km_nuevo, km_sospechoso, "
        + "param_l, param_w, param_k, referencia, version, num_serie, num_sensor, "
        + "tipo_tacografo, fabricante, tecnico, observaciones")
      .eq("empresa_id", empresa);
    if (vehiculoId) q = q.eq("vehiculo_id", vehiculoId);
    return q.order("id", { ascending: true }).range(desde, hasta);
  });
}

/** La flota con su delegación, para poder filtrar por base. */
export async function leerFlotaConBase(empresa: string): Promise<any[]> {
  return paginar<any>((desde, hasta) =>
    supabase
      .from("tc_vehiculos")
      .select("id, matricula, numero_unidad, activo, delegacion_id, "
        + "delegacion:tc_delegaciones(id, nombre)")
      .eq("empresa_id", empresa)
      .order("id", { ascending: true })
      .range(desde, hasta));
}

/** Un vehículo suelto, para la sección de su ficha. */
export async function leerVehiculo(empresa: string, vehiculoId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("tc_vehiculos")
    .select("id, matricula, numero_unidad, activo, delegacion_id, "
      + "delegacion:tc_delegaciones(id, nombre)")
    .eq("empresa_id", empresa)
    .eq("id", vehiculoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/** Las bases de la empresa, para el desplegable del filtro. */
export async function leerBases(empresa: string): Promise<Array<{ id: string; nombre: string }>> {
  const { data, error } = await supabase
    .from("tc_delegaciones")
    .select("id, nombre")
    .eq("empresa_id", empresa)
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []).map((d: any) => ({ id: String(d.id), nombre: String(d.nombre ?? "") }));
}
