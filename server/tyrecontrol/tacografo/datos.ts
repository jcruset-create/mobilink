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
import { claveDe, type MedidaCatalogo } from "./propuestas.ts";

/** El origen por defecto: el informe de intervenciones de la extranet. */
export const SISTEMA_ORIGEN = "informe_intervenciones";

/**
 * El `tipo` con el que los informes de tacógrafo viven en
 * `tc_vehiculo_documentos`, al lado de las fichas técnicas.
 */
export const TIPO_DOC_INFORME = "informe_tacografo";

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
        // `bastidor_origen` es del VEHÍCULO y no del aparato, pero el centro
        // lo apunta en cada intervención y en TyreControl falta en 682
        // autobuses: es la única parte del sistema que lo tiene.
        + "tipo_tacografo, fabricante, bastidor_origen, tecnico, observaciones")
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

// ── Fase 5: lo que necesita la pantalla de propuestas de medida ────────────

/**
 * El catálogo de medidas, entero.
 *
 * Entero y no «la que busco»: resolver una propuesta necesita saber si la
 * medida está con marcado, sin marcado, activa o de baja, y preguntarlo por
 * separado para cada una de 43 propuestas son 43 viajes a la base para leer
 * una tabla de dos docenas de filas.
 */
export async function leerCatalogoMedidas(): Promise<MedidaCatalogo[]> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_cat_medidas_neumatico")
      .select("id, valor, activo")
      .order("valor", { ascending: true })
      .range(desde, hasta));
  return filas.map((m) => ({
    id: String(m.id),
    valor: String(m.valor ?? ""),
    activo: m.activo !== false,
  }));
}

/** Las propuestas de una empresa, por estado. Sin estado, las pendientes. */
export async function leerPropuestas(
  empresa: string, estado: string | null = "pendiente",
): Promise<any[]> {
  return paginar<any>((desde, hasta) => {
    let q = supabase
      .from("tc_tacografo_medida_propuesta")
      .select(
        "id, vehiculo_id, matricula_norm, caso, medida_norm, medida_origen, "
        + "fecha_intervencion, id_origen, intervencion_id, medida_actual, medida_actual_id, "
        + "segura_para_bloque, estado, resuelto_en, nota, "
        + "medida_aplicada, aplicada_exacta, created_at, lote_id",
      )
      .eq("empresa_id", empresa);
    if (estado) q = q.eq("estado", estado);
    // Orden fijo, que es lo que la paginación necesita para no repetir ni
    // saltarse filas: por caso y, dentro, por antigüedad.
    return q
      .order("caso", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, hasta);
  });
}

/** Una propuesta concreta, para resolverla. */
export async function leerPropuesta(empresa: string, id: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("tc_tacografo_medida_propuesta")
    .select(
      "id, empresa_id, vehiculo_id, matricula_norm, caso, medida_norm, medida_origen, "
      + "fecha_intervencion, id_origen, medida_actual, medida_actual_id, "
      + "segura_para_bloque, estado",
    )
    .eq("empresa_id", empresa)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`No se ha podido leer la propuesta: ${error.message}`);
  return data ?? null;
}

/**
 * La medida que tienen AHORA los vehículos que se le pasan.
 *
 * Es lo que se compara con la que la propuesta guardó, para no pisar a quien
 * la haya puesto a mano entretanto. Se piden juntos y no de uno en uno: una
 * confirmación en bloque de 43 propuestas serían 43 consultas.
 */
export async function leerMedidasDeVehiculos(
  empresa: string, ids: string[],
): Promise<Map<string, { medidaId: string | null; medida: string | null }>> {
  const m = new Map<string, { medidaId: string | null; medida: string | null }>();
  if (ids.length === 0) return m;
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += 200) {
    const tanda = unicos.slice(i, i + 200);
    const { data, error } = await supabase
      .from("tc_vehiculos")
      .select("id, medida_id, medida:tc_cat_medidas_neumatico(valor)")
      .eq("empresa_id", empresa)
      .in("id", tanda);
    if (error) throw new Error(`No se han podido leer las medidas de los vehículos: ${error.message}`);
    for (const v of data ?? []) {
      const rel: any = (v as any).medida;
      const valor = Array.isArray(rel) ? rel[0]?.valor : rel?.valor;
      m.set(String(v.id), {
        medidaId: (v as any).medida_id ?? null,
        medida: valor ?? null,
      });
    }
  }
  return m;
}

