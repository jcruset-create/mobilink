/**
 * Los datos del informe de revisiones, en dos consultas.
 *
 * Dos y no una por revisión: con 232 revisiones y 1.190 mediciones, una
 * consulta por revisión son 233 viajes a la base para un PDF que alguien
 * está esperando con el navegador abierto.
 *
 * El UMBRAL de cada rueda se resuelve aquí con la misma cadena que usan los
 * informes de TyreControl: medida → categoría → empresa → 1,6 mm. Se repite
 * la cadena porque los informes la tienen en SQL dentro de sus funciones y
 * no hay una función suelta que la devuelva; si algún día la hay, esto debe
 * llamarla en vez de repetirla.
 */

import { supabase } from "../../supabase.ts";
import type { MedicionFila, RevisionFila } from "./armar.ts";

export interface Consulta {
  empresa: string;
  desde: string;
  hasta: string;
}

/** Las revisiones del periodo, con el nombre del técnico ya resuelto. */
export async function leerRevisiones(c: Consulta): Promise<RevisionFila[]> {
  const { data, error } = await supabase
    .from("revisiones_vehiculo")
    .select("id, fecha_revision, km_vehiculo, estado_revision, observaciones, tipo_revision, "
      + "tecnico:tc_usuarios!revisiones_vehiculo_tecnico_id_fkey(nombre), "
      + "vehiculo:tc_vehiculos!revisiones_vehiculo_vehiculo_id_fkey(matricula, numero_unidad)")
    .eq("empresa_id", c.empresa)
    .gte("fecha_revision", c.desde)
    .lte("fecha_revision", c.hasta)
    .order("fecha_revision", { ascending: true })
    .limit(5000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any): RevisionFila => ({
    id: String(r.id),
    fecha: String(r.fecha_revision ?? "").slice(0, 10),
    matricula: r.vehiculo?.matricula ?? null,
    numero_unidad: r.vehiculo?.numero_unidad ?? null,
    km_vehiculo: r.km_vehiculo == null ? null : Number(r.km_vehiculo),
    estado: String(r.estado_revision ?? ""),
    tecnico: r.tecnico?.nombre ?? null,
    tipo_revision: r.tipo_revision ?? null,
    observaciones: r.observaciones ?? null,
  }));
}

/**
 * Las mediciones de esas revisiones, con su umbral.
 *
 * Va por RPC y no por PostgREST porque la resolución del umbral necesita
 * tres `left join` y un `coalesce`, que desde el cliente serían tres
 * consultas más y un cruce a mano.
 */
export async function leerMediciones(c: Consulta, revisionIds: string[]): Promise<MedicionFila[]> {
  if (revisionIds.length === 0) return [];
  const { data, error } = await supabase.rpc("tc_informe_revisiones_mediciones", {
    p_empresa: c.empresa, p_revisiones: revisionIds,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((m: any): MedicionFila => ({
    revision_id: String(m.revision_id),
    posicion: m.posicion ?? null,
    orden: m.orden == null ? null : Number(m.orden),
    profundidad_mm: m.profundidad_mm == null ? null : Number(m.profundidad_mm),
    presion_bar: m.presion_bar == null ? null : Number(m.presion_bar),
    minimo_mm: m.minimo_mm == null ? null : Number(m.minimo_mm),
    aviso_mm: m.aviso_mm == null ? null : Number(m.aviso_mm),
    no_accesible: m.no_accesible ?? false,
    neumatico_ausente: m.neumatico_ausente ?? false,
    marca: m.marca ?? null,
    medida: m.medida ?? null,
    codigo_interno: m.codigo_interno ?? null,
  }));
}

/** El nombre de la empresa, para la portada. */
export async function nombreEmpresa(empresaId: string): Promise<string> {
  const { data } = await supabase.from("tc_empresas").select("nombre").eq("id", empresaId).maybeSingle();
  return String((data as any)?.nombre ?? "");
}
