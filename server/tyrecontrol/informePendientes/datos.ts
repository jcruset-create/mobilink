/**
 * Las tres fuentes de la hoja del patio.
 *
 * ── Todo va paginado, y no por gusto ───────────────────────────────────────
 *
 * PostgREST corta cualquier respuesta en su tope de filas y no avisa: el
 * que pregunta recibe menos de lo que hay y sigue como si nada. Este
 * informe ya se llevó esa lección en `informeRevisiones` —un PDF de 56
 * páginas diciendo «sin mediciones» porque la petición se quedó corta—, así
 * que aquí las tres lecturas paginan desde el primer día.
 *
 *   · La presencia la lee `leerPresencia`, que ya pagina (su comentario es
 *     donde el repositorio tiene escrito el tope de mil filas).
 *   · `tc_revision_estado()` no acepta empresa: devuelve lo que la RLS deje
 *     ver, y con la clave de servicio eso es la flota de todos. Se pagina y
 *     se indexa por `vehiculo_id`; de ahí solo se consultan los vehículos
 *     que la presencia ya ha dado por dentro de una base, así que de las
 *     demás empresas no sale nada al papel.
 *   · `tc_informe_flota_detalle(empresa)` sí acepta empresa, pero 751
 *     vehículos de esta flota están a un suspiro del tope. También pagina.
 */

import { supabase } from "../../supabase.ts";
import type { RevisionEstado } from "../../../src/modules/tyrecontrol/types/index.ts";
import { indexarFichas, type FichaVehiculo } from "./armar.ts";
import { paginar } from "../informes/paginar.ts";

/**
 * El estado de periodicidad de cada vehículo, por `vehiculo_id`.
 *
 * Se ordena por `vehiculo_id` para que la paginación sea estable: sin un
 * orden fijo, dos páginas pueden repetir filas y saltarse otras.
 */
export async function leerRevisionEstado(): Promise<Map<string, RevisionEstado>> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .rpc("tc_revision_estado")
      .select("vehiculo_id, estado, dias_vencido, ultima_revision, ultima_revision_por")
      .order("vehiculo_id", { ascending: true })
      .range(desde, hasta));

  const m = new Map<string, RevisionEstado>();
  for (const f of filas) {
    if (!f?.vehiculo_id) continue;
    m.set(String(f.vehiculo_id), {
      vehiculo_id: String(f.vehiculo_id),
      estado: f.estado,
      dias_vencido: f.dias_vencido == null ? null : Number(f.dias_vencido),
      ultima_revision: f.ultima_revision ?? null,
      ultima_revision_por: f.ultima_revision_por ?? null,
    });
  }
  return m;
}

/** La ficha de cada vehículo de la empresa, indexada por matrícula normalizada. */
export async function leerFichas(empresa: string): Promise<Map<string, FichaVehiculo>> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .rpc("tc_informe_flota_detalle", { p_empresa: empresa })
      .select("*")
      .order("matricula", { ascending: true })
      .range(desde, hasta));

  return indexarFichas(filas.map((f): FichaVehiculo => ({
    matricula: f.matricula ?? null,
    unidad: f.unidad ?? null,
    base: f.base ?? null,
    tipo: f.tipo ?? null,
    config: f.config ?? null,
    medida: f.medida ?? null,
    estado: f.estado ?? null,
    ultima_revision: f.ultima_revision ?? null,
    dias_desde: f.dias_desde == null ? null : Number(f.dias_desde),
    ruedas_plano: f.ruedas_plano == null ? null : Number(f.ruedas_plano),
    ruedas_montadas: f.ruedas_montadas == null ? null : Number(f.ruedas_montadas),
    ruedas_medidas: f.ruedas_medidas == null ? null : Number(f.ruedas_medidas),
    profundidad_minima: f.profundidad_minima == null ? null : Number(f.profundidad_minima),
    bajo_minimo: f.bajo_minimo == null ? null : Number(f.bajo_minimo),
    en_aviso: f.en_aviso == null ? null : Number(f.en_aviso),
    km_actual: f.km_actual == null ? null : Number(f.km_actual),
  })));
}

/** El nombre de la empresa, para la cabecera y el pie. */
export async function nombreEmpresa(empresaId: string): Promise<string> {
  const { data } = await supabase.from("tc_empresas").select("nombre").eq("id", empresaId).maybeSingle();
  return String((data as any)?.nombre ?? "");
}