/** Las claves (matrícula|medida) que ya tienen propuesta, en cualquier estado. */
export async function leerClavesDePropuestas(empresa: string): Promise<Set<string>> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_tacografo_medida_propuesta")
      .select("matricula_norm, medida_norm")
      .eq("empresa_id", empresa)
      .order("matricula_norm", { ascending: true })
      .order("medida_norm", { ascending: true })
      .range(desde, hasta));
  return new Set(filas.map((f) => claveDe(String(f.matricula_norm), String(f.medida_norm))));
}

/** Los `id` de las intervenciones de un lote, por `id_origen`. */
export async function leerIdsPorOrigen(loteId: string): Promise<Map<string, string>> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_tacografo_intervenciones")
      .select("id, id_origen")
      .eq("lote_id", loteId)
      .order("id", { ascending: true })
      .range(desde, hasta));
  return new Map(filas.map((f) => [String(f.id_origen), String(f.id)]));
}

// ════════════════════════════════════════════════════════════════════════════
// Los informes técnicos en PDF
// ════════════════════════════════════════════════════════════════════════════

/** La intervención con ese nº de orden, si ya está. Es la pregunta del adjunto. */
export async function leerIntervencionPorOrigen(
  empresa: string, idOrigen: string,
): Promise<{ id: string; vehiculoId: string | null; fecha: string | null; creadaDePdf: boolean } | null> {
  const { data, error } = await supabase
    .from("tc_tacografo_intervenciones")
    .select("id, vehiculo_id, fecha, creada_de_pdf")
    .eq("empresa_id", empresa)
    .eq("sistema_origen", SISTEMA_ORIGEN)
    .eq("id_origen", idOrigen)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: String((data as any).id),
    vehiculoId: (data as any).vehiculo_id ?? null,
    fecha: (data as any).fecha ?? null,
    creadaDePdf: (data as any).creada_de_pdf === true,
  };
}

/**
 * Un informe ya adjunto a ESTA intervención con el mismo sha256.
 *
 * Por intervención y no por vehículo, que es lo que de verdad significa «este
 * informe ya está»: un PDF que trae el mes entero lleva varias intervenciones
 * del mismo autobús, y con la clave puesta en el vehículo la segunda se
 * tomaría por duplicada de la primera por compartir fichero.
 */
export async function leerInformePorHash(
  intervencionId: string, sha: string,
): Promise<{ id: string; intervencionId: string | null } | null> {
  const { data, error } = await supabase
    .from("tc_vehiculo_documentos")
    .select("id, intervencion_id")
    .eq("intervencion_id", intervencionId)
    .eq("tipo", TIPO_DOC_INFORME)
    .eq("hash_sha256", sha)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { id: String((data as any).id), intervencionId: (data as any).intervencion_id ?? null };
}

const CAMPOS_INFORME =
  "id, intervencion_id, vehiculo_id, storage_path, nombre_original, tamano_bytes, paginas, created_at";

/**
 * Los informes adjuntos de un vehículo, el más reciente primero.
 *
 * Se buscan por DOS caminos y la unión es lo que se enseña:
 *
 *   · por las intervenciones de este vehículo, que es lo que de verdad
 *     significa «el informe de esta revisión». Así aparece también el que se
 *     subió cuando el autobús todavía no estaba dado de alta: en cuanto su
 *     intervención se vincula, el clip sale solo, sin tocar el documento.
 *   · por `vehiculo_id`, que recoge los que se quedaron huérfanos porque se
 *     deshizo el lote que había importado su intervención.
 *
 * Con uno solo de los dos se perdería uno de esos dos casos.
 */
export async function leerInformesDeVehiculo(empresa: string, vehiculoId: string): Promise<any[]> {
  const intervenciones = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_tacografo_intervenciones")
      .select("id")
      .eq("empresa_id", empresa)
      .eq("vehiculo_id", vehiculoId)
      .order("id", { ascending: true })
      .range(desde, hasta));

  const porVehiculo = supabase
    .from("tc_vehiculo_documentos")
    .select(CAMPOS_INFORME)
    .eq("empresa_id", empresa)
    .eq("vehiculo_id", vehiculoId)
    .eq("tipo", TIPO_DOC_INFORME);

  const ids = intervenciones.map((i) => String(i.id));
  const consultas = [porVehiculo];
  // De 200 en 200: la lista de `in` viaja en la URL y un autobús con muchos
  // años de histórico tiene muchas intervenciones.
  for (let i = 0; i < ids.length; i += 200) {
    consultas.push(supabase
      .from("tc_vehiculo_documentos")
      .select(CAMPOS_INFORME)
      .eq("empresa_id", empresa)
      .eq("tipo", TIPO_DOC_INFORME)
      .in("intervencion_id", ids.slice(i, i + 200)));
  }

  const porId = new Map<string, any>();
  for (const q of consultas) {
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    for (const d of (data ?? []) as any[]) porId.set(String(d.id), d);
  }
  return [...porId.values()].sort((a, b) =>
    String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

/** Un informe suelto, para servirlo con su URL firmada. */
export async function leerInforme(empresa: string, documentoId: string): Promise<any | null> {
  const { data, error } = await supabase
    .from("tc_vehiculo_documentos")
    .select("id, empresa_id, vehiculo_id, intervencion_id, storage_path, nombre_original, mime_type")
    .eq("empresa_id", empresa)
    .eq("tipo", TIPO_DOC_INFORME)
    .eq("id", documentoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Los `id_origen` de las intervenciones que creó un informe en PDF y siguen
 * a medias. Se leen en cada importación para completarlas en vez de
 * saltárselas. Son pocas: el índice parcial las encuentra sin recorrer nada.
 */
export async function leerCreadasDePdf(empresa: string): Promise<Set<string>> {
  const filas = await paginar<any>((desde, hasta) =>
    supabase
      .from("tc_tacografo_intervenciones")
      .select("id_origen")
      .eq("empresa_id", empresa)
      .eq("creada_de_pdf", true)
      .order("id_origen", { ascending: true })
      .range(desde, hasta));
  return new Set(filas.map((f) => String(f.id_origen)));
}

/** Cuántos informes cuelgan de las intervenciones de un lote. Ver `deshacer.ts`. */
export async function contarInformesDeLote(loteId: string): Promise<number> {
  const { data, error } = await supabase
    .from("tc_tacografo_intervenciones")
    .select("id")
    .eq("lote_id", loteId);
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((r: any) => String(r.id));
  if (ids.length === 0) return 0;

  let total = 0;
  // Las intervenciones de un lote son 1.744 y la lista de `in` tiene un
  // límite práctico en la URL: de 200 en 200, como escribe el importador.
  for (let i = 0; i < ids.length; i += 200) {
    const { count, error: e } = await supabase
      .from("tc_vehiculo_documentos")
      .select("id", { count: "exact", head: true })
      .eq("tipo", TIPO_DOC_INFORME)
      .in("intervencion_id", ids.slice(i, i + 200));
    if (e) throw new Error(e.message);
    total += count ?? 0;
  }
  return total;
}

/**
 * Una intervención ENTERA, con todas sus columnas.
 *
 * Hace falta para completar las que creó un informe en PDF: el parche solo
 * rellena lo que está a null, y para saber qué está a null hay que mirarlo.
 * `select("*")` aquí es lo correcto y no un atajo: el parche recorre todas
 * las columnas que trae una fila, y una lista escrita a mano se quedaría
 * corta el día que se añada una.
 */
export async function leerIntervencionCompleta(
  empresa: string, idOrigen: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from("tc_tacografo_intervenciones")
    .select("*")
    .eq("empresa_id", empresa)
    .eq("sistema_origen", SISTEMA_ORIGEN)
    .eq("id_origen", idOrigen)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown> | null) ?? null;
}
